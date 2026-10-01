const { toJSON, fromCrossJSON } = require('seroval');

const SHOP_ORIGIN = 'https://thehudsonshop.com';
const PRODUCT_SLUGS = {
  'among us': ['among-us-private'], roblox: ['roblox-private'],
  minecraft: ['minecraft-private'], meccha: ['mecha-private'], discord: ['discord-members']
};
const CONFIRMABLE = new Set(['awaiting_payment', 'payment_claimed', 'under_review', 'more_information_needed', 'delivery_error']);

function discoverFunctions(source) {
  const ids = {};
  for (const name of ['adminListManualOrders', 'adminGetOrderDetail', 'adminConfirmPayment']) {
    const symbol = source.match(new RegExp(`([\\w$]+) as ${name}(?:[,}])`))?.[1];
    const escaped = symbol?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const id = escaped && source.match(new RegExp(`(?:const |,)${escaped}=.{0,250}?\\.handler\\([\\w$]+\\("([a-f0-9]{64})"\\)\\)`))?.[1];
    if (!id) throw new Error('The shop admin API changed. Delivery is stopped until the integration is updated.');
    ids[name] = id;
  }
  if (new Set(Object.values(ids)).size !== 3) throw new Error('Invalid shop admin action mapping.');
  return ids;
}

function validateOrder(order, publicId, product) {
  if (!order || String(order.public_order_id).toUpperCase() !== publicId || !/^[a-f0-9-]{36}$/i.test(order.id)) throw new Error('The shop did not return the exact requested HUD order.');
  if (!PRODUCT_SLUGS[product]?.includes(order.product)) throw new Error('The selected Discord product does not match the website order. Check the order in Payments.');
  const delivered = ['delivered', 'paid'].includes(order.status) && Boolean(order.delivered_at);
  if (!delivered && !CONFIRMABLE.has(order.status)) throw new Error(`This website order cannot be confirmed from its current status (${String(order.status).slice(0, 40)}). Review it in Payments.`);
  if (!Number.isSafeInteger(order.amount_cents) || order.amount_cents <= 0) throw new Error('This order has an invalid amount. Review it in Payments.');
  return { id: order.id, publicId, product, status: order.status, delivered, deliveredAt: order.delivered_at || null };
}

class ShopClient {
  constructor(env = process.env, fetchImpl = fetch) {
    this.enabled = env.SHOP_DELIVERY_ENABLED === 'true';
    this.guildId = env.SHOP_DELIVERY_GUILD_ID || env.DISCORD_GUILD_ID;
    this.email = env.SHOP_ADMIN_EMAIL;
    this.password = env.SHOP_ADMIN_PASSWORD;
    this.authUrl = env.SHOP_SUPABASE_URL;
    this.anonKey = env.SHOP_SUPABASE_ANON_KEY;
    this.fetch = fetchImpl;
    this.session = null;
    this.functionIds = null;
    this.discoveryExpires = 0;
    this.loginPending = null;
    this.discoveryPending = null;
  }

