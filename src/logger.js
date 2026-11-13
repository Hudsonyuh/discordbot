const { EmbedBuilder } = require('discord.js');
const { HUDSON_GUILD_ID, HUDSON_LOG_CHANNEL_ID } = require('./store');

async function sendLog(client, store, guildId, { title, description, fields = [], color = 0x5865F2 }) {
  try {
    const settings = store.getSettings(guildId);
    const channelId = guildId === HUDSON_GUILD_ID ? HUDSON_LOG_CHANNEL_ID : settings.logChannelId;
    if (!channelId) { console.warn(`[log] No log channel configured for guild ${guildId}`); return false; }
    const channel = await client.channels.fetch(channelId).catch(error => { console.warn(`[log] Cannot fetch channel ${channelId}: ${error.message}`); return null; });
    if (!channel?.isTextBased() || channel.guild?.id !== guildId) { console.warn(`[log] Invalid log channel ${channelId} for guild ${guildId}`); return false; }
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || null)
      .setColor(color)
      .setTimestamp();
    if (fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error('[log] Failed to send Discord log:', err.message);
    return false;
  }
}

module.exports = { sendLog };
