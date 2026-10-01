const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchFaq, handleFaqMessage } = require('../src/faq');
const settings = () => ({ enabled: true, channelIds: [], cooldownSeconds: 60, keybinds: { 'among-us': 'Delete', roblox: 'Insert' }, custom: {} });
test('keybinds use confirmed product context; ambiguous questions clarify', () => {
  const config = settings();
  assert.match(matchFaq('What key opens the Among Us menu?', config).answer, /Delete/);
  assert.match(matchFaq('What key opens the menu?', config, 'among-us-help').answer, /Delete/);
  assert.match(matchFaq('what key opens the roblox menu?', config, 'among-us-help').answer, /Insert/);
  assert.equal(matchFaq('What key opens the menu?', config).id, 'keybind-clarify');
  assert.equal(matchFaq('What key opens the Among Us or Roblox menu?', config).id, 'keybind-clarify');
  assert.match(matchFaq('How do I open the Minecraft menu?', config).answer, /not confirmed/);
});
test('ordinary conversation, pasted links, and ambiguous topics do not trigger', () => {
  for (const text of ['I downloaded it yesterday', 'My lifetime plan is great', '> how do I download?', 'https://example.com where is my key?', 'Where do I download and get a refund?']) assert.equal(matchFaq(text, settings()), null, text);
});
test('verified FAQ matches and custom phrases respect word boundaries', () => {
  assert.equal(matchFaq('Where do I find my downloads?', settings()).id, 'downloads');
  assert.equal(matchFaq('Where is my license key?', settings()).id, 'delivery');
  assert.equal(matchFaq('Is Among Us working?', settings()).id, 'status');
  const config = settings();
  config.custom.install = { id: 'install', title: 'Install', answer: 'Staff instructions', triggers: ['install among us'] };
  assert.equal(matchFaq('How do I install Among Us?', config).id, 'install');
  assert.notEqual(matchFaq('How do I reinstall Among Us?', config)?.id, 'install');
});
test('toggle, channel scopes, bots, and cooldowns gate automatic replies', async () => {
  const config = settings();
  let replies = 0;
  const store = { getSettings: () => ({ faq: config }) };
  const message = { guild: { id: 'faq-test' }, author: { id: 'user' }, channelId: 'general', channel: { name: 'general' }, content: 'Where do I find my downloads?', reply: async payload => { replies++; assert.equal(payload.allowedMentions.repliedUser, false); } };
  config.enabled = false; assert.equal(await handleFaqMessage(message, store), false);
  config.enabled = true; config.channelIds = ['help']; assert.equal(await handleFaqMessage(message, store), false);
  message.channel.parentId = 'help'; assert.equal(await handleFaqMessage(message, store), true);
  assert.equal(await handleFaqMessage(message, store), false);
  message.author = { id: 'bot', bot: true }; assert.equal(await handleFaqMessage(message, store), false);
  assert.equal(replies, 1);
});
