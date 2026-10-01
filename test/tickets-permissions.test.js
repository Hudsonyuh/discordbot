const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { onTicketChannelCreated, isTicketChannel } = require('../src/tickets');
const { hasCommandPermission } = require('../src/permissions');
test('thread name alone does not opt it into ticket integration', () => {
  const channel = { guild: {}, isTextBased: () => true, isThread: () => true, parentId: 'general', parent: { name: 'support-chat' } };
  assert.equal(isTicketChannel(channel, { ticketParentChannelIds: [], ticketCategoryIds: [] }), false);
  assert.equal(isTicketChannel(channel, { ticketParentChannelIds: ['general'] }), true);
});
test('persisted panel prevents history fetch and duplicate posts', async () => {
  let fetched = false;
  const channel = { id: 'ticket', guild: { id: 'guild' }, parentId: 'tickets', isTextBased: () => true, messages: { fetch: async () => { fetched = true; } } };
  const store = { getSettings: () => ({ ticketWelcome: true, ticketCategoryIds: ['tickets'] }), getTicketPanel: () => 'existing-panel' };
  await onTicketChannelCreated(channel, store); assert.equal(fetched, false);
});
test('staff role grants cleanup but cannot grant roles or change settings', () => {
  const interaction = { inGuild: () => true, memberPermissions: { has: () => false }, member: { roles: ['staff'] } };
  assert.equal(hasCommandPermission(interaction, P.ManageMessages, { staffRoleId: 'staff' }), true);
  assert.equal(hasCommandPermission(interaction, P.ManageRoles, { staffRoleId: 'staff' }), false);
  assert.equal(hasCommandPermission(interaction, P.ManageGuild, { staffRoleId: 'staff' }), false);
});
