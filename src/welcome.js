const { EmbedBuilder, MessageType } = require('discord.js');

const recentWelcomes = new Map();

function render(template, member) {
  return String(template || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayName}', member.displayName || member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{memberCount}', String(member.guild.memberCount));
}

function markOnce(member) {
  const key = `${member.guild.id}:${member.id}`;
  const now = Date.now();
  const previous = recentWelcomes.get(key) || 0;
  if (now - previous < 15_000) return false;
  recentWelcomes.set(key, now);
  if (recentWelcomes.size > 1000) {
    for (const [k, t] of recentWelcomes) if (now - t > 60_000) recentWelcomes.delete(k);
  }
  return true;
}

async function sendWelcome(member, store, { force = false, channelOverride = null } = {}) {
  const settings = store.getSettings(member.guild.id);
  const welcome = settings.welcome || {};
  if (!force && !welcome.enabled) return false;
  if (!force && !markOnce(member)) return false;

  const channelId = channelOverride || welcome.channelId;
  if (!channelId) return false;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const embed = new EmbedBuilder()
    .setColor(0x7628BE)
    .setTitle(render(welcome.title || 'Welcome to {server}!', member).slice(0, 256))
    .setDescription(render(welcome.message || 'Welcome {user}!', member).slice(0, 4000))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp();

  await channel.send({
    content: `<@${member.id}> has joined the server!`,
    embeds: [embed],
    allowedMentions: { users: [member.id] }
  });
  return true;
}

async function handleJoinSystemMessage(message, store) {
  if (!message.guild || message.type !== MessageType.UserJoin || !message.author || message.author.bot) return;
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member) await sendWelcome(member, store).catch((err) => console.error('[welcome-system]', err.message));
}

module.exports = { sendWelcome, handleJoinSystemMessage, render };
