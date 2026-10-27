const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchFaq, handleFaqMessage } = require('../src/faq');

const settings = () => ({
  enabled: true,
  channelIds: [],
  cooldownSeconds: 60,
  keybinds: {},
  custom: {}
});

test('confirmed menu keys cover the current products', () => {
  const config = settings();
  assert.match(matchFaq('What key opens Among Us free?', config).answer, /Delete/);
  assert.match(matchFaq('What key opens Among Us private?', config).answer, /Insert/);
  const genericAmongUs = matchFaq('What key opens the Among Us menu?', config).answer;
  assert.match(genericAmongUs, /Free.*Delete/s);
  assert.match(genericAmongUs, /Private.*Insert/s);
  assert.match(matchFaq('What key opens Fortnite?', config).answer, /Insert/);
  assert.match(matchFaq('What key opens FiveM?', config).answer, /Insert/);
  assert.match(matchFaq('What key opens Meccha Chameleon?', config).answer, /Insert/);
  assert.match(matchFaq('What key opens Minecraft?', config).answer, /Insert/);
  assert.match(matchFaq('What key opens Roblox?', config).answer, /Insert/);
  assert.match(matchFaq('What key opens Black Ops 3?', config).answer, /Delete/);
});

test('ambiguous key question asks for product', () => {
  const entry = matchFaq('What key opens the menu?', settings());
  assert.equal(entry.id, 'keybind-clarify');
  assert.match(entry.answer, /reply with just the product name/i);
});

test('always imposter routes users to paid Among Us', () => {
  const entry = matchFaq('How do I always imposter without host?', settings());
  assert.equal(entry.id, 'always-imposter');
  assert.match(entry.answer, /paid\/private Among Us/i);
});

test('website FAQ topics match natural questions', () => {
  const config = settings();
  assert.equal(matchFaq('Where do I find my downloads?', config).id, 'downloads');
  assert.equal(matchFaq('Where is my license key?', config).id, 'delivery');
  assert.equal(matchFaq('How do I look up my order?', config).id, 'orders');
  assert.equal(matchFaq('What should I do if it is not working?', config).id, 'troubleshooting');
  assert.equal(matchFaq('How do I contact support?', config).id, 'support');
  assert.equal(matchFaq('Do you offer refunds?', config).id, 'refunds');
  assert.equal(matchFaq('What payment methods do you accept?', config).id, 'payments');
  assert.equal(matchFaq('How do product updates and compatibility work?', config).id, 'updates');
});

test('ordinary conversation and pasted links do not trigger', () => {
  for (const text of [
    'I downloaded it yesterday',
    'My lifetime plan is great',
    '> how do I download?',
    'https://example.com where is my key?'
  ]) assert.equal(matchFaq(text, settings()), null, text);
});

test('follow-up product-only answer completes key clarification', async () => {
  const config = settings();
  const guildSettings = { faq: config, ticketParentChannelIds: ['purchase'] };
  const store = { getSettings: () => guildSettings };
  const replies = [];
  const message = {
    guild: { id: 'faq-followup' },
    author: { id: 'user' },
    channelId: 'help',
    channel: { name: 'help' },
    content: 'What key opens the menu?',
    reply: async payload => replies.push(payload.embeds[0].data.description)
  };
  assert.equal(await handleFaqMessage(message, store), true);
  message.content = 'Among Us';
  assert.equal(await handleFaqMessage(message, store), true);
  assert.match(replies[1], /Delete/);
  assert.match(replies[1], /Insert/);
});
