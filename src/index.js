require('dotenv').config();
const http = require('node:http');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
  REST,
  Routes
} = require('discord.js');
const { DataStore } = require('./store');
const { cleanAmount, clearPreserveChannel, recreateChannel } = require('./cleaner');
const { handleAutoMod, normalizeDomain } = require('./automod');
const {
  postTicketPanel,
  onTicketChannelCreated,
  handleTicketButton,
  handleTicketModal,
  processClaim
} = require('./tickets');
const { handleAnnouncementCommand, startAnnouncementScheduler } = require('./announcements');
const { sendLog } = require('./logger');
const { buildCommands } = require('./commands');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const store = new DataStore(path.join(__dirname, '..', 'data', 'db.json'));
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

async function registerGuildCommands(guildId) {
  if (!process.env.DISCORD_CLIENT_ID) {
    console.error('[commands] Missing DISCORD_CLIENT_ID; cannot register slash commands.');
    return;
  }
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const commands = buildCommands();
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), { body: commands });
    console.log(`Registered ${commands.length} slash commands in guild ${guildId}.`);
  } catch (err) {
    console.error(`[commands] Failed to register commands in guild ${guildId}:`, err.message);
  }
}

function isStaff(interaction) {
  if (!interaction.guildId || !interaction.member) return false;
  const permissions = interaction.memberPermissions;
  if (permissions?.has(PermissionFlagsBits.Administrator) || permissions?.has(PermissionFlagsBits.ManageGuild) || permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  const staffRoleId = store.getSettings(interaction.guildId).staffRoleId;
  return Boolean(staffRoleId && interaction.member.roles?.cache?.has(staffRoleId));
}

async function denyUnlessStaff(interaction) {
  if (isStaff(interaction)) return false;
  await interaction.reply({ content: 'You do not have permission to use that staff command.', ephemeral: true });
  return true;
}

async function handleSetup(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'ticket-category') {
    const category = interaction.options.getChannel('category', true);
    await store.addTicketCategory(guildId, category.id);
    return interaction.reply({ content: `✅ <#${category.id}> is now a ticket category. New channels created inside it will get the Hudson Shop menu.`, ephemeral: true });
  }
  if (sub === 'remove-ticket-category') {
    const category = interaction.options.getChannel('category', true);
    await store.removeTicketCategory(guildId, category.id);
    return interaction.reply({ content: `✅ Removed <#${category.id}> from the automatic ticket categories.`, ephemeral: true });
  }
  if (sub === 'log-channel') {
    const channel = interaction.options.getChannel('channel', true);
    await store.updateSettings(guildId, { logChannelId: channel.id });
    return interaction.reply({ content: `✅ Bot, AutoMod, and claim logs will go to <#${channel.id}>.`, ephemeral: true });
  }
  if (sub === 'staff-role') {
    const role = interaction.options.getRole('role', true);
    await store.updateSettings(guildId, { staffRoleId: role.id });
    return interaction.reply({ content: `✅ <@&${role.id}> is configured as the Hudson bot staff role and bypasses AutoMod.`, ephemeral: true });
  }
  if (sub === 'ticket-welcome') {
    const enabled = interaction.options.getBoolean('enabled', true);
    await store.updateSettings(guildId, { ticketWelcome: enabled });
    return interaction.reply({ content: `✅ Automatic ticket menus are now **${enabled ? 'ON' : 'OFF'}**.`, ephemeral: true });
  }
  if (sub === 'automod') {
    const enabled = interaction.options.getBoolean('enabled', true);
    await store.updateSettings(guildId, { automodEnabled: enabled });
    return interaction.reply({ content: `✅ Hudson AutoMod is now **${enabled ? 'ON' : 'OFF'}**.`, ephemeral: true });
  }
  if (sub === 'status') {
    const s = store.getSettings(guildId);
    const embed = new EmbedBuilder()
      .setColor(0x7628BE)
      .setTitle('Hudson Bot Configuration')
      .addFields(
        { name: 'Ticket Categories', value: s.ticketCategoryIds.length ? s.ticketCategoryIds.map((id) => `<#${id}>`).join(', ') : 'Not set' },
        { name: 'Log Channel', value: s.logChannelId ? `<#${s.logChannelId}>` : 'Not set', inline: true },
        { name: 'Staff Role', value: s.staffRoleId ? `<@&${s.staffRoleId}>` : 'Not set', inline: true },
        { name: 'Ticket Welcome', value: s.ticketWelcome ? 'On' : 'Off', inline: true },
        { name: 'AutoMod', value: s.automodEnabled ? 'On' : 'Off', inline: true },
        { name: 'Store', value: s.storeUrl || process.env.STORE_URL || 'https://thehudsonshop.com' }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleAutomodCommand(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const settings = store.getSettings(interaction.guildId);

  if (sub === 'add-phrase') {
    const phrase = interaction.options.getString('phrase', true).trim().toLowerCase();
    const phrases = [...new Set([...(settings.blockedPhrases || []), phrase])];
    await store.updateSettings(interaction.guildId, { blockedPhrases: phrases });
    return interaction.reply({ content: `✅ AutoMod will delete messages containing **${phrase}**.`, ephemeral: true });
  }
  if (sub === 'remove-phrase') {
    const phrase = interaction.options.getString('phrase', true).trim().toLowerCase();
    const phrases = (settings.blockedPhrases || []).filter((p) => p.toLowerCase() !== phrase);
    await store.updateSettings(interaction.guildId, { blockedPhrases: phrases });
    return interaction.reply({ content: `✅ Removed **${phrase}** from blocked phrases.`, ephemeral: true });
  }
  if (sub === 'add-domain') {
    const domain = normalizeDomain(interaction.options.getString('domain', true));
    if (!domain || !domain.includes('.')) return interaction.reply({ content: 'Enter a domain such as `fake-giveaway.com`.', ephemeral: true });
    const domains = [...new Set([...(settings.blockedDomains || []).map(normalizeDomain), domain])];
    await store.updateSettings(interaction.guildId, { blockedDomains: domains });
    return interaction.reply({ content: `✅ AutoMod will delete links to **${domain}**.`, ephemeral: true });
  }
  if (sub === 'remove-domain') {
    const domain = normalizeDomain(interaction.options.getString('domain', true));
    const domains = (settings.blockedDomains || []).map(normalizeDomain).filter((d) => d !== domain);
    await store.updateSettings(interaction.guildId, { blockedDomains: domains });
    return interaction.reply({ content: `✅ Removed **${domain}** from blocked domains.`, ephemeral: true });
  }
  if (sub === 'status') {
    const fresh = store.getSettings(interaction.guildId);
    const embed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('Hudson AutoMod')
      .addFields(
        { name: 'Status', value: fresh.automodEnabled ? 'Enabled' : 'Disabled' },
        { name: 'Blocked phrases', value: fresh.blockedPhrases?.length ? fresh.blockedPhrases.map((x) => `• ${x}`).join('\n').slice(0, 1000) : 'None' },
        { name: 'Blocked domains', value: fresh.blockedDomains?.length ? fresh.blockedDomains.map((x) => `• ${x}`).join('\n').slice(0, 1000) : 'None' },
        { name: 'Built-in detection', value: 'Burst spam, repeated messages, mention spam, suspicious MrBeast/giveaway links, and common Discord/Steam impersonation link patterns.' }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleClearAllCommand(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.messages) return interaction.reply({ content: 'This command can only be used in a normal text/announcement channel.', ephemeral: true });
  const method = interaction.options.getString('method', true);
  const warning = method === 'recreate'
    ? 'This will clone this channel, delete the original, and leave the new channel completely empty. **The channel ID changes, and channel-specific webhooks/integrations may need updating.**'
    : 'This keeps the same channel ID and deletes the entire message history. Old messages are removed individually, so a very large channel can take a while.';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hudson_clear_confirm:${interaction.user.id}:${method}`).setLabel('Confirm Clear All').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`hudson_clear_cancel:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({ content: `⚠️ **Clear all messages in #${channel.name}?**\n${warning}`, components: [row], ephemeral: true });
}

async function handleClearButton(interaction) {
  const parts = interaction.customId.split(':');
  const ownerId = parts[1];
  if (interaction.user.id !== ownerId) return interaction.reply({ content: 'Only the person who started this clear can confirm it.', ephemeral: true });

  if (interaction.customId.startsWith('hudson_clear_cancel:')) {
    return interaction.update({ content: 'Clear cancelled.', components: [] });
  }

  const method = parts[2];
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.messages) return interaction.update({ content: 'This channel can no longer be cleared.', components: [] });

  if (method === 'recreate') {
    await interaction.update({ content: 'Resetting the channel…', components: [] });
    await sendLog(client, store, interaction.guildId, {
      title: 'Channel reset',
      description: `<@${interaction.user.id}> reset #${channel.name} by recreating it.`,
      color: 0xED4245
    });
    await recreateChannel(channel, `Hudson /clear-all by ${interaction.user.tag}`);
    return;
  }

  await interaction.update({ content: 'Clearing the entire channel while preserving its ID…', components: [] });
  const result = await clearPreserveChannel(channel);
  await interaction.editReply({ content: `✅ Finished. Deleted **${result.deleted}** messages${result.failed ? `; **${result.failed}** could not be deleted` : ''}.`, components: [] }).catch(() => null);
  await sendLog(client, store, interaction.guildId, {
    title: 'Channel cleared',
    description: `<@${interaction.user.id}> cleared <#${channel.id}> while preserving the channel ID.`,
    color: 0xED4245,
    fields: [{ name: 'Deleted', value: String(result.deleted), inline: true }, { name: 'Failed', value: String(result.failed), inline: true }]
  });
}

async function handleCommand(interaction) {
  if (!interaction.inGuild()) return interaction.reply({ content: 'Use this command inside the Discord server.', ephemeral: true });

  if (interaction.commandName === 'clean') {
    if (await denyUnlessStaff(interaction)) return;
    if (!interaction.channel?.isTextBased() || !interaction.channel.messages) return interaction.reply({ content: 'Use this in a text channel.', ephemeral: true });
    const amount = interaction.options.getInteger('amount', true);
    const includePinned = interaction.options.getBoolean('include-pinned') || false;
    await interaction.deferReply({ ephemeral: true });
    const result = await cleanAmount(interaction.channel, amount, includePinned);
    await interaction.editReply(`✅ Deleted **${result.deleted}** of **${result.found}** found messages${result.failed ? ` (${result.failed} failed)` : ''}.${!includePinned ? ' Pinned messages were kept.' : ''}`);
    return sendLog(client, store, interaction.guildId, {
      title: 'Messages cleaned',
      description: `<@${interaction.user.id}> used /clean in <#${interaction.channelId}>.`,
      fields: [{ name: 'Requested', value: String(amount), inline: true }, { name: 'Deleted', value: String(result.deleted), inline: true }]
    });
  }

  if (interaction.commandName === 'clear-all') return handleClearAllCommand(interaction);

  if (interaction.commandName === 'claim') {
    const orderId = interaction.options.getString('order-id', true);
    const settings = store.getSettings(interaction.guildId);
    const isTicket = interaction.channel?.parentId && settings.ticketCategoryIds.includes(interaction.channel.parentId);
    await interaction.deferReply({ ephemeral: true });
    return processClaim({ interaction, orderId, client, store, publicConfirmation: Boolean(isTicket) });
  }

  if (interaction.commandName === 'ticket-panel') {
    if (await denyUnlessStaff(interaction)) return;
    if (!interaction.channel?.isTextBased()) return interaction.reply({ content: 'Use this in a text channel.', ephemeral: true });
    await postTicketPanel(interaction.channel);
    return interaction.reply({ content: '✅ Ticket menu posted.', ephemeral: true });
  }

  if (interaction.commandName === 'announce') {
    if (await denyUnlessStaff(interaction)) return;
    return handleAnnouncementCommand(interaction, client, store);
  }
  if (interaction.commandName === 'setup') return handleSetup(interaction);
  if (interaction.commandName === 'automod') return handleAutomodCommand(interaction);
}

function startWebServer() {
  const port = Number(process.env.WEB_PORT || 3000);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, discordReady: client.isReady() }));
    }
    res.writeHead(404);
    return res.end('Not found');
  });
  server.listen(port, () => console.log(`Health server listening on port ${port}.`));
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  client.user.setActivity('TheHudsonShop.com', { type: ActivityType.Watching });
  startAnnouncementScheduler(client, store);
  for (const guildId of client.guilds.cache.keys()) await registerGuildCommands(guildId);
});

client.on('guildCreate', (guild) => registerGuildCommands(guild.id));
client.on('channelCreate', (channel) => onTicketChannelCreated(channel, store));
client.on('messageCreate', (message) => handleAutoMod(message, client, store).catch((err) => console.error('[automod]', err)));

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('hudson_clear_')) return await handleClearButton(interaction);
      if (interaction.customId.startsWith('hudson_ticket_')) return await handleTicketButton(interaction, store);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('hudson_')) return await handleTicketModal(interaction, client, store);
  } catch (err) {
    console.error('[interaction]', err);
    const payload = { content: 'Something went wrong while running that action. Check the bot console/log channel for details.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

(async () => {
  await store.init();
  startWebServer();
  await client.login(process.env.DISCORD_TOKEN);
})();
