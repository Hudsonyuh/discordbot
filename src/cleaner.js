const { Collection } = require('discord.js');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const SAFETY_MS = 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchMessages(channel, amount, includePinned = false) {
  const collected = new Collection();
  let before;

  while (collected.size < amount) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;

    for (const msg of batch.values()) {
      if (includePinned || !msg.pinned) collected.set(msg.id, msg);
      if (collected.size >= amount) break;
    }
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return collected;
}

async function deleteMessagesAnyAge(channel, messages, onProgress) {
  const cutoff = Date.now() - TWO_WEEKS_MS + SAFETY_MS;
  const recent = [...messages.values()].filter((m) => m.createdTimestamp > cutoff);
  const old = [...messages.values()].filter((m) => m.createdTimestamp <= cutoff);
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < recent.length; i += 100) {
    const chunk = recent.slice(i, i + 100).map((m) => m.id);
    try {
      const result = await channel.bulkDelete(chunk, true);
      deleted += result.size;
      failed += chunk.length - result.size;
    } catch {
      for (const id of chunk) {
        try {
          const msg = messages.get(id) || await channel.messages.fetch(id);
          await msg.delete();
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    }
    onProgress?.({ deleted, failed, total: messages.size });
  }

  for (const msg of old) {
    try {
      await msg.delete();
      deleted += 1;
    } catch {
      failed += 1;
    }
    onProgress?.({ deleted, failed, total: messages.size });
    await sleep(250);
  }

  return { deleted, failed };
}

async function cleanAmount(channel, amount, includePinned = false, onProgress) {
  const messages = await fetchMessages(channel, amount, includePinned);
  const result = await deleteMessagesAnyAge(channel, messages, onProgress);
  return { ...result, found: messages.size };
}

async function clearPreserveChannel(channel, onProgress) {
  let deleted = 0;
  let failed = 0;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100 });
    if (!batch.size) break;
    const result = await deleteMessagesAnyAge(channel, batch);
    deleted += result.deleted;
    failed += result.failed;
    onProgress?.({ deleted, failed });

    if (result.deleted === 0 && batch.size > 0) break;
  }

  return { deleted, failed };
}

async function recreateChannel(channel, reason) {
  const position = channel.rawPosition;
  const clone = await channel.clone({ reason });
  await clone.setPosition(position).catch(() => null);
  await channel.delete(reason);
  return clone;
}

module.exports = { cleanAmount, clearPreserveChannel, recreateChannel };
