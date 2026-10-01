const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fromJSON, toCrossJSONAsync } = require('seroval');
const { ShopClient, discoverFunctions, validateOrder } = require('../src/shop');

const ids = { adminListManualOrders: 'a'.repeat(64), adminGetOrderDetail: 'b'.repeat(64), adminConfirmPayment: 'c'.repeat(64) };
const moduleSource = `const n=d({method:"POST"}).middleware([e]).handler(a("${ids.adminListManualOrders}")),m=d({method:"POST"}).middleware([e]).handler(a("${ids.adminGetOrderDetail}")),t=d({method:"POST"}).middleware([e]).handler(a("${ids.adminConfirmPayment}"));export{t as adminConfirmPayment,m as adminGetOrderDetail,n as adminListManualOrders};`;
const baseOrder = () => ({ id: '12345678-1234-1234-1234-123456789abc', public_order_id: 'HUD-ABC123', product: 'among-us-private', status: 'payment_claimed', delivered_at: null, amount_cents: 1499 });
const env = { SHOP_DELIVERY_ENABLED: 'true', DISCORD_GUILD_ID: 'guild', SHOP_ADMIN_EMAIL: 'test@example.com', SHOP_ADMIN_PASSWORD: 'fixture-password', SHOP_SUPABASE_URL: 'https://fixture.supabase.co', SHOP_SUPABASE_ANON_KEY: 'fixture-public-key' };

test('discovers the exact admin actions and fails closed if the site changes', () => {
  assert.deepEqual(discoverFunctions(moduleSource), ids);
  assert.throws(() => discoverFunctions(moduleSource.replace('adminConfirmPayment', 'renamedFunction')), /API changed/);
});
test('orders require exact reference, correct product, valid amount, and allowed state', () => {
  const order = baseOrder();
  assert.equal(validateOrder(order, 'HUD-ABC123', 'among us').delivered, false);
  assert.throws(() => validateOrder(order, 'HUD-OTHER1', 'among us'), /exact requested/);
  assert.throws(() => validateOrder(order, 'HUD-ABC123', 'minecraft'), /does not match/);
  assert.throws(() => validateOrder({ ...order, status: 'rejected' }, 'HUD-ABC123', 'among us'), /current status/);
  assert.throws(() => validateOrder({ ...order, amount_cents: 0 }, 'HUD-ABC123', 'among us'), /invalid amount/);
});
test('uses real serialization, authenticates, confirms once, and reconciles an already delivered order', async () => {
  const order = baseOrder(); let confirmations = 0, logins = 0;
  const client = new ShopClient(env, async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/admin')) return new Response('/assets/admin-FIXTURE.js');
    if (url.endsWith('/assets/admin-FIXTURE.js')) return new Response('import("./admin-orders.functions-FIXTURE.js")');
    if (url.endsWith('/assets/admin-orders.functions-FIXTURE.js')) return new Response(moduleSource);
    if (url.includes('/auth/v1/token')) { logins++; return Response.json({ access_token: 'fixture-token', expires_in: 3600 }); }
    assert.equal(new URL(url).origin, 'https://thehudsonshop.com');
    assert.equal(options.headers.authorization, 'Bearer fixture-token');
    const { data } = fromJSON(JSON.parse(options.body));
    let result;
    if (url.endsWith(ids.adminListManualOrders)) {
      assert.equal(data.search, 'HUD-ABC123'); result = { orders: [order] };
    } else if (url.endsWith(ids.adminGetOrderDetail)) result = { order };
    else if (url.endsWith(ids.adminConfirmPayment)) {
      assert.deepEqual(data, { orderId: order.id }); confirmations++;
      order.status = 'delivered'; order.delivered_at = '2026-10-01T00:00:00Z'; result = { success: true };
    } else throw new Error('Unknown endpoint');
    return Response.json(await toCrossJSONAsync({ result, error: undefined, context: {} }), { headers: { 'x-tss-serialized': 'true' } });
  });
  const inspected = await client.inspectOrder('HUD-ABC123', 'among us');
  assert.equal((await client.confirmOrder(inspected)).delivered, true);
  assert.equal((await client.confirmOrder(inspected)).delivered, true);
  assert.equal(confirmations, 1); assert.equal(logins, 1);
});
test('uncertain mutation is never retried automatically', async () => {
  const client = new ShopClient(env); let writes = 0;
  client.call = async name => {
    if (name === 'adminGetOrderDetail') return { order: baseOrder() };
    if (name === 'adminConfirmPayment') { writes++; throw new Error('Timeout'); }
    throw new Error('Unexpected call');
  };
  await assert.rejects(client.confirmOrder(validateOrder(baseOrder(), 'HUD-ABC123', 'among us')), /Timeout/);
  assert.equal(writes, 1);
});
test('failed or malformed admin responses cannot be treated as success', async () => {
  const client = new ShopClient(env, async () => Response.json({ message: 'not an admin' }, { status: 403 }));
  client.discover = async () => ids; client.login = async () => 'fixture-token';
  await assert.rejects(client.checkConnection(), /403/);
  client.fetch = async () => Response.json({ somethingElse: true });
  await assert.rejects(client.checkConnection(), /rejected/);
});
