const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchJoinCandidates } = require('../src/welcome');

test('member retrieval retries Discord gateway opcode 8 rate limiting', async () => {
  let attempts = 0, waited = 0;
  const members = new Map([['one', { id: 'one' }]]);
  const result = await fetchJoinCandidates({}, async () => {
    attempts++;
    if (attempts === 1) throw new Error('Request with opcode 8 was rate limited. Retry after 13.024 seconds.');
    return members;
  }, async ms => { waited = ms; });
  assert.strictEqual(result, members);
  assert.equal(attempts, 2);
  assert.ok(waited >= 13024);
});
test('member retrieval does not retry genuine permission errors', async () => {
  let attempts = 0;
  await assert.rejects(() => fetchJoinCandidates({}, async () => {
    attempts++;
    throw new Error('Missing Access');
  }), /Missing Access/);
  assert.equal(attempts, 1);
});
