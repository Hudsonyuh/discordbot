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
  Routes,
  Events
} = require('discord.js');
const { DataStore } = require('./store');
const { cleanAmount, clearPreserveChannel, recreateChannel, assertCleanPermissions } = require('./cleaner');
const { handleFaqMessage, handleFaqCommand } = require('./faq');
const { requirePermission } = require('./permissions');
const { createDeliveryHandler } = require('./delivery');
const { ShopClient } = require('./shop');
const { handleAutoMod, normalizeDomain } = require('./automod');
const {
  postTicketPanel,
  isTicketChannel,
  onTicketChannelCreated,
  startTicketWatcher,
  handleTicketButton,
  handleTicketModal,
  processClaim
} = require('./tickets');
const { handleAnnouncementCommand, startAnnouncementScheduler } = require('./announcements');
const { sendLog } = require('./logger');
const { buildCommands } = require('./commands');
const { sendWelcome, handleJoinSystemMessage } = require('./welcome');

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const store = new DataStore(path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'db.json'));
const stopTasks = [];
let webServer;
let shuttingDown = false;
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
];
if (String(process.env.ENABLE_MEMBER_INTENT).toLowerCase() === 'true') {
  intents.push(GatewayIntentBits.GuildMembers);
}
const client = new Client({ intents, allowedMentions: { parse: [], repliedUser: false } });
const shop = new ShopClient();
const handleDeliver = createDeliveryHandler(client, store, shop);

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

async function denyUnlessStaff(interaction, permission) {
  const required = permission || ({ clean: PermissionFlagsBits.ManageMessages, 'clear-all': PermissionFlagsBits.ManageChannels, deliver: PermissionFlagsBits.ManageRoles, 'product-role': PermissionFlagsBits.ManageRoles }[interaction.commandName] || PermissionFlagsBits.ManageGuild);
  return !await requirePermission(interaction, required, store);
}

function normalizeProduct(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
}


