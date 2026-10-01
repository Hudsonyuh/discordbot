const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('clean')
      .setDescription('Delete a specific number of messages, including messages older than 14 days.')
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of messages to remove').setMinValue(1).setMaxValue(5000).setRequired(true))
      .addBooleanOption((o) => o.setName('include-pinned').setDescription('Also delete pinned messages (default: no)'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
      .setName('clear-all')
      .setDescription('Completely clear the current text channel.')
      .addStringOption((o) => o
        .setName('method')
        .setDescription('Preserve keeps the same channel ID; recreate is much faster but creates a new channel ID.')
        .setRequired(true)
        .addChoices(
          { name: 'Preserve channel ID (slower)', value: 'preserve' },
          { name: 'Recreate channel (instant full reset)', value: 'recreate' }
        ))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
      .setName('claim')
      .setDescription('Submit your Hudson Shop order ID for staff to review.')
      .addStringOption((o) => o.setName('order-id').setDescription('Your Hudson Shop order ID').setMinLength(3).setMaxLength(100).setRequired(true)),

    new SlashCommandBuilder()
      .setName('deliver')
      .setDescription('Staff: confirm a shop order and deliver access. Verify payment and customer first.')
      .addUserOption((o) => o.setName('member').setDescription('Customer to deliver to').setRequired(true))
      .addStringOption((o) => o
        .setName('product')
        .setDescription('Product being delivered')
        .setRequired(true)
        .addChoices(
          { name: 'Among Us', value: 'Among Us' },
          { name: 'Roblox', value: 'Roblox' },
          { name: 'Meccha', value: 'Meccha' },
          { name: 'Minecraft', value: 'Minecraft' },
          { name: 'Discord', value: 'Discord' }
        ))
      .addStringOption((o) => o
        .setName('order-id')
        .setDescription('Website HUD- order reference (required when website delivery is enabled)')
        .setMinLength(3)
        .setMaxLength(100))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName('product-role')
      .setDescription('Map store products to Discord roles for /deliver.')
      .addSubcommand((s) => s
        .setName('set')
        .setDescription('Map a product name to a Discord role.')
        .addStringOption((o) => o.setName('product').setDescription('Example: Among Us').setRequired(true).setMaxLength(100))
        .addRoleOption((o) => o.setName('role').setDescription('Role to give for this product').setRequired(true)))
      .addSubcommand((s) => s
        .setName('remove')
        .setDescription('Remove a product-to-role mapping.')
        .addStringOption((o) => o.setName('product').setDescription('Product name').setRequired(true).setMaxLength(100)))
      .addSubcommand((s) => s.setName('list').setDescription('Show all configured product roles.'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
      .setName('ticket-panel')
      .setDescription('Post the Hudson Shop Purchase / Support / Claim menu in this channel.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Configure and preview the server welcome message.')
      .addSubcommand((s) => s
        .setName('set')
        .setDescription('Set the welcome channel and custom message.')
        .addChannelOption((o) => o.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Supports {user}, {username}, {displayName}, {server}, {memberCount}').setMaxLength(1500).setRequired(true))
        .addStringOption((o) => o.setName('title').setDescription('Optional embed title with the same placeholders').setMaxLength(200)))
      .addSubcommand((s) => s
        .setName('message')
        .setDescription('Change only the welcome message text.')
        .addStringOption((o) => o.setName('message').setDescription('Supports {user}, {username}, {displayName}, {server}, {memberCount}').setMaxLength(1500).setRequired(true)))
      .addSubcommand((s) => s.setName('test').setDescription('Send a test welcome using your own account.'))
      .addSubcommand((s) => s.setName('off').setDescription('Turn automatic welcomes off.'))
      .addSubcommand((s) => s.setName('status').setDescription('Show the current welcome configuration.'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Send and schedule Hudson Shop announcements.')
      .addSubcommand((s) => s
        .setName('send')
        .setDescription('Send an announcement now.')
        .addChannelOption((o) => o.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Announcement text').setMaxLength(1900).setRequired(true))
        .addBooleanOption((o) => o.setName('ping-everyone').setDescription('Ping @everyone')))
      .addSubcommand((s) => s
        .setName('schedule')
        .setDescription('Repeat an announcement every X hours.')
        .addChannelOption((o) => o.setName('channel').setDescription('Announcement channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addIntegerOption((o) => o.setName('hours').setDescription('Repeat every this many hours').setMinValue(1).setMaxValue(720).setRequired(true))
        .addStringOption((o) => o.setName('message').setDescription('Announcement text').setMaxLength(1900).setRequired(true))
        .addBooleanOption((o) => o.setName('ping-everyone').setDescription('Ping @everyone'))
        .addBooleanOption((o) => o.setName('send-now').setDescription('Also send the first announcement immediately')))
      .addSubcommand((s) => s.setName('list').setDescription('List recurring announcements and delivery errors.')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)))
      .addSubcommand(s => s.setName('pause').setDescription('Pause a schedule without deleting it.')
        .addStringOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true)))
      .addSubcommand(s => s.setName('resume').setDescription('Resume a paused schedule.')
        .addStringOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true)))
      .addSubcommand(s => s.setName('edit').setDescription('Edit a recurring announcement.')
        .addStringOption(o => o.setName('id').setDescription('Schedule ID').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Replacement announcement text').setMaxLength(1900))
        .addIntegerOption(o => o.setName('hours').setDescription('New repeat interval; resets the next send time').setMinValue(1).setMaxValue(720))
        .addChannelOption(o => o.setName('channel').setDescription('Destination').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(o => o.setName('ping-everyone').setDescription('Enable or disable @everyone')))
      .addSubcommand((s) => s
        .setName('remove')
        .setDescription('Stop a recurring announcement.')
        .addStringOption((o) => o.setName('id').setDescription('Schedule ID from /announce list').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Configure the Hudson Shop bot for this server.')
      .addSubcommand(s => s.setName('tutorial-channel').setDescription('Set a product tutorial channel used in deliveries.')
        .addStringOption(o => o.setName('product').setDescription('Product name, e.g. Among Us').setRequired(true).setMaxLength(100))
        .addChannelOption(o => o.setName('channel').setDescription('Tutorial channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
      .addSubcommand(s => s.setName('vouches-channel').setDescription('Set the feedback channel linked in deliveries.')
        .addChannelOption(o => o.setName('channel').setDescription('Vouches channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand((s) => s
        .setName('ticket-category')
        .setDescription('Add a category whose new ticket channels get the Hudson menu.')
        .addChannelOption((o) => o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
      .addSubcommand((s) => s
        .setName('remove-ticket-category')
        .setDescription('Remove a configured ticket category.')
        .addChannelOption((o) => o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
      .addSubcommand((s) => s
        .setName('ticket-parent')
        .setDescription('Treat threads created under this channel as tickets.')
        .addChannelOption((o) => o.setName('channel').setDescription('Purchase/ticket parent channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum).setRequired(true)))
      .addSubcommand((s) => s
        .setName('remove-ticket-parent')
        .setDescription('Remove a configured ticket parent channel.')
        .addChannelOption((o) => o.setName('channel').setDescription('Purchase/ticket parent channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum).setRequired(true)))
      .addSubcommand((s) => s
        .setName('uncategorized-tickets')
        .setDescription('Treat newly-created uncategorized text channels as tickets.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)))
      .addSubcommand((s) => s
        .setName('log-channel')
        .setDescription('Set the private bot/moderation log channel.')
        .addChannelOption((o) => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand((s) => s
        .setName('staff-role')
        .setDescription('Set a role that can use staff bot features and bypass AutoMod.')
        .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)))
      .addSubcommand((s) => s
        .setName('customer-role')
        .setDescription('Set the Customer role that /deliver should give.')
        .addRoleOption((o) => o.setName('role').setDescription('Customer role').setRequired(true)))
      .addSubcommand((s) => s
        .setName('ticket-welcome')
        .setDescription('Turn automatic ticket welcome menus on or off.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)))
      .addSubcommand((s) => s
        .setName('automod')
        .setDescription('Turn Hudson AutoMod on or off.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled').setRequired(true)))
      .addSubcommand((s) => s.setName('status').setDescription('Show the current bot configuration.'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('faq').setDescription('Quick shop help and automatic FAQ replies.')
      .addSubcommand(s => s.setName('ask').setDescription('Ask a common shop question privately.')
        .addStringOption(o => o.setName('question').setDescription('Your question, including the product name').setRequired(true).setMaxLength(400)))
      .addSubcommand(s => s.setName('toggle').setDescription('Staff: enable or disable automatic replies.')
        .addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true)))
      .addSubcommand(s => s.setName('channel').setDescription('Staff: manage the FAQ channel allowlist (empty means all).')
        .addChannelOption(o => o.setName('channel').setDescription('Channel or thread parent').addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildAnnouncement).setRequired(true))
        .addBooleanOption(o => o.setName('enabled').setDescription('Add to or remove from allowlist').setRequired(true)))
      .addSubcommand(s => s.setName('keybind').setDescription('Staff: confirm a product menu key.')
        .addStringOption(o => o.setName('product').setDescription('Product').setRequired(true).addChoices(
          { name: 'Among Us', value: 'among-us' }, { name: 'Roblox', value: 'roblox' }, { name: 'Minecraft', value: 'minecraft' }, { name: 'Meccha', value: 'meccha' }))
        .addStringOption(o => o.setName('key').setDescription('Confirmed key, e.g. Delete').setRequired(true).setMaxLength(60)))
      .addSubcommand(s => s.setName('add').setDescription('Staff: add or replace a custom FAQ answer.')
        .addStringOption(o => o.setName('id').setDescription('Unique ID, e.g. among-us-install').setRequired(true).setMaxLength(32))
        .addStringOption(o => o.setName('title').setDescription('Answer heading').setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName('triggers').setDescription('Specific phrases separated with |').setRequired(true).setMaxLength(300))
        .addStringOption(o => o.setName('answer').setDescription('Verified answer').setRequired(true).setMaxLength(1500)))
      .addSubcommand(s => s.setName('remove').setDescription('Staff: remove a custom FAQ answer.')
        .addStringOption(o => o.setName('id').setDescription('Custom answer ID').setRequired(true)))
      .addSubcommand(s => s.setName('status').setDescription('Staff: show settings and available FAQ topics.')),

    new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Customize scam and spam filtering.')
      .addSubcommand((s) => s
        .setName('add-phrase')
        .setDescription('Delete messages containing an exact scam phrase.')
        .addStringOption((o) => o.setName('phrase').setDescription('Example: check my bio').setMinLength(3).setMaxLength(120).setRequired(true)))
      .addSubcommand((s) => s
        .setName('remove-phrase')
        .setDescription('Remove a blocked phrase.')
        .addStringOption((o) => o.setName('phrase').setDescription('Phrase to remove').setRequired(true)))
      .addSubcommand((s) => s
        .setName('add-domain')
        .setDescription('Block links to a domain.')
        .addStringOption((o) => o.setName('domain').setDescription('Example: fake-giveaway.com').setRequired(true)))
      .addSubcommand((s) => s
        .setName('remove-domain')
        .setDescription('Remove a blocked domain.')
        .addStringOption((o) => o.setName('domain').setDescription('Domain to remove').setRequired(true)))
      .addSubcommand((s) => s.setName('status').setDescription('Show AutoMod rules.'))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ].map((c) => c.toJSON());
}

module.exports = { buildCommands };
