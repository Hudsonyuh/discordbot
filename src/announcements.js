const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const { sendLog } = require('./logger');
const locks = new Set();
const HOUR = 3_600_000;

function announcementPayload(message, pingEveryone) {
  return { content: `${pingEveryone ? '@everyone\n' : ''}${message}`, allowedMentions: pingEveryone ? { parse: ['everyone'] } : { parse: [] } };
}
function assertChannel(channel, ping) {
  if (!channel?.isTextBased() || !channel.send) throw new Error('The announcement channel is unavailable.');
  const required = [P.ViewChannel, P.SendMessages];
  if (ping) required.push(P.MentionEveryone);
  if (!channel.permissionsFor(channel.guild.members.me)?.has(required)) throw new Error('I need View Channel and Send Messages in the target channel, plus Mention Everyone for pings.');
}
async function sendAnnouncement(channel, message, ping) {
  assertChannel(channel, ping);
  return channel.send(announcementPayload(message, ping));
}
async function withScheduleLock(guildId, id, action) {
  const key = `${guildId}:${id}`;
  if (locks.has(key)) throw new Error('This schedule is currently sending or being changed. Try again shortly.');
  locks.add(key);
  try { return await action(); } finally { locks.delete(key); }
}
async function handleAnnouncementCommand(interaction, client, store) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  await interaction.deferReply({ ephemeral: true });
  try {
    if (sub === 'send' || sub === 'schedule') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message', true);
      const ping = interaction.options.getBoolean('ping-everyone') || false;
      if (ping && !interaction.memberPermissions?.has(P.MentionEveryone)) return interaction.editReply('You need Mention Everyone to enable announcement pings.');
      assertChannel(channel, ping);
      if (sub === 'send') {
        await sendAnnouncement(channel, message, ping);
        await interaction.editReply(`Announcement sent in <#${channel.id}>.`);
        return sendLog(client, store, guildId, { title: 'Announcement sent', description: `By <@${interaction.user.id}> in <#${channel.id}>.` });
      }
      if (store.getAnnouncements(guildId).length >= 100) return interaction.editReply('The server limit is 100 schedules. Remove unused schedules first.');
      const hours = interaction.options.getInteger('hours', true);
      const sendNow = interaction.options.getBoolean('send-now') || false;
      const entry = await store.addAnnouncement(guildId, {
        channelId: channel.id, message, pingEveryone: ping, intervalHours: hours,
        enabled: true, failures: 0, sentCount: 0, createdBy: interaction.user.id,
        createdAt: new Date().toISOString(), nextRunAt: Date.now() + (sendNow ? 0 : hours * HOUR)
      });
      return interaction.editReply(`Scheduled **${entry.id}** in <#${channel.id}> every **${hours}h**, repeating until paused or removed.${sendNow ? ' First send is due within 30 seconds.' : ''}`);
    }
    if (sub === 'list') {
      const entries = store.getAnnouncements(guildId);
      const pages = Math.max(1, Math.ceil(entries.length / 8));
      const page = Math.min(interaction.options.getInteger('page') || 1, pages);
      const lines = entries.slice((page - 1) * 8, page * 8).map(a => `**${a.id}** • <#${a.channelId}> • ${a.intervalHours}h • ${a.enabled === false ? 'PAUSED' : `next <t:${Math.floor(a.nextRunAt / 1000)}:R>`}\n${a.message.slice(0, 150)}\nSent: ${a.sentCount || 0}${a.lastError ? ` • Error: ${a.lastError.slice(0, 120)}` : ''}`);
      const embed = new EmbedBuilder().setColor(0x7628BE).setTitle(`Recurring announcements • ${page}/${pages}`).setDescription(lines.join('\n\n') || 'No recurring announcements. Use /announce schedule.');
      return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    const id = interaction.options.getString('id', true).toUpperCase();
    return await withScheduleLock(guildId, id, async () => {
      const entry = store.getAnnouncements(guildId).find(a => a.id === id);
      if (!entry) return interaction.editReply('Schedule not found. Use /announce list.');
      if (sub === 'remove') {
        await store.removeAnnouncement(guildId, id);
        return interaction.editReply(`Removed schedule **${id}**.`);
      }
      const patch = {};
      if (sub === 'pause') patch.enabled = false;
      if (sub === 'resume') Object.assign(patch, { enabled: true, failures: 0, lastError: null, nextRunAt: Date.now() + entry.intervalHours * HOUR });
      if (sub === 'edit') {
        const message = interaction.options.getString('message');
        const hours = interaction.options.getInteger('hours');
        const channel = interaction.options.getChannel('channel');
        const ping = interaction.options.getBoolean('ping-everyone');
        if (message !== null) patch.message = message;
        if (hours !== null) Object.assign(patch, { intervalHours: hours, nextRunAt: Date.now() + hours * HOUR });
        if (channel) patch.channelId = channel.id;
        if (ping !== null) patch.pingEveryone = ping;
        if (!Object.keys(patch).length) return interaction.editReply('Choose at least one field to edit.');
      }
      if (sub === 'resume' || sub === 'edit') {
        const ping = patch.pingEveryone ?? entry.pingEveryone;
        if (ping && !interaction.memberPermissions?.has(P.MentionEveryone)) return interaction.editReply('You need Mention Everyone to edit or resume a schedule with pings.');
        const channel = await client.channels.fetch(patch.channelId || entry.channelId);
        assertChannel(channel, ping);
      }
      await store.updateAnnouncement(guildId, id, patch);
      return interaction.editReply(`Schedule **${id}** ${sub === 'pause' ? 'paused' : sub === 'resume' ? 'resumed; the next send is one interval from now' : 'updated'}.`);
    });
  } catch (error) {
    return interaction.editReply({ content: `Announcement action failed: ${error.message}`.slice(0, 1900), allowedMentions: { parse: [] } });
  }
}