async function handleSetup(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'tutorial-channel') {
    const product = normalizeProduct(interaction.options.getString('product', true));
    const channel = interaction.options.getChannel('channel', true);
    await store.updateSettings(guildId, { tutorialChannels: { ...store.getSettings(guildId).tutorialChannels, [product]: channel.id } });
    return interaction.reply({ content: `Tutorial for **${product}** set to <#${channel.id}>.`, ephemeral: true });
  }
  if (sub === 'vouches-channel') {
    const channel = interaction.options.getChannel('channel', true);
    await store.updateSettings(guildId, { vouchesChannelId: channel.id });
    return interaction.reply({ content: `Vouches channel set to <#${channel.id}>.`, ephemeral: true });
  }

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
  if (sub === 'ticket-parent') {
    const channel = interaction.options.getChannel('channel', true);
    await store.addTicketParent(guildId, channel.id);
    return interaction.reply({ content: `✅ Threads created under <#${channel.id}> will now receive the Purchase / Support / Claim menu.`, ephemeral: true });
  }
  if (sub === 'remove-ticket-parent') {
    const channel = interaction.options.getChannel('channel', true);
    await store.removeTicketParent(guildId, channel.id);
    return interaction.reply({ content: `✅ Removed <#${channel.id}> as a ticket parent channel.`, ephemeral: true });
  }
  if (sub === 'uncategorized-tickets') {
    const enabled = interaction.options.getBoolean('enabled', true);
    await store.updateSettings(guildId, { uncategorizedTickets: enabled });
    return interaction.reply({ content: `✅ Automatic menus for newly-created uncategorized ticket channels are now **${enabled ? 'ON' : 'OFF'}**.`, ephemeral: true });
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
  if (sub === 'customer-role') {
    const role = interaction.options.getRole('role', true);
    await store.updateSettings(guildId, { customerRoleId: role.id });
    return interaction.reply({ content: `✅ <@&${role.id}> is now the Customer role given by /deliver.`, ephemeral: true });
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
        { name: 'Ticket Categories', value: s.ticketCategoryIds.length ? s.ticketCategoryIds.map((id) => `<#${id}>`).join(', ') : 'None' },
        { name: 'Ticket Parent Channels', value: s.ticketParentChannelIds.length ? s.ticketParentChannelIds.map((id) => `<#${id}>`).join(', ') : 'None' },
        { name: 'Uncategorized Tickets', value: s.uncategorizedTickets ? 'On' : 'Off', inline: true },
        { name: 'Log Channel', value: s.logChannelId ? `<#${s.logChannelId}>` : 'Not set', inline: true },
        { name: 'Staff Role', value: s.staffRoleId ? `<@&${s.staffRoleId}>` : 'Not set', inline: true },
        { name: 'Customer Role', value: s.customerRoleId ? `<@&${s.customerRoleId}>` : 'Not set', inline: true },
        { name: 'Welcome Channel', value: s.welcome?.channelId ? `<#${s.welcome.channelId}>` : 'Not set', inline: true },
        { name: 'Welcome Enabled', value: s.welcome?.enabled ? 'On' : 'Off', inline: true },
        { name: 'AutoMod', value: s.automodEnabled ? 'On' : 'Off', inline: true },
        { name: 'Product Roles', value: Object.entries(s.productRoles || {}).length ? Object.entries(s.productRoles).map(([p, r]) => `• **${p}** → <@&${r}>`).join('\n').slice(0, 1000) : 'None configured' }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleWelcomeCommand(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  const settings = store.getSettings(interaction.guildId);

  if (sub === 'set') {
    const channel = interaction.options.getChannel('channel', true);
    const message = interaction.options.getString('message', true);
    const title = interaction.options.getString('title') || settings.welcome?.title || 'Welcome to {server}!';
    await store.updateSettings(interaction.guildId, { welcome: { ...settings.welcome, enabled: true, channelId: channel.id, message, title } });
    return interaction.reply({ content: `✅ Welcome messages are enabled in <#${channel.id}>. Use **/welcome test** to preview it.`, ephemeral: true });
  }
  if (sub === 'message') {
    const message = interaction.options.getString('message', true);
    await store.updateSettings(interaction.guildId, { welcome: { ...settings.welcome, message } });
    return interaction.reply({ content: '✅ Welcome message updated. Use **/welcome test** to preview it.', ephemeral: true });
  }
  if (sub === 'test') {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channelId = settings.welcome?.channelId || interaction.channelId;
    await sendWelcome(member, store, { force: true, channelOverride: channelId });
    return interaction.reply({ content: `✅ Test welcome sent in <#${channelId}>.`, ephemeral: true });
  }
  if (sub === 'off') {
    await store.updateSettings(interaction.guildId, { welcome: { ...settings.welcome, enabled: false } });
    return interaction.reply({ content: '✅ Automatic welcome messages are off.', ephemeral: true });
  }
  if (sub === 'status') {
    const w = settings.welcome || {};
    const embed = new EmbedBuilder()
      .setColor(0x7628BE)
      .setTitle('Welcome Configuration')
      .addFields(
        { name: 'Enabled', value: w.enabled ? 'Yes' : 'No', inline: true },
        { name: 'Channel', value: w.channelId ? `<#${w.channelId}>` : 'Not set', inline: true },
        { name: 'Title', value: w.title || '(default)' },
        { name: 'Message', value: w.message || '(default)' },
        { name: 'Placeholders', value: '`{user}` `{username}` `{displayName}` `{server}` `{memberCount}`' }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function handleProductRoleCommand(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  const sub = interaction.options.getSubcommand();
  if (sub === 'set') {
    const product = interaction.options.getString('product', true);
    const role = interaction.options.getRole('role', true);
    const key = await store.setProductRole(interaction.guildId, product, role.id);
    return interaction.reply({ content: `✅ **${key}** will give <@&${role.id}> when staff runs /deliver.`, ephemeral: true });
  }
  if (sub === 'remove') {
    const product = interaction.options.getString('product', true);
    const removed = await store.removeProductRole(interaction.guildId, product);
    return interaction.reply({ content: removed ? '✅ Product role mapping removed.' : 'No mapping was found for that product.', ephemeral: true });
  }
  if (sub === 'list') {
    const roles = store.getSettings(interaction.guildId).productRoles || {};
    const entries = Object.entries(roles);
    return interaction.reply({ content: entries.length ? entries.map(([p, r]) => `• **${p}** → <@&${r}>`).join('\n') : 'No product roles are configured yet.', ephemeral: true });
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
  assertCleanPermissions(channel, method === 'recreate');
  const warning = method === 'recreate'
    ? 'This will clone this channel, delete the original, and leave the new channel completely empty. **The channel ID changes, and channel-specific webhooks/integrations may need updating.**'
    : 'This keeps the same channel ID and deletes the entire message history. Old messages are removed individually, so a very large channel can take a while.';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hudson_clear_confirm:${interaction.user.id}:${method}:${Date.now()}`).setLabel('Confirm Clear All').setStyle(ButtonStyle.Danger),
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

  if (await denyUnlessStaff(interaction, PermissionFlagsBits.ManageChannels)) return;
  const createdAt = Number(parts[3]);
  if (!createdAt || Date.now() - createdAt > 120_000) return interaction.update({ content: 'This confirmation expired. Run /clear-all again.', components: [] });

  const method = parts[2];
  if (!['preserve', 'recreate'].includes(method)) return;
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !channel.messages) return interaction.update({ content: 'This channel can no longer be cleared.', components: [] });

  if (method === 'recreate') {
    await interaction.update({ content: 'Resetting the channel…', components: [] });
    const clone = await recreateChannel(channel, `Hudson /clear-all by ${interaction.user.tag}`, newChannel => store.remapChannel(interaction.guildId, channel.id, newChannel.id));
    await interaction.editReply({ content: `Channel reset complete: <#${clone.id}>.`, components: [] }).catch(() => {});
    await sendLog(client, store, interaction.guildId, {
      title: 'Channel reset',
      description: `<@${interaction.user.id}> reset #${channel.name} by recreating it.`,
      color: 0xED4245
    });
    return;
  }

  await interaction.update({ content: 'Clearing the entire channel while preserving its ID…', components: [] });
  const result = await clearPreserveChannel(channel, cleanupProgress(interaction));
  await interaction.editReply({ content: `✅ Finished. Deleted **${result.deleted}** messages${result.failed ? `; **${result.failed}** could not be deleted` : ''}.`, components: [] }).catch(() => null);
  await sendLog(client, store, interaction.guildId, {
    title: 'Channel cleared',
    description: `<@${interaction.user.id}> cleared <#${channel.id}> while preserving the channel ID.`,
    color: 0xED4245,
    fields: [{ name: 'Deleted', value: String(result.deleted), inline: true }, { name: 'Failed', value: String(result.failed), inline: true }]
  });
}

function cleanupProgress(interaction) {
  let lastUpdate = Date.now();
  return async ({ deleted, failed }) => {
    if (Date.now() - lastUpdate < 5000) return;
    lastUpdate = Date.now();
    await interaction.editReply({ content: `Cleaning… **${deleted}** removed; **${failed}** failed. Older messages take longer. Completion is also recorded in the log channel.`, components: [] }).catch(() => {});
  };
}

async function handleCommand(interaction) {
  if (!interaction.inGuild()) return interaction.reply({ content: 'Use this command inside the Discord server.', ephemeral: true });

  if (interaction.commandName === 'clean') {
    if (await denyUnlessStaff(interaction)) return;
    if (!interaction.channel?.isTextBased() || !interaction.channel.messages) return interaction.reply({ content: 'Use this in a text channel.', ephemeral: true });
    const amount = interaction.options.getInteger('amount', true);
    const includePinned = interaction.options.getBoolean('include-pinned') || false;
    await interaction.deferReply({ ephemeral: true });
    const result = await cleanAmount(interaction.channel, amount, includePinned, cleanupProgress(interaction));
    await interaction.editReply(`✅ Deleted **${result.deleted}** of **${result.found}** found messages${result.failed ? ` (${result.failed} failed)` : ''}.${!includePinned ? ' Pinned messages were kept.' : ''}`).catch(() => {});
    return sendLog(client, store, interaction.guildId, {
      title: 'Messages cleaned',
      description: `<@${interaction.user.id}> used /clean in <#${interaction.channelId}>.`,
      fields: [{ name: 'Requested', value: String(amount), inline: true }, { name: 'Deleted', value: String(result.deleted), inline: true }]
    });
  }

  if (interaction.commandName === 'clear-all') return handleClearAllCommand(interaction);
  if (interaction.commandName === 'deliver') return handleDeliver(interaction);
  if (interaction.commandName === 'product-role') return handleProductRoleCommand(interaction);
  if (interaction.commandName === 'welcome') return handleWelcomeCommand(interaction);
  if (interaction.commandName === 'faq') return handleFaqCommand(interaction, store);

  if (interaction.commandName === 'claim') {
    const orderId = interaction.options.getString('order-id', true);
    const settings = store.getSettings(interaction.guildId);
    const ticket = isTicketChannel(interaction.channel, settings);
    await interaction.deferReply({ ephemeral: true });
    return processClaim({ interaction, orderId, client, store, publicConfirmation: ticket });
  }

  if (interaction.commandName === 'ticket-panel') {
    if (await denyUnlessStaff(interaction)) return;
    if (!interaction.channel?.isTextBased()) return interaction.reply({ content: 'Use this in a text channel.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    await postTicketPanel(interaction.channel, store);
    return interaction.editReply({ content: '✅ Ticket menu posted.' });
  }

  if (interaction.commandName === 'announce') {
    if (await denyUnlessStaff(interaction)) return;
    return handleAnnouncementCommand(interaction, client, store);
  }
  if (interaction.commandName === 'setup') return handleSetup(interaction);
  if (interaction.commandName === 'automod') return handleAutomodCommand(interaction);
}

function startWebServer() {
  const port = Number(process.env.PORT || process.env.WEB_PORT || 3000);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const ready = client.isReady() && !shuttingDown;
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: ready, discordReady: client.isReady(), uptimeSeconds: Math.floor(process.uptime()) }));
    }
    res.writeHead(404);
    return res.end('Not found');
  });
  server.listen(port, '0.0.0.0', () => console.log(`Health server listening on port ${port}.`));
  server.on('error', error => { console.error('[health]', error.message); shutdown(1); });
  return server;
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  client.user.setActivity('TheHudsonShop.com', { type: ActivityType.Watching });
  stopTasks.push(startAnnouncementScheduler(client, store), startTicketWatcher(client, store));
  if (process.env.AUTO_REGISTER_COMMANDS !== 'false') {
    for (const guildId of client.guilds.cache.keys()) {
      if (!process.env.DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID === guildId) await registerGuildCommands(guildId);
    }
  }
});

