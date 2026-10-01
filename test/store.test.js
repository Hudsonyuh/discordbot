const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DataStore } = require('../src/store');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hudson-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new DataStore(path.join(dir, 'db.json'));
  await store.init();
  return store;
}
test('legacy settings migrate without losing customization or sharing defaults', async t => {
  const store = await fixture(t);
  store.data.guilds.a = { settings: { welcome: { channelId: 'welcome', message: 'Hello' } } };
  await store.updateSettings('a', { welcome: { enabled: true } });
  assert.equal(store.getSettings('a').welcome.message, 'Hello');
  assert.equal(store.getSettings('a').welcome.channelId, 'welcome');
  assert.equal(store.getSettings('a').faq.enabled, false);
  store.getSettings('a').faq.channelIds.push('only-a');
  assert.deepEqual(store.getSettings('b').faq.channelIds, []);
  const restarted = new DataStore(store.filePath); await restarted.init();
  assert.equal(restarted.getSettings('a').welcome.enabled, true);
});
test('claims are scoped to guilds, legacy claims survive, concurrent duplicates are refused', async t => {
  const store = await fixture(t);
  store.data.claims.LEGACY = { guildId: 'a', userId: 'owner' };
  assert.equal(store.getClaim('legacy', 'a').userId, 'owner');
  assert.equal(store.getClaim('legacy', 'b'), null);
  const results = await Promise.all([store.claimOrder('ABC123', { guildId: 'a' }), store.claimOrder('ABC123', { guildId: 'a' })]);
  assert.deepEqual(results.map(r => r.ok), [true, false]);
  assert.equal((await store.claimOrder('ABC123', { guildId: 'b' })).ok, true);
  await store.updateClaim('LEGACY', { status: 'delivered' }, 'a');
  assert.equal(store.getClaim('LEGACY', 'a').status, 'delivered');
});
test('write queue recovers after an I/O error and persists the latest snapshot', async t => {
  const store = await fixture(t);
  const correctPath = store.filePath;
  store.filePath = path.join(correctPath, 'invalid', 'db.json');
  await assert.rejects(store.save());
  store.filePath = correctPath;
  await store.updateSettings('a', { staffRoleId: 'staff' });
  assert.equal(JSON.parse(await fs.readFile(correctPath, 'utf8')).guilds.a.settings.staffRoleId, 'staff');
});
test('recreated channel references persist across restart', async t => {
  const store = await fixture(t);
  await store.updateSettings('a', { logChannelId: 'old', welcome: { channelId: 'old' }, faq: { channelIds: ['old'] }, ticketParentChannelIds: ['old'] });
  await store.addAnnouncement('a', { channelId: 'old', intervalHours: 2 });
  await store.setTicketPanel('a', 'old', 'panel');
  await store.remapChannel('a', 'old', 'new');
  const restarted = new DataStore(store.filePath); await restarted.init();
  assert.equal(restarted.getSettings('a').logChannelId, 'new');
  assert.equal(restarted.getSettings('a').welcome.channelId, 'new');
  assert.deepEqual(restarted.getSettings('a').faq.channelIds, ['new']);
  assert.equal(restarted.getAnnouncements('a')[0].channelId, 'new');
  assert.equal(restarted.getTicketPanel('a', 'old'), undefined);
});
test('invalid JSON is not overwritten', async t => {
  const store = await fixture(t);
  await fs.writeFile(store.filePath, '{broken');
  await assert.rejects(new DataStore(store.filePath).init());
  assert.equal(await fs.readFile(store.filePath, 'utf8'), '{broken');
});

test('legacy production data is backed up exactly once before migration', async t => {
  const store = await fixture(t);
  const legacy = JSON.stringify({ guilds: { existing: { settings: { staffRoleId: 'staff' } } }, claims: {} });
  await fs.writeFile(store.filePath, legacy);
  const upgraded = new DataStore(store.filePath); await upgraded.init();
  assert.equal(await fs.readFile(`${store.filePath}.pre-v2.bak`, 'utf8'), legacy);
  assert.equal(upgraded.data.schemaVersion, 2);
  await upgraded.updateSettings('existing', { staffRoleId: 'new-staff' });
  await new DataStore(store.filePath).init();
  assert.equal(await fs.readFile(`${store.filePath}.pre-v2.bak`, 'utf8'), legacy);
});
