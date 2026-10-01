const { PermissionFlagsBits } = require('discord.js');
const { sendLog } = require('./logger');

const activity = new Map();
setInterval(() => {
  const cutoff = Date.now() - 20_000;
  for (const [key, entries] of activity) if (!entries.some(entry => entry.t > cutoff)) activity.delete(key);
}, 60_000).unref();
const URL_RE = /https?:\/\/[^\s<>()]+/gi;
const SAFE_MRBEAST_DOMAINS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'instagram.com', 'www.instagram.com', 'tiktok.com', 'www.tiktok.com', 'x.com', 'twitter.com']);

function normalizeDomain(input) {
  return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

function domainMatches(hostname, blocked) {
  const h = hostname.toLowerCase().replace(/^www\./, '');
  return blocked.some((d) => h === d || h.endsWith(`.${d}`));
}

function suspiciousLinkReason(content, blockedDomains) {
  const urls = content.match(URL_RE) || [];
  for (const raw of urls) {
    try {
      const url = new URL(raw.replace(/[),.!?]+$/, ''));
      const host = url.hostname.toLowerCase();
      const normalizedHost = host.replace(/^www\./, '');
      if (domainMatches(host, blockedDomains)) return `Blocked domain: ${normalizedHost}`;

      const full = `${host}${url.pathname}`.toLowerCase();
      const mentionsMrBeast = content.toLowerCase().includes('mrbeast');
      if ((full.includes('mrbeast') || mentionsMrBeast) && !SAFE_MRBEAST_DOMAINS.has(host)) return 'Suspicious MrBeast/giveaway link';
      if (/(steamcomrnunity|stearncommunity|discorcl|dlscord|free-nitro|claim-nitro|nitro-gift|gift-nitro)/i.test(full)) {
        return 'Suspicious impersonation/gift link';
      }
    } catch {}
  }
  return null;
}

function spamReason(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const normalized = message.content.trim().toLowerCase().replace(/\s+/g, ' ');
  const entry = activity.get(key) || [];
  entry.push({ t: now, content: normalized });
  const kept = entry.filter((x) => now - x.t <= 20000).slice(-30);
  activity.set(key, kept);

  const burst = kept.filter((x) => now - x.t <= 7000).length;
  if (burst >= 6) return 'Message spam (6+ messages in 7 seconds)';

  if (normalized.length >= 3) {
    const duplicates = kept.filter((x) => x.content === normalized).length;
    if (duplicates >= 3) return 'Repeated-message spam';
  }
  return null;
}

function isBypassed(message, settings) {
  if (!message.member) return false;
  if (message.member.permissions.has(PermissionFlagsBits.Administrator) || message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (settings.staffRoleId && message.member.roles.cache.has(settings.staffRoleId)) return true;
  return false;
}

async function handleAutoMod(message, client, store) {
  if (!message.guild || message.author.bot || !message.content) return;
  const settings = store.getSettings(message.guild.id);
  if (!settings.automodEnabled || isBypassed(message, settings)) return;

  const lower = message.content.toLowerCase();
  let reason = null;

  const phrase = (settings.blockedPhrases || []).find((p) => p && lower.includes(p.toLowerCase()));
  if (phrase) reason = `Blocked phrase: “${phrase}”`;
  if (!reason) reason = suspiciousLinkReason(message.content, (settings.blockedDomains || []).map(normalizeDomain));
  if (!reason) reason = spamReason(message);
  if (!reason && message.mentions.users.size + message.mentions.roles.size >= 6) reason = 'Mention spam';
  if (!reason) return;

  const removed = await message.delete().then(() => true, () => false);
  await sendLog(client, store, message.guild.id, {
    title: removed ? 'AutoMod removed a message' : 'AutoMod could not remove a flagged message',
    description: reason,
    color: 0xED4245,
    fields: [
      { name: 'User', value: `<@${message.author.id}> (${message.author.id})`, inline: true },
      { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      { name: 'Content', value: (message.content || '(empty)').slice(0, 900) }
    ]
  });
  return true;
}

module.exports = { handleAutoMod, normalizeDomain };