client.on('guildCreate', (guild) => {
  if (process.env.AUTO_REGISTER_COMMANDS !== 'false' && (!process.env.DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID === guild.id)) registerGuildCommands(guild.id);
});
client.on('channelCreate', (channel) => onTicketChannelCreated(channel, store));
client.on('threadCreate', (thread) => onTicketChannelCreated(thread, store));
client.on('threadUpdate', (_oldThread, newThread) => onTicketChannelCreated(newThread, store));
client.on('channelDelete', channel => {
  if (channel.guild && store.getTicketPanel(channel.guild.id, channel.id)) store.setTicketPanel(channel.guild.id, channel.id, null).catch(error => console.error('[ticket-delete]', error.message));
});
client.on('guildMemberAdd', (member) => sendWelcome(member, store).catch((err) => console.error('[welcome]', err.message)));
client.on('messageCreate', async (message) => {
  await handleJoinSystemMessage(message, store).catch((err) => console.error('[welcome-system]', err.message));
  const flagged = await handleAutoMod(message, client, store).catch((err) => { console.error('[automod]', err); return true; });
  if (!flagged) await handleFaqMessage(message, store).catch(err => console.error('[faq]', err.message));
});
client.on('messageUpdate', (_previous, message) => {
  if (!message.partial) handleAutoMod(message, client, store).catch(error => console.error('[automod-edit]', error.message));
});
client.on('error', error => console.error('[discord]', error.message));

