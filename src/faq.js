const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { requirePermission } = require('./permissions');

// Hudson Shop quick-help knowledge. Product-specific keys below are the confirmed defaults;
// staff can still override most products with /faq keybind.
const DEFAULT_KEYBINDS = {
  fortnite: 'Insert',
  fivem: 'Insert',
  meccha: 'Insert',
  minecraft: 'Insert',
  roblox: 'Insert',
  valorant: 'Insert',
  'black-ops-3': 'Delete'
};

const KNOWLEDGE = [
  {
    id: 'always-imposter',
    title: 'Always Imposter',
    patterns: [
      /\balways\s+impost(?:er|or)\b/,
      /\b(?:be|become|force)\b.*\bimpost(?:er|or)\b.*\bwithout\s+(?:being\s+)?host\b/,
      /\bwithout\s+(?:being\s+)?host\b.*\bimpost(?:er|or)\b/
    ],
    answer: 'Always Imposter without host is a **paid/private Among Us feature**. You need **Among Us Private**. You can purchase it in {purchaseChannel}.',
    source: 'https://thehudsonshop.com/order/among-us-private'
  },
  {
    id: 'downloads',
    title: 'Where to download',
    patterns: [
      /\b(where|how)\b.*\b(download|loader|downloads)\b/,
      /\b(download|downloads|loader)\b.*\b(where|link|locked|unlock)\b/
    ],
    answer: 'Open **Downloads** on Hudson Shop and sign in with the account used for your purchase. Paid products unlock after the order is completed; free downloads are listed there too.',
    source: 'https://thehudsonshop.com/downloads'
  },
  {
    id: 'delivery',
    title: 'Delivery and license keys',
    patterns: [
      /\b(where|when|missing|find|receive|lost|didnt|get)\b.*\b(license|key|keys|purchase email)\b/,
      /\b(how long|how fast|when)\b.*\b(delivery|deliver|order arrive)\b/
    ],
    answer: 'Hudson Shop delivers access after payment confirmation. Check your email and **My Orders / Downloads**. If a key is still missing, open a support ticket with your HUD order ID.',
    source: 'https://thehudsonshop.com/faq'
  },
  {
    id: 'orders',
    title: 'Find your order',
    patterns: [
      /\b(where|how|find|lost|look up|lookup)\b.*\b(order id|order number|my order|order|receipt)\b/
    ],
    answer: 'Sign in to Hudson Shop and open **My Orders** to see your purchases and order references. Your checkout confirmation can also contain the order reference.',
    source: 'https://thehudsonshop.com/orders'
  },
  {
    id: 'troubleshooting',
    title: 'Something is not working',
    patterns: [
      /\b(not working|doesnt work|wont work|broken|error|crash|crashing|stuck)\b/,
      /\bwhat.*do\b.*\bnot working\b/
    ],
    answer: 'First make sure you are using the newest download and that the product is currently compatible. Check the Hudson Shop **Status** page. If it still fails, open a support ticket and include the product, game version, and exact error.',
    source: 'https://thehudsonshop.com/status'
  },
  {
    id: 'support',
    title: 'Get support',
    patterns: [
      /\b(how|where|can)\b.*\b(contact support|get support|open a ticket|create a ticket|reach staff|support ticket)\b/
    ],
    answer: 'Open a Discord support ticket. Include the product name, your HUD order ID when relevant, and the exact error. Never post passwords or license keys publicly.',
    source: 'https://thehudsonshop.com/faq'
  },
  {
    id: 'refunds',
    title: 'Refund requests',
    patterns: [/\b(refund|refunds|money back)\b/],
    answer: 'Refund requests need to be reviewed by staff. Open a support ticket with your HUD order ID and explain the issue so the order can be reviewed.',
    source: 'https://thehudsonshop.com/faq'
  },
  {
    id: 'payments',
    title: 'Payment methods',
    patterns: [/\b(payment methods|pay with|how.*pay|what.*payment|card|paypal|cash app|venmo|crypto)\b/],
    answer: 'Available payment methods can change, so use the checkout page for the product you want and it will show the payment options currently available.',
    source: 'https://thehudsonshop.com/faq'
  },
  {
    id: 'availability',
    title: 'Available products',
    patterns: [
      /\b(what|which|are)\b.*\b(products|menus|tools|cheats)\b.*\b(available|out|released|live)\b/,
      /\bare game cheats available yet\b/
    ],
    answer: 'Check the Hudson Shop **Store** for products that are currently available and the **Status** page for compatibility or outages.',
    source: 'https://thehudsonshop.com/store'
  },
  {
    id: 'roblox-download',
    title: 'Roblox Private download',
    product: 'roblox',
    patterns: [/\b(where|how)\b.*\b(download|get)\b.*\broblox\b/, /\broblox\b.*\b(download|downloads|loader)\b/],
    answer: 'After your Roblox Private purchase is completed, sign in to Hudson Shop and open **Downloads** to get the current Roblox Private download.',
    source: 'https://thehudsonshop.com/downloads'
  },
  {
    id: 'roblox-support',
    title: 'Roblox Private support',
    product: 'roblox',
    patterns: [/\broblox\b.*\b(discord support|support|help)\b/, /\b(discord support|support)\b.*\broblox\b/],
    answer: 'Yes. Hudson Shop provides Discord support for Roblox Private. Open a support ticket and include your order ID and the issue you are having.',
    source: 'https://thehudsonshop.com/faq'
  },
  {
    id: 'updates',
    title: 'Updates and compatibility',
    patterns: [
      /\b(update|updates|updated|compatibility|compatible|game update|new version|patch)\b/
    ],
    answer: 'Product compatibility can change after game updates. Check the **Status** page and use the newest file from **Downloads**. If a product is temporarily incompatible, wait for the updated release before using it.',
    source: 'https://thehudsonshop.com/status'
  },
  {
    id: 'all-access',
    title: 'All Access',
    patterns: [/\ball access\b/, /\bone (?:key|pass|purchase)\b.*\b(all|every)\b.*\b(menu|product)\b/],
    answer: 'Hudson All Access bundles the current eligible private releases under one premium package. Check the All Access page for the current included products and terms.',
    source: 'https://thehudsonshop.com/order/all-access'
  }
];

