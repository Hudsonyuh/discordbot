const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { requirePermission } = require('./permissions');

// Reviewed 2026-10-01. Keep answers short and link to the source for current details.
const KNOWLEDGE = [
  { id: 'downloads', title: 'Downloads', patterns: [/\b(where|how)\b.*\b(download|loader|downloads)\b/, /\b(download|downloads|loader)\b.*\b(where|link|locked|unlock)\b/], answer: 'Open Downloads and sign in to the account used to purchase. Paid downloads unlock after your order is complete; free downloads are also listed there.', source: 'https://thehudsonshop.com/downloads' },
  { id: 'delivery', title: 'Delivery and license keys', patterns: [/\b(where|when|missing|find|receive|lost)\b.*\b(license|key|keys|purchase email)\b/, /\b(how long|how fast|when)\b.*\b(delivery|deliver|order arrive)\b/], answer: 'After payment confirmation, check your purchase email for your license key and your account for download access. For a missing key, open a support ticket with your order ID.', source: 'https://thehudsonshop.com/order/among-us-private' },
  { id: 'orders', title: 'Find your order', patterns: [/\b(where|how|find|lost)\b.*\b(order id|order number|my order|receipt)\b/], answer: 'Sign in and open My Orders to find your purchases and order IDs. Your checkout confirmation email also contains the order reference.', source: 'https://thehudsonshop.com/faq' },
  { id: 'support', title: 'Get support', patterns: [/\b(how|where|can)\b.*\b(contact support|get support|open a ticket|create a ticket|reach staff)\b/], answer: 'Open a Discord support ticket. Use Support for setup help or Claim Product to submit an order ID for staff review. Include the product and exact error, but never post passwords or license keys in chat.', source: 'https://thehudsonshop.com/faq' },
  { id: 'refunds', title: 'Refund requests', patterns: [/\b(refund|refunds|money back)\b/], answer: 'Refunds are reviewed individually. Open a Discord ticket with your order ID so staff can review your request.', source: 'https://thehudsonshop.com/faq' },
  { id: 'payments', title: 'Payment methods', patterns: [/\b(payment methods|pay with|accept paypal|accept card|how.*pay)\b/], answer: 'The shop lists PayPal at checkout. Check the checkout page for the options available for your order.', source: 'https://thehudsonshop.com/faq' },
  { id: 'plans', title: 'Among Us access plans', patterns: [/\b(monthly|lifetime|subscription|one time)\b/], product: 'among-us', answer: 'Among Us Private offers monthly and lifetime plans. See the product page for current pricing and what each plan includes.', source: 'https://thehudsonshop.com/order/among-us-private' },
  { id: 'status', title: 'Product status', patterns: [/\b(is|when|why)\b.*\b(working|available|down|maintenance|updated|update|compatible)\b/], needsProduct: true, answer: 'Check the shop Status page for current availability and compatibility. If your build is not working, include your product, game version, and error in a support ticket.', source: 'https://thehudsonshop.com/status' }
];
const PRODUCTS = { 'among-us': /\bamong\s*us\b/, roblox: /\broblox\b/, minecraft: /\bminecraft\b/, meccha: /\bmec+ha\b/ };
const cooldowns = new Map();
function normalize(text) { return String(text).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function productFrom(text) {
  const matches = Object.entries(PRODUCTS).filter(([, pattern]) => pattern.test(normalize(text)));
  return matches.length === 1 ? matches[0][0] : null;
}
function matchFaq(content, settings, context = '', explicit = false) {
  const text = normalize(content);
  if (!text || content.length > 400 || /https?:\/\/|```|^\s*>/i.test(content)) return null;
  if (!explicit && !/[?]/.test(content) && !/\b(what|how|where|when|why|can|does|do|is|which|help|anyone|keybind)\b/.test(text)) return null;
  const mentioned = Object.values(PRODUCTS).filter(pattern => pattern.test(text)).length;
  const product = mentioned ? productFrom(text) : productFrom(context);
  const custom = Object.values(settings.custom || {}).filter(entry => entry.triggers.some(trigger => (` ${text} `).includes(` ${normalize(trigger)} `)));
  if (custom.length === 1) return custom[0];
  if (custom.length > 1) return null;
  if (/\b(keybind|hotkey|key|button|open|toggle)\b/.test(text) && /\b(menu|keybind|hotkey)\b/.test(text)) {
    if (!product) return { id: 'keybind-clarify', title: 'Which menu?', answer: 'Which product are you using: Among Us, Roblox, Minecraft, or Meccha? Ask again with the product name, for example: “What key opens the Among Us menu?”' };
    const key = settings.keybinds?.[product];
    return { id: `keybind-${product}`, title: `${product.replaceAll('-', ' ')} menu key`, answer: key ? `For **${product.replaceAll('-', ' ')}**, use **${key}** to open the menu. (Configured by server staff.)` : `Staff have not confirmed the **${product.replaceAll('-', ' ')}** menu key yet. Check its tutorial or ask in a support ticket.` };
  }
  const matches = KNOWLEDGE.filter(entry => (!entry.product || entry.product === product) && (!entry.needsProduct || product) && entry.patterns.some(pattern => pattern.test(text)));
  return matches.length === 1 ? matches[0] : null;
}
function payload(entry) {
  return { embeds: [new EmbedBuilder().setColor(0x7628BE).setTitle(entry.title).setDescription(entry.answer + (entry.source ? `\n\n[Shop reference](${entry.source})` : '')).setFooter({ text: 'Hudson Shop • Quick help' })], allowedMentions: { parse: [], repliedUser: false } };
}
async function handleFaqMessage(message, store) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system || !message.content) return false;
  const settings = store.getSettings(message.guild.id).faq;
  if (!settings.enabled) return false;
  if (settings.channelIds.length && !settings.channelIds.includes(message.channelId) && !settings.channelIds.includes(message.channel.parentId)) return false;
  const entry = matchFaq(message.content, settings, `${message.channel.name || ''} ${message.channel.parent?.name || ''}`);
  if (!entry) return false;
  const now = Date.now();
  for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
  const keys = [`user:${message.guild.id}:${message.author.id}`, `answer:${message.channelId}:${entry.id}`, `channel:${message.channelId}`];
  if (keys.some(key => cooldowns.has(key))) return false;
  keys.forEach((key, i) => cooldowns.set(key, now + (i === 2 ? 15 : settings.cooldownSeconds) * 1000));
  try { await message.reply(payload(entry)); } catch (error) { keys.forEach(key => cooldowns.delete(key)); throw error; }
  return true;
}
async function handleFaqCommand(interaction, store) {
  const sub = interaction.options.getSubcommand();
  const settings = store.getSettings(interaction.guildId).faq;
  if (sub === 'ask') {
    const entry = matchFaq(interaction.options.getString('question', true), settings, interaction.channel?.name, true);
    return interaction.reply(entry ? { ...payload(entry), ephemeral: true } : { content: 'I do not have a confirmed answer for that. Open a support ticket with your product and question.', ephemeral: true });
  }
  if (!await requirePermission(interaction, PermissionFlagsBits.ManageGuild, store)) return;
  await interaction.deferReply({ ephemeral: true });
  const patch = {};
  let response;
  if (sub === 'toggle') { patch.enabled = interaction.options.getBoolean('enabled', true); response = `Automatic FAQ replies are **${patch.enabled ? 'ON' : 'OFF'}**.`; }
  if (sub === 'channel') {
    const id = interaction.options.getChannel('channel', true).id;
    const enabled = interaction.options.getBoolean('enabled', true);
    patch.channelIds = enabled ? [...new Set([...settings.channelIds, id])] : settings.channelIds.filter(value => value !== id);
    response = patch.channelIds.length ? `FAQ replies are restricted to ${patch.channelIds.map(value => `<#${value}>`).join(', ')} and their threads.` : 'The channel allowlist is empty: FAQ replies can run in all visible channels when enabled.';
  }
  if (sub === 'keybind') {
    const product = interaction.options.getString('product', true);
    patch.keybinds = { ...settings.keybinds, [product]: interaction.options.getString('key', true) };
    response = `Saved the **${product}** menu key. Test it with /faq ask.`;
  }
  if (sub === 'add') {
    const id = interaction.options.getString('id', true).toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) return interaction.editReply('Use 1–32 lowercase letters, numbers, or hyphens for the ID.');
    if (!Object.hasOwn(settings.custom, id) && Object.keys(settings.custom).length >= 50) return interaction.editReply('The server limit is 50 custom answers. Remove one first.');
    const triggers = interaction.options.getString('triggers', true).split('|').map(normalize).filter(value => value.length >= 4);
    if (!triggers.length) return interaction.editReply('Provide at least one trigger phrase of 4 or more characters. Separate alternatives with |.');
    patch.custom = { ...settings.custom, [id]: { id, title: interaction.options.getString('title', true), answer: interaction.options.getString('answer', true), triggers } };
    response = `Saved **${id}**. Use /faq ask to preview the answer.`;
  }
  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).toLowerCase();
    patch.custom = { ...settings.custom }; delete patch.custom[id]; response = `Removed custom answer **${id}** if it existed.`;
  }
  if (sub === 'status') {
    response = `Automatic replies: **${settings.enabled ? 'ON' : 'OFF'}**\nChannels: ${settings.channelIds.length ? settings.channelIds.map(id => `<#${id}>`).join(', ') : 'All visible channels'}\nCooldown: ${settings.cooldownSeconds}s per user / repeated answer; 15s per channel\nKeybinds: ${Object.entries(settings.keybinds).map(([p, k]) => `${p}: ${k}`).join(', ') || 'Not confirmed'}\nBuilt-in topics: ${KNOWLEDGE.map(entry => entry.id).join(', ')}\nCustom answers: ${Object.keys(settings.custom).join(', ') || 'None'}`;
  }
  if (Object.keys(patch).length) await store.updateSettings(interaction.guildId, { faq: patch });
  return interaction.editReply({ content: response.slice(0, 1950), allowedMentions: { parse: [] } });
}
module.exports = { KNOWLEDGE, matchFaq, handleFaqMessage, handleFaqCommand };
