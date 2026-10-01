const { Collection, PermissionFlagsBits, ChannelType } = require('discord.js');
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const activeJobs = new Set();

function assertCleanPermissions(channel, recreate = false) {
  if (!channel?.messages || !channel.isTextBased()) throw new Error('Use this in a message channel.');
  const permissions = channel.permissionsFor(channel.guild.members.me);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages];
  if (recreate) {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Recreate is only available for text and announcement channels.');
    required.push(PermissionFlagsBits.ManageChannels);
  }
  if (!permissions?.has(required)) throw new Error(`I need View Channel, Read Message History, Manage Messages${recreate ? ', and Manage Channels' : ''} here.`);
}

async function withChannelJob(channelId, action) {
  if (activeJobs.has(channelId)) throw new Error('A cleanup is already running in this channel. Wait for it to finish.');
  activeJobs.add(channelId);
  try { return await action(); } finally { activeJobs.delete(channelId); }
}

async function deleteMessagesAnyAge(channel, messages) {
  const counters = { deleted: 0, failed: 0 };
  const cutoff = Date.now() - TWO_WEEKS_MS + 60_000;
  const recent = messages.filter(message => message.createdTimestamp > cutoff);
  const individual = [...messages.filter(message => message.createdTimestamp <= cutoff).values()];
  if (recent.size > 1) {
    try {
      const result = await channel.bulkDelete([...recent.keys()], true);
      counters.deleted += result.size;
      individual.push(...recent.filter(message => !result.has(message.id)).values());
    } catch (error) {
      if ([50001, 50013].includes(error.code)) throw new Error('Discord denied message deletion. Check my channel permissions.');
      individual.push(...recent.values());
    }
  } else individual.push(...recent.values());
  for (let i = 0; i < individual.length; i += 3) {
    const results = await Promise.allSettled(individual.slice(i, i + 3).map(message => message.delete()));
    for (const result of results) {
      if (result.status === 'fulfilled' || result.reason?.code === 10008) counters.deleted++;
      else if ([50001, 50013].includes(result.reason?.code)) throw new Error('Discord denied message deletion. Check my channel permissions.');
      else counters.failed++;
    }
  }
  return counters;
}

async function sweep(channel, amount, includePinned, onProgress) {
  const counters = { deleted: 0, failed: 0, found: 0 };
  // A fixed boundary prevents a busy channel from keeping a cleanup running forever.
  let before = ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();
  while (counters.found < amount) {
    const batch = await channel.messages.fetch({ limit: 100, before, cache: false });
    if (!batch.size) break;
    const oldest = [...batch.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
    if (BigInt(oldest) >= BigInt(before)) break;
    before = oldest;
    const selected = new Collection();
    for (const message of batch.values()) {
      if (includePinned || !message.pinned) selected.set(message.id, message);
      if (counters.found + selected.size >= amount) break;
    }
    const result = await deleteMessagesAnyAge(channel, selected);
    counters.found += selected.size;
    counters.deleted += result.deleted;
    counters.failed += result.failed;
    await onProgress?.(counters);
    if (batch.size < 100) break;
  }
  return counters;
}

async function cleanAmount(channel, amount, includePinned = false, onProgress) {
  assertCleanPermissions(channel);
  return withChannelJob(channel.id, () => sweep(channel, amount, includePinned, onProgress));
}
async function clearPreserveChannel(channel, onProgress) {
  assertCleanPermissions(channel);
  return withChannelJob(channel.id, () => sweep(channel, Infinity, true, onProgress));
}
async function recreateChannel(channel, reason, onClone) {
  assertCleanPermissions(channel, true);
  return withChannelJob(channel.id, async () => {
    const clone = await channel.clone({ reason });
    try {
      await clone.setPosition(channel.rawPosition);
      await channel.delete(reason);
    } catch (error) {
      await clone.delete('Rollback unsuccessful channel reset').catch(() => {});
      throw error;
    }
    await onClone?.(clone);
    return clone;
  });
}
module.exports = { cleanAmount, clearPreserveChannel, recreateChannel, deleteMessagesAnyAge, withChannelJob, assertCleanPermissions };
