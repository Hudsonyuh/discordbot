const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_SETTINGS = {
  ticketCategoryIds: [],
  ticketParentChannelIds: [],
  uncategorizedTickets: false,
  logChannelId: null,
  staffRoleId: null,
  customerRoleId: null,
  productRoles: {},
  ticketWelcome: true,
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
    this.data = { guilds: {}, claims: {} };
    this._writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.save();
    }
    this.data.guilds ||= {};
    this.data.claims ||= {};
  }

  _ensureGuild(guildId) {
    if (!this.data.guilds[guildId]) {
      this.data.guilds[guildId] = {
        settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        announcements: {}
      };
    }
    const guild = this.data.guilds[guildId];
    guild.settings = { ...DEFAULT_SETTINGS, ...(guild.settings || {}) };
    guild.settings.welcome = { ...DEFAULT_SETTINGS.welcome, ...(guild.settings.welcome || {}) };
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
    guild.settings = { ...guild.settings, ...patch };
    if (patch.welcome) guild.settings.welcome = { ...this.getSettings(guildId).welcome, ...patch.welcome };
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

  getClaim(orderId) {
    return this.data.claims[String(orderId).toUpperCase()] || null;
  }

  async claimOrder(orderId, claim) {
    const key = String(orderId).toUpperCase();
    if (this.data.claims[key]) return { ok: false, existing: this.data.claims[key] };
    this.data.claims[key] = claim;
    await this.save();
    return { ok: true, claim };
  }

  async updateClaim(orderId, patch) {
    const key = String(orderId).toUpperCase();
    if (!this.data.claims[key]) return null;
    this.data.claims[key] = { ...this.data.claims[key], ...patch };
    await this.save();
    return this.data.claims[key];
  }

  getAnnouncements(guildId) {
    return Object.values(this._ensureGuild(guildId).announcements);
  }

  async addAnnouncement(guildId, announcement) {
    const guild = this._ensureGuild(guildId);
    const id = crypto.randomBytes(3).toString('hex').toUpperCase();
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
    this._writeQueue = this._writeQueue.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, serialized, 'utf8');
      await fs.rename(tmp, this.filePath);
    });
    return this._writeQueue;
  }
}

module.exports = { DataStore, DEFAULT_SETTINGS };
