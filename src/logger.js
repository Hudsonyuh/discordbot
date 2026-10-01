const { EmbedBuilder } = require('discord.js');

async function sendLog(client, store, guildId, { title, description, fields = [], color = 0x5865F2 }) {
  try {
    const settings = store.getSettings(guildId);
    if (!settings.logChannelId) return;
    const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || null)
      .setColor(color)
      .setTimestamp();
    if (fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[log] Failed to send Discord log:', err.message);
  }
}

module.exports = { sendLog };
