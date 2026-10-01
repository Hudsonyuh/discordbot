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
const { cleanAmount, clearPreserveChannel, recreateChannel } = require('./cleaner');
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

const store = new DataStore(path.join(__dirname, '..', 'data', 'db.json'));
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
];
if (String(process.env.ENABLE_MEMBER_INTENT).toLowerCase() === 'true') {
  intents.push(GatewayIntentBits.GuildMembers);
}
const client = new Client({ intents });

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

function normalizeProduct(input) {
  return String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const DELIVERY_TUTORIAL_CHANNELS = {
  'among us': '1521722099260194889',
  amongus: '1521722099260194889',
  roblox: '1520614681444618291',
  meccha: '1525293094319296572',
  minecraft: '1519048919034630184',
  discord: '1288443828495323147'
};

const VOUCHES_CHANNEL_ID = '1274623501416005667';
const DOWNLOADS_URL = 'https://thehudsonshop.com/downloads';

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

async function handleDeliver(interaction) {
  if (await denyUnlessStaff(interaction)) return;
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.options.getUser('member', true);
  const rawOrderId = interaction.options.getString('order-id');
  const orderId = rawOrderId ? rawOrderId.trim().toUpperCase() : null;
  const productInput = interaction.options.getString('product', true);
  const product = normalizeProduct(productInput);
  const settings = store.getSettings(interaction.guildId);
  const claim = orderId ? store.getClaim(orderId) : null;

  if (!settings.customerRoleId) return interaction.editReply('❌ Set the Customer role first with **/setup customer-role**.');

  const productRoleId = settings.productRoles?.[product];
  if (!productRoleId) return interaction.editReply(`❌ No Discord role is mapped to **${productInput}**. Use **/product-role set** first.`);

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply('❌ I could not find that member in this server.');

  try {
    const reason = orderId
      ? `Delivered ${productInput} • order ${orderId} • by ${interaction.user.tag}`
      : `Delivered ${productInput} by ${interaction.user.tag}`;
    await member.roles.add([settings.customerRoleId, productRoleId], reason);
  } catch (err) {
    return interaction.editReply(`❌ I couldn't assign the roles. Make sure my bot role is above the Customer and product roles and has **Manage Roles**. Discord error: ${err.message}`);
  }

  if (claim && claim.guildId === interaction.guildId && claim.userId === user.id) {
    await store.updateClaim(orderId, {
      status: 'delivered',
      product,
      customerRoleId: settings.customerRoleId,
      productRoleId,
      deliveredBy: interaction.user.id,
      deliveredAt: new Date().toISOString()
    });
  }

  const deliveryReference = orderId ? ` for order **${orderId}**` : '';
  await interaction.editReply(`✅ **${productInput}** delivered to <@${user.id}>${deliveryReference}. Customer + product roles were assigned.`);

  if (interaction.channel?.isTextBased()) {
    const tutorialChannelId = DELIVERY_TUTORIAL_CHANNELS[product] || null;
    const tutorialText = tutorialChannelId
      ? `If you need further assistance, the **${productInput} tutorial** is available in <#${tutorialChannelId}>.`
      : 'If you need further assistance, contact staff in this ticket.';

    const deliveryFields = [
      {
        name: '1. Check Your Email',
        value: 'Your key was delivered to the email used to purchase. Check that inbox for your key.'
      },
      {
        name: '2. Download the Loader',
        value: `[Download from TheHudsonShop.com](${DOWNLOADS_URL})\nLog into your account with the email used to purchase, then download the loader.`
      },
      {
        name: '3. Please Vouch',
        value: `Once everything is working, please leave a vouch in <#${VOUCHES_CHANNEL_ID}>.`
      },
      {
        name: 'Need Help?',
        value: tutorialText
      }
    ];

    if (orderId) {
      deliveryFields.push({
        name: 'Order ID',
        value: orderId,
        inline: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Payment Accepted / Product Delivered')
      .setDescription(`<@${user.id}>, your **${productInput}** purchase has been delivered.`)
      .addFields(deliveryFields)
      .setFooter({ text: 'The Hudson Shop • Thank you for your purchase!' })
      .setTimestamp();

    const downloadRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(DOWNLOADS_URL)
        .setLabel('Download Loader')
        .setEmoji('⬇️')
    );

    await interaction.channel.send({
      content: `<@${user.id}>`,
      embeds: [embed],
      components: [downloadRow],
      allowedMentions: { users: [user.id] }
    }).catch(() => null);
  }

  const logFields = [
    { name: 'Product', value: productInput, inline: true },
    { name: 'Customer Role', value: `<@&${settings.customerRoleId}>`, inline: true },
    { name: 'Product Role', value: `<@&${productRoleId}>`, inline: true }
  ];
  if (orderId) logFields.push({ name: 'Order ID', value: orderId, inline: true });

  return sendLog(client, store, interaction.guildId, {
    title: 'Product delivered',
    description: `<@${interaction.user.id}> delivered **${productInput}** to <@${user.id}>.`,
    color: 0x57F287,
    fields: logFields
  });
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
  if (interaction.commandName === 'deliver') return handleDeliver(interaction);
  if (interaction.commandName === 'product-role') return handleProductRoleCommand(interaction);
  if (interaction.commandName === 'welcome') return handleWelcomeCommand(interaction);

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
  const port = Number(process.env.PORT || process.env.WEB_PORT || 3000);
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, discordReady: client.isReady() }));
    }
    res.writeHead(404);
    return res.end('Not found');
  });
  server.listen(port, '0.0.0.0', () => console.log(`Health server listening on port ${port}.`));
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}.`);
  client.user.setActivity('TheHudsonShop.com', { type: ActivityType.Watching });
  startAnnouncementScheduler(client, store);
  startTicketWatcher(client, store);
  for (const guildId of client.guilds.cache.keys()) await registerGuildCommands(guildId);
});

client.on('guildCreate', (guild) => registerGuildCommands(guild.id));
client.on('channelCreate', (channel) => onTicketChannelCreated(channel, store));
client.on('threadCreate', (thread) => onTicketChannelCreated(thread, store));
client.on('threadUpdate', (_oldThread, newThread) => onTicketChannelCreated(newThread, store));
client.on('guildMemberAdd', (member) => sendWelcome(member, store).catch((err) => console.error('[welcome]', err.message)));
client.on('messageCreate', async (message) => {
  await handleJoinSystemMessage(message, store).catch((err) => console.error('[welcome-system]', err.message));
  await handleAutoMod(message, client, store).catch((err) => console.error('[automod]', err));
});

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