  async request(url, options = {}) {
    // No redirects: credentials must never follow an HTTP redirect to another host.
    return this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25_000) });
  }

  async login() {
    if (this.session && this.session.expiresAt > Date.now() + 60_000) return this.session.token;
    if (this.loginPending) return this.loginPending;
    this.loginPending = (async () => {
      if (!this.email || !this.password || !this.anonKey || !this.authUrl) throw new Error('Shop admin credentials are missing from Railway variables.');
      const url = new URL(this.authUrl);
      if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || !['', '/'].includes(url.pathname)) throw new Error('Invalid shop authentication URL.');
      const response = await this.request(`${url.origin}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: this.anonKey, 'content-type': 'application/json' },
        body: JSON.stringify({ email: this.email, password: this.password })
      });
      if (!response.ok) throw new Error(`Shop sign-in failed (${response.status}). Check the Railway shop credentials.`);
      const session = await response.json();
      if (!session.access_token || !Number.isFinite(session.expires_in)) throw new Error('Shop sign-in returned an invalid session.');
      this.session = { token: session.access_token, expiresAt: Date.now() + session.expires_in * 1000 };
      return this.session.token;
    })();
    try { return await this.loginPending; } finally { this.loginPending = null; }
  }

  async discover() {
    if (this.functionIds && this.discoveryExpires > Date.now()) return this.functionIds;
    if (this.discoveryPending) return this.discoveryPending;
    this.discoveryPending = (async () => {
      const htmlResponse = await this.request(`${SHOP_ORIGIN}/admin`);
      if (!htmlResponse.ok) throw new Error('The shop admin page is unavailable.');
      const html = await htmlResponse.text();
      const adminAsset = html.match(/\/assets\/admin-[a-zA-Z0-9_-]+\.js/)?.[0];
      if (!adminAsset) throw new Error('Cannot locate the shop admin module.');
      const adminResponse = await this.request(SHOP_ORIGIN + adminAsset);
      if (!adminResponse.ok) throw new Error('Cannot load the shop admin module.');
      const admin = await adminResponse.text();
      const functionsAsset = admin.match(/admin-orders\.functions-[a-zA-Z0-9_-]+\.js/)?.[0];
      if (!functionsAsset) throw new Error('Cannot locate the shop payment actions.');
      const functionsResponse = await this.request(`${SHOP_ORIGIN}/assets/${functionsAsset}`);
      if (!functionsResponse.ok) throw new Error('Cannot load the shop payment actions.');
      this.functionIds = discoverFunctions(await functionsResponse.text());
      this.discoveryExpires = Date.now() + 5 * 60_000;
      return this.functionIds;
    })();
    try { return await this.discoveryPending; } finally { this.discoveryPending = null; }
  }

  async call(name, data) {
    if (!this.enabled) throw new Error('Website delivery is disabled.');
    const ids = await this.discover();
    if (!Object.hasOwn(ids, name)) throw new Error('Unsupported shop action.');
    const token = await this.login();
    const response = await this.request(`${SHOP_ORIGIN}/_serverFn/${ids[name]}`, {
      method: 'POST', headers: {
        authorization: `Bearer ${token}`, 'content-type': 'application/json',
        accept: 'application/json', 'x-tsr-serverFn': 'true', origin: SHOP_ORIGIN
      }, body: JSON.stringify(toJSON({ data }))
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) this.session = null;
      if (response.status === 404) this.discoveryExpires = 0;
      throw new Error(`Shop action failed (${response.status}). Check Payments before retrying.`);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected shop response. Check Payments before retrying.');
    const raw = await response.json();
    const decoded = response.headers.get('x-tss-serialized') ? fromCrossJSON(raw, {}) : raw;
    if (decoded?.error || decoded instanceof Error || !decoded || !Object.hasOwn(decoded, 'result')) throw new Error('The shop rejected the action. Review the order and admin access in Payments.');
    return decoded.result;
  }

  async checkConnection() {
    const result = await this.call('adminListManualOrders', { status: 'all', search: 'HUD-BOT-READONLY-PROBE', sort: 'newest' });
    if (!Array.isArray(result?.orders)) throw new Error('Unexpected shop order list.');
    return true;
  }

  async inspectOrder(publicId, product) {
    if (!/^HUD-[A-Z0-9]{6,32}$/.test(publicId)) throw new Error('Website delivery requires the HUD- order reference from the receipt.');
    const result = await this.call('adminListManualOrders', { status: 'all', search: publicId, sort: 'newest' });
    if (!Array.isArray(result?.orders)) throw new Error('Unexpected shop order list.');
    const matches = result.orders.filter(order => String(order.public_order_id).toUpperCase() === publicId);
    if (matches.length !== 1) throw new Error('No unique exact match for that HUD order. Check the reference in Payments.');
    const detail = await this.call('adminGetOrderDetail', { orderId: matches[0].id });
    return validateOrder(detail?.order, publicId, product);
  }

  async confirmOrder(order) {
    // Re-read immediately before the write, including on retries after Discord failures.
    const detail = await this.call('adminGetOrderDetail', { orderId: order.id });
    const fresh = validateOrder(detail?.order, order.publicId, order.product);
    if (fresh.delivered) return fresh;
    // Deliberately no automatic retry for this mutation: it can send email and assign keys.
    await this.call('adminConfirmPayment', { orderId: fresh.id });
    const result = await this.call('adminGetOrderDetail', { orderId: fresh.id });
    const confirmed = validateOrder(result?.order, order.publicId, order.product);
    if (!confirmed.delivered) throw new Error('The shop has not reported completed delivery. Check Payments before retrying.');
    return confirmed;
  }
}

module.exports = { ShopClient, discoverFunctions, validateOrder };
