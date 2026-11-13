const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getJoinWindow, selectJoinedMembers } = require('../src/welcome');

test('time windows validate exact dates and hours', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  assert.equal(getJoinWindow({ hours: 24 }, now).toISOString(), '2026-11-11T12:00:00.000Z');
  assert.equal(getJoinWindow({ sinceDate: '2026-11-11' }, now).toISOString(), '2026-11-11T00:00:00.000Z');
  assert.throws(() => getJoinWindow({ hours: 2, sinceDate: '2026-11-11' }, now));
  assert.throws(() => getJoinWindow({}, now));
  assert.throws(() => getJoinWindow({ sinceDate: '2026-02-30' }, now));
  assert.throws(() => getJoinWindow({ hours: 0 }, now));
});
test('selects only new non-bot members not recorded as DMed', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const members = new Map([
    ['new', { id:'new', joinedAt:new Date('2026-11-12T11:00:00Z'), user:{bot:false} }],
    ['old', { id:'old', joinedAt:new Date('2026-11-10T11:00:00Z'), user:{bot:false} }],
    ['bot', { id:'bot', joinedAt:new Date('2026-11-12T11:00:00Z'), user:{bot:true} }],
    ['done', { id:'done', joinedAt:new Date('2026-11-12T11:00:00Z'), user:{bot:false} }]
  ]);
  const store = { hasWelcomeDmSent(_guild, userId) { return userId==='done'; } };
  assert.deepEqual(selectJoinedMembers(members, new Date('2026-11-11T12:00:00Z'), now, store, 'guild').map(m=>m.id), ['new']);
});
