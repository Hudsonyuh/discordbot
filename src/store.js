const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { constants } = require('node:fs');

const DEFAULT_SETTINGS = {
  ticketCategoryIds: [],
  ticketParentChannelIds: [],
  uncategorizedTickets: false,
  logChannelId: null,
  staffRoleId: null,
  customerRoleId: null,
  productRoles: {},
  tutorialChannels: {
    'among us': '1521722099260194889', roblox: '1520614681444618291',
    meccha: '1525293094319296572', minecraft: '1519048919034630184', discord: '1288443828495323147'
  },
  vouchesChannelId: '1274623501416005667',
  ticketWelcome: true,
  faq: { enabled: false, channelIds: [], cooldownSeconds: 60, keybinds: {}, custom: {} },
  welcome: {
    enabled: false,
    channelId: null,
    title: 'Welcome to {server}!',
    message: 'Welcome {user}! You are member **#{memberCount}**. We are glad to have you here.'
  },
  automodEnabled: true,
  blockedPhrases: ['check my bio', 'check bio', 'free nitro', 'free discord nitro'],
  blockedDomains: [],
  storeUrl: process.env.STORE_URL || 'https://thehudsonshop.com'
};

class DataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { schemaVersion: 2, guilds: {}, claims: {} };
    this._writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
      if (!this.data.schemaVersion) {
        await fs.copyFile(this.filePath, `${this.filePath}.pre-v2.bak`, constants.COPYFILE_EXCL).catch(error => {
          if (error.code !== 'EEXIST') throw error;
        });
        console.log('[store] Pre-v2 database backup is available on the persistent volume.');
        this.data.schemaVersion = 2;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.save();
    }
    this.data.guilds ||= {};
    this.data.claims ||= {};
    if (typeof this.data.guilds !== 'object' || Array.isArray(this.data.guilds) || typeof this.data.claims !== 'object' || Array.isArray(this.data.claims)) {
      throw new Error('Invalid database structure; restore data/db.json from a backup.');
    }
  }

  _ensureGuild(guildId) {
    if (!this.data.guilds[guildId]) {
      this.data.guilds[guildId] = {
        settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        announcements: {}
      };
    }
    const guild = this.data.guilds[guildId];
    guild.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(guild.settings || {}) };
    guild.settings.welcome = { ...DEFAULT_SETTINGS.welcome, ...(guild.settings.welcome || {}) };
    guild.settings.faq = { ...structuredClone(DEFAULT_SETTINGS.faq), ...(guild.settings.faq || {}) };
    guild.ticketPanels ||= {};
    guild.settings.ticketCategoryIds ||= [];
    guild.settings.ticketParentChannelIds ||= [];
    guild.settings.productRoles ||= {};
    guild.settings.blockedPhrases ||= [...DEFAULT_SETTINGS.blockedPhrases];
    guild.settings.blockedDomains ||= [];
    guild.announcements ||= {};
    return guild;
  }

  getSettings(guildId) {
    return this._ensureGuild(guildId).settings;
  }

  async updateSettings(guildId, patch) {
    const guild = this._ensureGuild(guildId);
    const previous = guild.settings;
    guild.settings = { ...previous, ...patch };
    for (const key of ['welcome', 'faq']) {
      if (patch[key]) guild.settings[key] = { ...previous[key], ...patch[key] };
    }
    await this.save();
    return guild.settings;
  }

  async addTicketCategory(guildId, categoryId) {
    const settings = this.getSettings(guildId);
    if (!settings.ticketCategoryIds.includes(categoryId)) settings.ticketCategoryIds.push(categoryId);
    await this.save();
  }

  async removeTicketCategory(guildId, categoryId) {
    const settings = this.getSettings(guildId);
    settings.ticketCategoryIds = settings.ticketCategoryIds.filter((id) => id !== categoryId);
    await this.save();
  }

  async addTicketParent(guildId, channelId) {
    const settings = this.getSettings(guildId);
    if (!settings.ticketParentChannelIds.includes(channelId)) settings.ticketParentChannelIds.push(channelId);
    await this.save();
  }

  async removeTicketParent(guildId, channelId) {
    const settings = this.getSettings(guildId);
    settings.ticketParentChannelIds = settings.ticketParentChannelIds.filter((id) => id !== channelId);
    await this.save();
  }

  async setProductRole(guildId, product, roleId) {
    const settings = this.getSettings(guildId);
    const key = String(product).trim().toLowerCase().replace(/\s+/g, ' ');
    settings.productRoles[key] = roleId;
    await this.save();
    return key;
  }

  async removeProductRole(guildId, product) {
    const settings = this.getSettings(guildId);
    const key = String(product).trim().toLowerCase().replace(/\s+/g, ' ');
    const existed = Boolean(settings.productRoles[key]);
    delete settings.productRoles[key];
    if (existed) await this.save();
    return existed;
  }

  getClaim(orderId, guildId) {
    const key = String(orderId).trim().toUpperCase();
    const claim = this.data.claims[`${guildId}:${key}`] || this.data.claims[key];
    return claim && claim.guildId === guildId ? claim : null;
  }

  async claimOrder(orderId, claim) {
    const key = `${claim.guildId}:${String(orderId).trim().toUpperCase()}`;
    const existing = this.getClaim(orderId, claim.guildId);
    if (existing) return { ok: false, existing };
    this.data.claims[key] = claim;
    await this.save();
    return { ok: true, claim };
  }

  async updateClaim(orderId, patch, guildId) {
    const existing = this.getClaim(orderId, guildId);
    if (!existing) return null;
    const key = `${guildId}:${String(orderId).trim().toUpperCase()}`;
    this.data.claims[key] = { ...existing, ...patch };
    await this.save();
    return this.data.claims[key];
  }

  getAnnouncements(guildId) {
    return Object.values(this._ensureGuild(guildId).announcements);
  }

  getTicketPanel(guildId, channelId) {
    return this._ensureGuild(guildId).ticketPanels[channelId];
  }

  async setTicketPanel(guildId, channelId, messageId) {
    const panels = this._ensureGuild(guildId).ticketPanels;
    if (messageId) panels[channelId] = messageId;
    else delete panels[channelId];
    await this.save();
  }

  async remapChannel(guildId, oldId, newId) {
    const guild = this._ensureGuild(guildId);
    for (const key of ['logChannelId']) if (guild.settings[key] === oldId) guild.settings[key] = newId;
    if (guild.settings.welcome.channelId === oldId) guild.settings.welcome.channelId = newId;
    for (const key of ['ticketParentChannelIds']) guild.settings[key] = guild.settings[key].map(id => id === oldId ? newId : id);
    guild.settings.faq.channelIds = guild.settings.faq.channelIds.map(id => id === oldId ? newId : id);
    if (guild.settings.vouchesChannelId === oldId) guild.settings.vouchesChannelId = newId;
    for (const [product, id] of Object.entries(guild.settings.tutorialChannels)) if (id === oldId) guild.settings.tutorialChannels[product] = newId;
    for (const entry of Object.values(guild.announcements)) if (entry.channelId === oldId) entry.channelId = newId;
    delete guild.ticketPanels[oldId];
    await this.save();
  }

  async addAnnouncement(guildId, announcement) {
    const guild = this._ensureGuild(guildId);
    let id;
    do { id = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (guild.announcements[id]);
    guild.announcements[id] = { id, ...announcement };
    await this.save();
    return guild.announcements[id];
  }

  async removeAnnouncement(guildId, id) {
    const guild = this._ensureGuild(guildId);
    const key = String(id).toUpperCase();
    const existed = Boolean(guild.announcements[key]);
    delete guild.announcements[key];
    if (existed) await this.save();
    return existed;
  }

  async updateAnnouncement(guildId, id, patch) {
    const guild = this._ensureGuild(guildId);
    const key = String(id).toUpperCase();
    if (!guild.announcements[key]) return null;
    guild.announcements[key] = { ...guild.announcements[key], ...patch };
    await this.save();
    return guild.announcements[key];
  }

  async save() {
    const serialized = JSON.stringify(this.data, null, 2);
    this._writeQueue = this._writeQueue.catch(() => {}).then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, serialized, 'utf8');
      await fs.rename(tmp, this.filePath);
    });
    return this._writeQueue;
  }
}

module.exports = { DataStore, DEFAULT_SETTINGS };
