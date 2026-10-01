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
      .setName('ticket-panel')
      .setDescription('Post the Hudson Shop Purchase / Support / Claim menu in this channel.')
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
      .addSubcommand((s) => s.setName('list').setDescription('List recurring announcements.'))
      .addSubcommand((s) => s
        .setName('remove')
        .setDescription('Stop a recurring announcement.')
        .addStringOption((o) => o.setName('id').setDescription('Schedule ID from /announce list').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Configure the Hudson Shop bot for this server.')
      .addSubcommand((s) => s
        .setName('ticket-category')
        .setDescription('Add a category whose new ticket channels get the Hudson welcome menu.')
        .addChannelOption((o) => o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
      .addSubcommand((s) => s
        .setName('remove-ticket-category')
        .setDescription('Remove a configured ticket category.')
        .addChannelOption((o) => o.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
      .addSubcommand((s) => s
        .setName('log-channel')
        .setDescription('Set the private bot/moderation log channel.')
        .addChannelOption((o) => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
      .addSubcommand((s) => s
        .setName('staff-role')
        .setDescription('Set a role that can use staff bot features and bypass AutoMod.')
        .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)))
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
