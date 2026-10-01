const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType } = require('discord.js');
const { cleanAmount, clearPreserveChannel, withChannelJob, recreateChannel } = require('../src/cleaner');
function fixture(count, old = false) {
  const messages = new Collection();
  let bulk = 0, single = 0;
  for (let i = count; i >= 1; i--) {
    const id = String(i);
    messages.set(id, { id, pinned: i === count, createdTimestamp: Date.now() - (old ? 20 * 86400000 : 10000), delete: async () => { single++; messages.delete(id); } });
  }
  const channel = {
    id: `test-${count}-${old}`, type: ChannelType.GuildText,
    guild: { members: { me: {} } }, isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async ({ before }) => new Collection([...messages].filter(([id]) => BigInt(id) < BigInt(before)).slice(0, 100)) },
    bulkDelete: async ids => { bulk++; const result = new Collection(); for (const id of ids) { result.set(id, messages.get(id)); messages.delete(id); } return result; }
  };
  return { channel, messages, counts: () => ({ bulk, single }) };
}
test('clean respects amount, keeps pins, and batches recent messages', async () => {
  const f = fixture(220);
  const result = await cleanAmount(f.channel, 150);
  assert.equal(result.deleted, 150); assert.equal(f.messages.size, 70);
  assert.equal(f.messages.has('220'), true);
  assert.equal(f.counts().bulk, 2);
});
test('old messages use individual deletes', async () => {
  const f = fixture(9, true);
  const result = await cleanAmount(f.channel, 9, true);
  assert.equal(result.deleted, 9); assert.deepEqual(f.counts(), { bulk: 0, single: 9 });
});
test('clear advances past failures and leaves newly sent messages alone', async () => {
  const f = fixture(120, true);
  f.messages.get('119').delete = async () => { throw new Error('cannot delete'); };
  const fetch = f.channel.messages.fetch;
  let calls = 0;
  f.channel.messages.fetch = async options => {
    const batch = await fetch(options);
    if (++calls === 1) f.messages.set('9999999999999999999', { id: '9999999999999999999' });
    return batch;
  };
  const result = await clearPreserveChannel(f.channel);
  assert.equal(result.deleted, 119); assert.equal(result.failed, 1);
  assert.equal(calls, 2); assert.equal(f.messages.size, 2);
});
test('overlapping jobs are refused and locks release after failure', async () => {
  let release;
  const first = withChannelJob('locked', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(withChannelJob('locked', async () => {}), /already running/);
  release(); await first;
  await assert.rejects(withChannelJob('locked', async () => { throw new Error('failure'); }));
  await withChannelJob('locked', async () => {});
});
test('missing bot permissions stop deletion before fetching', async () => {
  const f = fixture(1); f.channel.permissionsFor = () => ({ has: () => false });
  await assert.rejects(cleanAmount(f.channel, 1), /I need/);
  assert.equal(f.messages.size, 1);
});
test('recreation rolls back the clone when deleting the original fails', async () => {
  const f = fixture(1); let rolledBack = false;
  f.channel.clone = async () => ({ setPosition: async () => {}, delete: async () => { rolledBack = true; } });
  f.channel.delete = async () => { throw new Error('original deletion failed'); };
  await assert.rejects(recreateChannel(f.channel, 'test'), /original deletion failed/);
  assert.equal(rolledBack, true);
});
