const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { createDeliveryHandler } = require('../src/delivery');

function fixture(shop) {
  const claims = {};
  const responses = [];
  let assigned = 0;
  let authority = true;
  const role = { id: 'product-role', managed: false, editable: true, permissions: { has: () => false } };
  const member = { roles: { add: async () => { assigned++; } } };
  const actor = { id: 'staff', roles: { highest: { comparePositionTo: () => 1 } } };
  const store = {
    getSettings: () => ({ customerRoleId: 'customer', productRoles: { 'among us': 'product-role' }, tutorialChannels: {}, vouchesChannelId: null }),
    getClaim: id => claims[id] || null,
    claimOrder: async (id, claim) => { if (claims[id]) return { ok: false }; claims[id] = claim; return { ok: true, claim }; },
    updateClaim: async (id, patch) => { Object.assign(claims[id], patch); }
  };
  const interaction = {
    guildId: 'guild', channelId: 'ticket', user: { id: 'staff', tag: 'staff' },
    inGuild: () => true,
    memberPermissions: { has: p => authority && [P.ManageRoles, P.ManageGuild].includes(p) },
    guild: { ownerId: 'owner', members: { fetch: async id => id === 'staff' ? actor : member }, roles: { fetch: async () => role } },
    options: { getUser: () => ({ id: 'customer' }), getString: name => name === 'order-id' ? 'ORDER-123' : 'Among Us' },
    deferReply: async () => {}, reply: async value => responses.push(value), editReply: async value => responses.push(value),
    channel: { isTextBased: () => true, send: async value => responses.push(value) }
  };
  const handler = createDeliveryHandler({}, store, shop);
  return { handler, interaction, claims, responses, role, actor, member, assigned: () => assigned, deny: () => { authority = false; } };
}
test('delivery creates a durable order reference and refuses a repeat', async () => {
  const f = fixture();
  await f.handler(f.interaction);
  assert.equal(f.assigned(), 1);
  assert.equal(f.claims['ORDER-123'].status, 'delivered');
  assert.equal(f.claims['ORDER-123'].userId, 'customer');
  const publicMessage = f.responses.find(value => value?.embeds);
  assert.equal(JSON.stringify(publicMessage).includes('ORDER-123'), false);
  await f.handler(f.interaction);
  assert.equal(f.assigned(), 1);
  assert.match(f.responses.at(-1), /already marked delivered/);
});
test('delivery rejects another claimant before assigning roles', async () => {
  const f = fixture(); f.claims['ORDER-123'] = { userId: 'someone-else' };
  await f.handler(f.interaction); assert.equal(f.assigned(), 0);
  assert.match(f.responses.at(-1), /different member/);
});
test('delivery rejects privileged roles and roles above the invoking staff member', async () => {
  const f = fixture(); f.role.permissions.has = () => true;
  await f.handler(f.interaction); assert.equal(f.assigned(), 0);
  assert.match(f.responses.at(-1), /administration permissions/);
  f.role.permissions.has = () => false; f.actor.roles.highest.comparePositionTo = () => -1;
  await f.handler(f.interaction); assert.equal(f.assigned(), 0);
  assert.match(f.responses.at(-1), /below your highest role/);
});
test('delivery runtime permission check cannot be bypassed', async () => {
  const f = fixture(); f.deny(); await f.handler(f.interaction);
  assert.equal(f.assigned(), 0);
  assert.match(f.responses.at(-1).content, /required server permission/);
});

test('website failure assigns no roles and an uncertain confirmation cannot be replayed', async () => {
  let attempts = 0;
  const shop = { enabled: true, guildId: 'guild', inspectOrder: async () => ({ id: 'website-order', delivered: false }), confirmOrder: async () => { attempts++; throw new Error('Timeout'); } };
  const f = fixture(shop);
  await f.handler(f.interaction);
  assert.equal(f.assigned(), 0); assert.equal(f.claims['ORDER-123'].websiteDeliveryState, 'uncertain');
  await f.handler(f.interaction);
  assert.equal(attempts, 1); assert.equal(f.assigned(), 0);
});
test('Discord failure after website success can retry without another website confirmation', async () => {
  let confirmations = 0; let delivered = false;
  const order = () => ({ id: 'website-order', delivered, deliveredAt: delivered ? '2026-10-01' : null });
  const shop = { enabled: true, guildId: 'guild', inspectOrder: async () => order(), confirmOrder: async () => { confirmations++; delivered = true; return order(); } };
  const f = fixture(shop);
  const add = f.member.roles.add;
  f.member.roles.add = async () => { throw new Error('Missing permission'); };
  await f.handler(f.interaction);
  assert.equal(f.claims['ORDER-123'].websiteDeliveryState, 'confirmed');
  assert.equal(f.claims['ORDER-123'].status, 'pending');
  f.member.roles.add = add; await f.handler(f.interaction);
  assert.equal(confirmations, 1); assert.equal(f.assigned(), 1);
  assert.equal(f.claims['ORDER-123'].status, 'delivered');
});
test('another Discord guild cannot use the shop admin credentials', async () => {
  let inspected = false;
  const f = fixture({ enabled: true, guildId: 'trusted-guild', inspectOrder: async () => { inspected = true; } });
  await f.handler(f.interaction);
  assert.equal(inspected, false); assert.equal(f.assigned(), 0);
  assert.match(f.responses.at(-1).content, /configured Hudson Shop server/);
});
