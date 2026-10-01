const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAnnouncementScheduler, announcementPayload } = require('../src/announcements');
function fixture() {
  let time = 50_000_000;
  let sends = 0;
  let failure = false;
  const entry = { id: 'ABC', intervalHours: 2, nextRunAt: 1, channelId: 'channel', message: 'Hello' };
  const store = {
    data: { guilds: { guild: { announcements: { ABC: entry } } } },
    getAnnouncements() { return Object.values(this.data.guilds.guild.announcements); },
    getSettings() { return {}; },
    async updateAnnouncement(guildId, id, patch) { Object.assign(entry, patch); }
  };
  const channel = { guild: { id: 'guild', members: { me: {} } }, isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async () => { sends++; if (failure) throw new Error('Missing access'); } };
  const client = { isReady: () => true, guilds: { cache: new Map([['guild', {}]]) }, channels: { fetch: async () => channel } };
  const tick = createAnnouncementScheduler(client, store, () => time);
  return { entry, store, client, tick, sends: () => sends, advance: () => { time = entry.nextRunAt; }, fail: () => { failure = true; } };
}
test('overdue schedules send once without replaying backlog or overlapping ticks', async () => {
  const f = fixture();
  await Promise.all([f.tick(), f.tick(), f.tick()]);
  assert.equal(f.sends(), 1);
  assert.equal(f.entry.nextRunAt, 50_400_001);
  assert.equal(f.entry.sentCount, 1);
  await f.tick(); assert.equal(f.sends(), 1);
  f.advance(); await f.tick(); assert.equal(f.sends(), 2);
});
test('paused schedules and departed guilds never send', async () => {
  const f = fixture(); f.entry.enabled = false; await f.tick(); assert.equal(f.sends(), 0);
  f.entry.enabled = true; f.client.guilds.cache.clear(); await f.tick(); assert.equal(f.sends(), 0);
});
test('failures back off and pause after five attempts', async () => {
  const f = fixture(); f.fail();
  for (let i = 0; i < 5; i++) { await f.tick(); f.advance(); }
  assert.equal(f.entry.enabled, false);
  assert.equal(f.entry.failures, 5);
  assert.match(f.entry.lastError, /Missing access/);
  await f.tick(); assert.equal(f.sends(), 5);
});
test('reservation persistence failure prevents an outbound send', async () => {
  const f = fixture(); f.store.updateAnnouncement = async () => { throw new Error('disk full'); };
  await f.tick(); assert.equal(f.sends(), 0);
});
test('invalid intervals pause instead of spamming', async () => {
  const f = fixture(); f.entry.intervalHours = 0; await f.tick();
  assert.equal(f.sends(), 0); assert.equal(f.entry.enabled, false);
});
test('announcement mentions are opt-in and never include user/role pings', () => {
  assert.deepEqual(announcementPayload('@everyone <@123>', false).allowedMentions, { parse: [] });
  assert.deepEqual(announcementPayload('Hello', true).allowedMentions, { parse: ['everyone'] });
});
