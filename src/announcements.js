const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { sendLog } = require('./logger');

function announcementPayload(message, pingEveryone) {
  return {
    content: `${pingEveryone ? '@everyone\n' : ''}${message}`,
    allowedMentions: pingEveryone ? { parse: ['everyone'] } : { parse: [] }
  };
}

function canPingEveryone(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function sendAnnouncement(channel, message, pingEveryone) {
  return channel.send(announcementPayload(message, pingEveryone));
}

async function handleAnnouncementCommand(interaction, client, store) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'send') {
    const channel = interaction.options.getChannel('channel', true);
    const message = interaction.options.getString('message', true);
    const ping = interaction.options.getBoolean('ping-everyone') || false;
    if (ping && !canPingEveryone(interaction)) return interaction.reply({ content: 'You need the **Mention @everyone** permission to create an @everyone announcement.', ephemeral: true });
    await sendAnnouncement(channel, message, ping);
    await interaction.reply({ content: `✅ Announcement sent in <#${channel.id}>.`, ephemeral: true });
    return sendLog(client, store, interaction.guildId, { title: 'Announcement sent', description: `By <@${interaction.user.id}> in <#${channel.id}>${ping ? ' with @everyone' : ''}.` });
  }

  if (sub === 'schedule') {
    const channel = interaction.options.getChannel('channel', true);
    const hours = interaction.options.getInteger('hours', true);
    const message = interaction.options.getString('message', true);
    const ping = interaction.options.getBoolean('ping-everyone') || false;
    const sendNow = interaction.options.getBoolean('send-now') || false;
    if (ping && !canPingEveryone(interaction)) return interaction.reply({ content: 'You need the **Mention @everyone** permission to schedule an @everyone announcement.', ephemeral: true });

    if (sendNow) await sendAnnouncement(channel, message, ping);
    const entry = await store.addAnnouncement(interaction.guildId, {
      channelId: channel.id,
      message,
      pingEveryone: ping,
      intervalHours: hours,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString(),
      nextRunAt: Date.now() + hours * 60 * 60 * 1000
    });
    return interaction.reply({ content: `✅ Scheduled **${entry.id}** in <#${channel.id}> every **${hours} hour${hours === 1 ? '' : 's'}**${ping ? ' with @everyone' : ''}.`, ephemeral: true });
  }

  if (sub === 'list') {
    const entries = store.getAnnouncements(interaction.guildId);
    if (!entries.length) return interaction.reply({ content: 'There are no recurring announcements configured.', ephemeral: true });
    const lines = entries.map((a) => `**${a.id}** • <#${a.channelId}> • every ${a.intervalHours}h${a.pingEveryone ? ' • @everyone' : ''} • next <t:${Math.floor(a.nextRunAt / 1000)}:R>\n${a.message.slice(0, 150)}`);
    const embed = new EmbedBuilder().setColor(0x7628BE).setTitle('Recurring Announcements').setDescription(lines.join('\n\n').slice(0, 4000));
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).toUpperCase();
    const removed = await store.removeAnnouncement(interaction.guildId, id);
    return interaction.reply({ content: removed ? `✅ Removed announcement schedule **${id}**.` : `I couldn't find a schedule with ID **${id}**.`, ephemeral: true });
  }
}

function startAnnouncementScheduler(client, store) {
  let running = false;
  const tick = async () => {
    if (running || !client.isReady()) return;
    running = true;
    try {
      for (const [guildId, guildData] of Object.entries(store.data.guilds || {})) {
        for (const announcement of Object.values(guildData.announcements || {})) {
          if (announcement.nextRunAt > Date.now()) continue;
          const channel = await client.channels.fetch(announcement.channelId).catch(() => null);
          if (channel?.isTextBased()) {
            try {
              await sendAnnouncement(channel, announcement.message, announcement.pingEveryone);
              await store.updateAnnouncement(guildId, announcement.id, { nextRunAt: Date.now() + announcement.intervalHours * 60 * 60 * 1000 });
            } catch (err) {
              console.error(`[announcement ${announcement.id}]`, err.message);
              await store.updateAnnouncement(guildId, announcement.id, { nextRunAt: Date.now() + Math.min(announcement.intervalHours, 1) * 60 * 60 * 1000 });
            }
          } else {
            await store.updateAnnouncement(guildId, announcement.id, { nextRunAt: Date.now() + 60 * 60 * 1000 });
          }
        }
      }
    } finally {
      running = false;
    }
  };
  setInterval(tick, 30_000).unref();
  setTimeout(tick, 5_000).unref();
}

module.exports = { handleAnnouncementCommand, startAnnouncementScheduler };
