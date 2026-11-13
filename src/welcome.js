const { EmbedBuilder, MessageType } = require('discord.js');

const recentWelcomes = new Map();

const JOIN_DM_MESSAGE = [
  '**NEW HERE? CHECK THIS OUT!**',
  '',
  'Hey {user}! Just joined from our YouTube videos? Here\'s what you\'re looking for.',
  '',
  '**🎮 Fortnite Private**',
  'Want access to our **Fortnite Private** menu?',
  '➜ **Get Fortnite Private:** https://thehudsonshop.com/order/fortnite-private',
  '',
  '**🎓 Hudson Academy**',
  'Want to learn how to build your own game menus using AI?',
  '**Hudson Academy** teaches you how to develop your own projects using AI, with access to exclusive prompts, tutorials, and resources.',
  '➜ **Explore Hudson Academy:** https://thehudsonshop.com/academy',
  '',
  '**🛒 More Products**',
  'Looking for something else? Check out our full selection of digital products.',
  '➜ **Browse All Products:** https://thehudsonshop.com/store'
].join('\n');

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

async function sendJoinDm(member) {
  try {
    const content = render(JOIN_DM_MESSAGE, member).slice(0, 1900);
    await member.send({
      content,
      allowedMentions: { users: [member.id] }
    });
    return true;
  } catch (error) {
    // Some users disable DMs from server members/bots. That should never break the join flow.
    console.warn(`[welcome-dm] Could not DM ${member.user?.tag || member.id}: ${error.message}`);
    return false;
  }
}


const dmPreviews = new Map();
const MAX_BULK = 100;
const PREVIEW_LIFETIME_MS = 10 * 60 * 1000;

function getJoinWindow({ hours, sinceDate }, now = new Date()) {
  if ((hours != null) === (sinceDate != null)) throw new Error('Provide either hours or since-date (not both).');
  if (hours != null) {
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error('Hours must be between 1 and 720.');
    return new Date(now.getTime() - hours * 60 * 60 * 1000);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate || '')) throw new Error('Use YYYY-MM-DD for since-date (UTC).');
  const cutoff = new Date(`${sinceDate}T00:00:00.000Z`);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString().slice(0, 10) !== sinceDate || cutoff > now) throw new Error('Choose a real date that is not in the future.');
  if (now.getTime() - cutoff.getTime() > 30 * 24 * 3600 * 1000) throw new Error('Date must be within the last 30 days.');
  return cutoff;
}

function selectJoinedMembers(members, cutoff, now, store, guildId) {
  return [...members.values()]
    .filter(m => !m.user?.bot && m.joinedAt instanceof Date && m.joinedAt >= cutoff && m.joinedAt <= now)
    .filter(m => !store.hasWelcomeDmSent(guildId, m.id))
    .sort((a,b) => a.joinedAt - b.joinedAt);
}

async function fetchJoinCandidates(guild, fetchMembers = () => guild.members.fetch(), delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  // Discord gateway member requests may be throttled (opcode 8). Wait for
  // Discord's suggested retry window instead of misleadingly reporting missing intents.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchMembers();
    } catch (error) {
      const message = String(error?.message || '');
      const match = message.match(/retry after\s+(\d+(?:\.\d+)?)\s+seconds?/i);
      if (!/rate limited|retry after/i.test(message) || attempt === 2) throw error;
      const retryMs = match ? Number(match[1]) * 1000 : 15_000;
      await delay(Math.min(60_000, Math.max(1_000, retryMs + 1500)));
    }
  }
}

async function previewJoinDms(interaction, store) {
  await interaction.deferReply({ ephemeral: true });
  let cutoff;
  try {
    cutoff = getJoinWindow({
      hours: interaction.options.getInteger('hours'),
      sinceDate: interaction.options.getString('since-date')
    });
  } catch (error) {
    return interaction.editReply(error.message);
  }

  let members;
  try {
    members = await fetchJoinCandidates(interaction.guild);
  } catch (error) {
    console.error('[welcome-bulk] Cannot fetch members:', error.message);
    const message = /4014|disallowed intent|missing access|missing permissions|privileged intent/i.test(error.message)
      ? 'Cannot retrieve members. Enable Server Members Intent in the Discord Developer Portal (Bot settings). Railway ENABLE_MEMBER_INTENT must also be true.'
      : 'Discord could not retrieve members right now. Try again shortly; if this continues, check Railway logs for the specific Discord error.';
    return interaction.editReply(message);
  }
  const now = new Date();
  const matches = selectJoinedMembers(members, cutoff, now, store, interaction.guildId);
  if (!matches.length) return interaction.editReply('No eligible members found in that window who have not already been sent a recorded welcome DM.');
  if (matches.length > MAX_BULK) return interaction.editReply(`Found **${matches.length}** eligible members. This command is limited to ${MAX_BULK} per batch to protect Discord rate limits. Use a narrower window.`);

  const token = require('node:crypto').randomBytes(4).toString('hex').toUpperCase();
  for (const [key, state] of dmPreviews) if (state.expiresAt < Date.now()) dmPreviews.delete(key);
  dmPreviews.set(`${interaction.guildId}:${interaction.user.id}`, {
    token, userIds: matches.map(m => m.id), expiresAt: Date.now() + PREVIEW_LIFETIME_MS
  });
  return interaction.editReply(
    `**Welcome DM preview**\nWindow: <t:${Math.floor(cutoff.getTime()/1000)}:F> → now\nEligible members: **${matches.length}**\nAlready successfully DMed members are excluded when recorded.\n\nRun **/welcome send-confirm code:${token}** within 10 minutes to DM this exact group. No messages have been sent yet.`
  );
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function confirmJoinDms(interaction, store, client, sendLog) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const state = dmPreviews.get(key);
  const token = String(interaction.options.getString('code', true)).trim().toUpperCase();
  if (!state || state.token !== token || state.expiresAt < Date.now()) {
    return interaction.reply({ content: 'No matching active preview. Run /welcome send first.', ephemeral: true });
  }
  dmPreviews.delete(key); // prevent double-submit
  await interaction.deferReply({ ephemeral: true });
  let sent = 0, failed = 0, skipped = 0;
  for (const userId of state.userIds) {
    try {
      // A member might leave, rejoin, or receive a welcome DM after the preview.
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member || store.hasWelcomeDmSent(interaction.guildId, userId)) { skipped++; continue; }
      const ok = await sendJoinDm(member);
      if (ok) {
        sent++;
        await store.markWelcomeDmSent(interaction.guildId, userId);
      } else failed++;
    } catch (error) {
      failed++;
      console.error('[welcome-bulk] Recipient failed:', error.message);
    }
    await wait(1200);
  }
  await sendLog(client, store, interaction.guildId, {
    title: 'Welcome DM batch completed',
    description: `Started by <@${interaction.user.id}>. Sent **${sent}**, failed **${failed}**, skipped **${skipped}**.`,
    color: failed ? 0xFEE75C : 0x57F287
  });
  return interaction.editReply(`Batch complete: **${sent} sent**, **${failed} failed**, **${skipped} skipped**. A summary was sent to server logs.`);
}

async function handleJoinSystemMessage(message, store) {
  if (!message.guild || message.type !== MessageType.UserJoin || !message.author || message.author.bot) return;
  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member) await sendWelcome(member, store).catch((err) => console.error('[welcome-system]', err.message));
}

module.exports = { sendWelcome, sendJoinDm, handleJoinSystemMessage, render, JOIN_DM_MESSAGE, getJoinWindow, selectJoinedMembers, fetchJoinCandidates, previewJoinDms, confirmJoinDms };