function createAnnouncementScheduler(client, store, now = Date.now) {
  let running = false;
  return async function tick() {
    if (running || !client.isReady()) return;
    running = true;
    try {
      for (const [guildId, guildData] of Object.entries(store.data.guilds || {})) {
        if (!client.guilds.cache.has(guildId)) continue;
        for (const snapshot of Object.values(guildData.announcements || {})) {
          if (snapshot.enabled === false || snapshot.nextRunAt > now() || locks.has(`${guildId}:${snapshot.id}`)) continue;
          await withScheduleLock(guildId, snapshot.id, async () => {
            const entry = store.getAnnouncements(guildId).find(a => a.id === snapshot.id);
            if (!entry || entry.enabled === false || entry.nextRunAt > now()) return;
            const interval = Number(entry.intervalHours) * HOUR;
            if (!Number.isFinite(interval) || interval < HOUR || !Number.isFinite(entry.nextRunAt)) {
              await store.updateAnnouncement(guildId, entry.id, { enabled: false, lastError: 'Invalid schedule; edit its interval before resuming.' });
              return;
            }
            const time = now();
            const nextRunAt = entry.nextRunAt + (Math.floor((time - entry.nextRunAt) / interval) + 1) * interval;
            // Persist the reservation before sending: a restart cannot replay a due send.
            await store.updateAnnouncement(guildId, entry.id, { nextRunAt, lastAttemptAt: time });
            let sendError;
            try {
              const channel = await client.channels.fetch(entry.channelId);
              if (channel?.guild?.id !== guildId) throw new Error('Announcement channel belongs to another server.');
              await sendAnnouncement(channel, entry.message, entry.pingEveryone);
            } catch (error) { sendError = error; }
            if (!sendError) {
              await store.updateAnnouncement(guildId, entry.id, { failures: 0, lastError: null, lastSentAt: time, sentCount: (entry.sentCount || 0) + 1 });
              return;
            }
            const failures = (entry.failures || 0) + 1;
            const paused = failures >= 5;
            await store.updateAnnouncement(guildId, entry.id, {
              failures, enabled: !paused, lastError: String(sendError.message).slice(0, 250),
              nextRunAt: time + Math.min(60, 2 ** failures) * 60_000
            });
            console.error(`[announcement ${entry.id}]`, sendError.message);
            if (paused) await sendLog(client, store, guildId, { title: 'Announcement paused after repeated failures', description: `Schedule ${entry.id} could not send. Check /announce list, fix the channel permissions, then /announce resume.` });
          }).catch(error => console.error(`[announcement ${snapshot.id}]`, error.message));
        }
      }
    } finally { running = false; }
  };
}
function startAnnouncementScheduler(client, store) {
  const tick = createAnnouncementScheduler(client, store);
  const run = () => tick().catch(error => console.error('[scheduler]', error.message));
  const timer = setInterval(run, 30_000); timer.unref();
  const initial = setTimeout(run, 5_000); initial.unref();
  return () => { clearInterval(timer); clearTimeout(initial); };
}
module.exports = { handleAnnouncementCommand, startAnnouncementScheduler, createAnnouncementScheduler, announcementPayload };