const PRODUCTS = {
  'among-us': /\bamong\s*us\b/,
  fortnite: /\bfortnite\b/,
  fivem: /\b(?:fivem|five\s*m)\b/,
  meccha: /\b(?:mec+ha|mecha)(?:\s+chameleon)?\b/,
  minecraft: /\bminecraft\b/,
  roblox: /\broblox\b/,
  valorant: /\bvalorant\b/,
  'black-ops-3': /\b(?:black\s*ops\s*3|bo3)\b/
};

const PRODUCT_NAMES = {
  'among-us': 'Among Us',
  fortnite: 'Fortnite',
  fivem: 'FiveM',
  meccha: 'Meccha Chameleon',
  minecraft: 'Minecraft',
  roblox: 'Roblox',
  valorant: 'Valorant',
  'black-ops-3': 'Black Ops 3'
};

const cooldowns = new Map();
const pending = new Map();
const FOLLOWUP_MS = 120_000;

function normalize(text) {
  return String(text).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function productFrom(text) {
  const normalized = normalize(text);
  const matches = Object.entries(PRODUCTS).filter(([, pattern]) => pattern.test(normalized));
  return matches.length === 1 ? matches[0][0] : null;
}

function amongUsEdition(text) {
  const normalized = normalize(text);
  if (/\b(free|public)\b/.test(normalized)) return 'free';
  if (/\b(private|paid|premium)\b/.test(normalized)) return 'private';
  return null;
}

function keybindEntry(product, text, settings) {
  const name = PRODUCT_NAMES[product] || product.replaceAll('-', ' ');
  if (product === 'among-us') {
    const edition = amongUsEdition(text);
    if (edition === 'free') return { id: 'keybind-among-us-free', title: 'Among Us Free menu key', answer: 'For **Among Us Free**, press **Delete** to open the menu.' };
    if (edition === 'private') return { id: 'keybind-among-us-private', title: 'Among Us Private menu key', answer: 'For **Among Us Private**, press **Insert** to open the menu.' };
    return {
      id: 'keybind-among-us',
      title: 'Among Us menu keys',
      answer: '**Among Us Free:** press **Delete**.\n**Among Us Private/Paid:** press **Insert**.'
    };
  }
  const key = settings.keybinds?.[product] || DEFAULT_KEYBINDS[product];
  return {
    id: `keybind-${product}`,
    title: `${name} menu key`,
    answer: key
      ? `For **${name}**, press **${key}** to open the menu.`
      : `I do not have a confirmed keybind for **${name}** yet. Check its tutorial or ask staff in a support ticket.`
  };
}

function isKeyQuestion(text) {
  return /\b(keybind|hotkey|key|button|open|toggle)\b/.test(text) &&
    (/\b(menu|keybind|hotkey|open)\b/.test(text) || /\bwhat\s+key\b/.test(text));
}

function matchFaq(content, settings, context = '', explicit = false) {
  const text = normalize(content);
  if (!text || content.length > 400 || /https?:\/\/|\`\`\`|^\s*>/i.test(content)) return null;
  if (!explicit && !/[?]/.test(content) && !/\b(what|how|where|when|why|can|does|do|is|which|help|anyone|keybind|key|open)\b/.test(text)) return null;

  const mentioned = Object.values(PRODUCTS).filter(pattern => pattern.test(text)).length;
  const product = mentioned ? productFrom(text) : productFrom(context);

  const custom = Object.values(settings.custom || {}).filter(entry =>
    entry.triggers.some(trigger => (` ${text} `).includes(` ${normalize(trigger)} `))
  );
  if (custom.length === 1) return custom[0];
  if (custom.length > 1) return null;

  if (isKeyQuestion(text)) {
    if (!product) {
      return {
        id: 'keybind-clarify',
        title: 'Which menu?',
        answer: 'Which menu are you using? You can reply with just the product name, like **Among Us**, **FiveM**, **Fortnite**, **Meccha**, **Minecraft**, **Roblox**, or **Black Ops 3**.'
      };
    }
    return keybindEntry(product, text, settings);
  }

  const matches = KNOWLEDGE.filter(entry =>
    (!entry.product || entry.product === product) &&
    entry.patterns.some(pattern => pattern.test(text))
  );
  return matches.length === 1 ? matches[0] : null;
}

function formatEntry(entry, guildSettings) {
  const purchaseId = guildSettings?.ticketParentChannelIds?.[0];
  const purchaseChannel = purchaseId ? `<#${purchaseId}>` : '**the Purchase channel**';
  return { ...entry, answer: String(entry.answer).replaceAll('{purchaseChannel}', purchaseChannel) };
}

function payload(entry) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x7628BE)
        .setTitle(entry.title)
        .setDescription(entry.answer + (entry.source ? `\n\n[Shop reference](${entry.source})` : ''))
        .setFooter({ text: 'Hudson Shop • Quick help' })
    ],
    allowedMentions: { parse: [], repliedUser: false }
  };
}