client.on('interactionCreate', async (interaction) => {
  try {
    if (shuttingDown) return;
    if (!interaction.inGuild()) return interaction.reply({ content: 'Use this bot inside a server.', ephemeral: true });
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('hudson_clear_')) return await handleClearButton(interaction);
      if (interaction.customId.startsWith('hudson_ticket_')) return await handleTicketButton(interaction, store);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('hudson_')) return await handleTicketModal(interaction, client, store);
  } catch (err) {
    console.error('[interaction]', err);
    const payload = { content: `Action could not finish: ${err.message}`.slice(0, 1900), ephemeral: true, allowedMentions: { parse: [] } };
    if (interaction.deferred) await interaction.editReply({ content: payload.content, components: [], allowedMentions: payload.allowedMentions }).catch(() => null);
    else if (interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopTasks.forEach(stop => stop());
  const deadline = setTimeout(() => process.exit(code || 1), 10_000);
  deadline.unref();
  try {
    await client.destroy();
    await store._writeQueue;
    if (webServer) await new Promise(resolve => webServer.close(resolve));
  } catch (error) { console.error('[shutdown]', error.message); code = 1; }
  process.exit(code);
}
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
process.on('uncaughtException', err => { console.error('[uncaughtException]', err); shutdown(1); });

(async () => {
  await store.init();
  if (shop.enabled) {
    shop.checkConnection().then(() => console.log('[shop] Admin connection verified (read-only).'))
      .catch(error => console.error('[shop] Connection check failed:', error.message));
  }
  webServer = startWebServer();
  await client.login(process.env.DISCORD_TOKEN);
})().catch(error => { console.error('[startup]', error.message); shutdown(1); });