function pendingKey(message) {
  return `${message.guild.id}:${message.channelId}:${message.author.id}`;
}

function followupEntry(message, settings) {
  const key = pendingKey(message);
  const state = pending.get(key);
  if (!state) return null;
  if (state.expiresAt <= Date.now()) {
    pending.delete(key);
    return null;
  }

  const text = normalize(message.content);
  const product = productFrom(text);
  if (!product) return null;

  // A short product-only answer (optionally including free/private) completes the clarification.
  const withoutProduct = Object.values(PRODUCTS).reduce((value, pattern) => value.replace(pattern, ' '), text).replace(/\b(free|private|paid|premium|public)\b/g, ' ').trim();
  if (withoutProduct.length > 0 && text.split(' ').length > 6) return null;

  pending.delete(key);
  return keybindEntry(product, text, settings);
}

async function handleFaqMessage(message, store) {
  if (!message.guild || message.author?.bot || message.webhookId || message.system || !message.content) return false;
  const guildSettings = store.getSettings(message.guild.id);
  const settings = guildSettings.faq;
  if (!settings.enabled) return false;
  if (settings.channelIds.length && !settings.channelIds.includes(message.channelId) && !settings.channelIds.includes(message.channel.parentId)) return false;

  let entry = followupEntry(message, settings);
  const isFollowup = Boolean(entry);
  if (!entry) entry = matchFaq(message.content, settings, `${message.channel.name || ''} ${message.channel.parent?.name || ''}`);
  if (!entry) return false;

  if (entry.id === 'keybind-clarify') {
    pending.set(pendingKey(message), { expiresAt: Date.now() + FOLLOWUP_MS });
  }

  const now = Date.now();
  for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
  for (const [key, value] of pending) if (value.expiresAt <= now) pending.delete(key);

  const keys = [
    `user:${message.guild.id}:${message.author.id}`,
    `answer:${message.channelId}:${entry.id}`,
    `channel:${message.channelId}`
  ];
  if (!isFollowup && keys.some(key => cooldowns.has(key))) return false;
  keys.forEach((key, i) => cooldowns.set(key, now + (i === 2 ? 15 : settings.cooldownSeconds) * 1000));

  const resolved = formatEntry(entry, guildSettings);
  try {
    await message.reply(payload(resolved));
  } catch (error) {
    keys.forEach(key => cooldowns.delete(key));
    throw error;
  }
  return true;
}

async function handleFaqCommand(interaction, store) {
  const sub = interaction.options.getSubcommand();
  const guildSettings = store.getSettings(interaction.guildId);
  const settings = guildSettings.faq;

  if (sub === 'ask') {
    const entry = matchFaq(interaction.options.getString('question', true), settings, interaction.channel?.name, true);
    return interaction.reply(
      entry
        ? { ...payload(formatEntry(entry, guildSettings)), ephemeral: true }
        : { content: 'I do not have a confirmed answer for that yet. Open a support ticket with your product and question.', ephemeral: true }
    );
  }

  if (!await requirePermission(interaction, PermissionFlagsBits.ManageGuild, store)) return;
  await interaction.deferReply({ ephemeral: true });
  const patch = {};
  let response;

  if (sub === 'toggle') {
    patch.enabled = interaction.options.getBoolean('enabled', true);
    response = `Automatic FAQ replies are **${patch.enabled ? 'ON' : 'OFF'}**.`;
  }

  if (sub === 'channel') {
    const id = interaction.options.getChannel('channel', true).id;
    const enabled = interaction.options.getBoolean('enabled', true);
    patch.channelIds = enabled
      ? [...new Set([...settings.channelIds, id])]
      : settings.channelIds.filter(value => value !== id);
    response = patch.channelIds.length
      ? `FAQ replies are restricted to ${patch.channelIds.map(value => `<#${value}>`).join(', ')} and their threads.`
      : 'The channel allowlist is empty: FAQ replies can run in all visible channels when enabled.';
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
    patch.custom = {
      ...settings.custom,
      [id]: {
        id,
        title: interaction.options.getString('title', true),
        answer: interaction.options.getString('answer', true),
        triggers
      }
    };
    response = `Saved **${id}**. Use /faq ask to preview the answer.`;
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).toLowerCase();
    patch.custom = { ...settings.custom };
    delete patch.custom[id];
    response = `Removed custom answer **${id}** if it existed.`;
  }

  if (sub === 'status') {
    response =
      `Automatic replies: **${settings.enabled ? 'ON' : 'OFF'}**\n` +
      `Channels: ${settings.channelIds.length ? settings.channelIds.map(id => `<#${id}>`).join(', ') : 'All visible channels'}\n` +
      `Cooldown: ${settings.cooldownSeconds}s per user / repeated answer; 15s per channel\n` +
      `Keybind overrides: ${Object.entries(settings.keybinds).map(([p, k]) => `${p}: ${k}`).join(', ') || 'None'}\n` +
      `Built-in topics: keybinds, ${KNOWLEDGE.map(entry => entry.id).join(', ')}\n` +
      `Custom answers: ${Object.keys(settings.custom).join(', ') || 'None'}`;
  }

  if (Object.keys(patch).length) await store.updateSettings(interaction.guildId, { faq: patch });
  return interaction.editReply({ content: response.slice(0, 1950), allowedMentions: { parse: [] } });
}

module.exports = {
  KNOWLEDGE,
  DEFAULT_KEYBINDS,
  PRODUCTS,
  matchFaq,
  handleFaqMessage,
  handleFaqCommand
};
