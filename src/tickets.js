const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { sendLog } = require('./logger');

const recentlyPosted = new Set();
let watcherRunning = false;

function ticketEmbed() {
  return new EmbedBuilder()
    .setColor(0x7628BE)
    .setTitle('Hudson Shop Support')
    .setDescription('What would you like to do? Choose an option below so we can get you handled quickly.')
    .addFields(
      { name: '🛒 Purchase', value: 'Open TheHudsonShop.com and choose a product.' },
      { name: '🛠️ Support', value: 'Tell staff what product you need help with and what is happening.' },
      { name: '✅ Claim Product', value: 'Already paid? Submit your order ID for staff to review.' }
    )
    .setFooter({ text: 'The Hudson Shop • Manual order review' });
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hudson_ticket_purchase').setLabel('Purchase').setEmoji('🛒').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hudson_ticket_support').setLabel('Support').setEmoji('🛠️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hudson_ticket_claim').setLabel('Claim Product').setEmoji('✅').setStyle(ButtonStyle.Success)
  );
}

async function postTicketPanel(channel) {
  return channel.send({
    embeds: [ticketEmbed()],
    components: [ticketButtons()],
    allowedMentions: { parse: [] }
  });
}

function isTicketChannel(channel, settings) {
  if (!channel?.guild || !channel.isTextBased()) return false;

  if (channel.isThread?.()) {
    if (settings.ticketParentChannelIds?.includes(channel.parentId)) return true;
    const parentName = channel.parent?.name || '';
    if (/purchase|ticket|support|order/i.test(parentName)) return true;
  }

  if (channel.parentId && settings.ticketCategoryIds?.includes(channel.parentId)) return true;
  if (!channel.parentId && (settings.uncategorizedTickets || String(process.env.UNCATEGORIZED_TICKETS).toLowerCase() === 'true')) return true;

  return false;
}

function messageHasTicketPanel(message) {
  for (const row of message.components || []) {
    for (const component of row.components || []) {
      if (component.customId === 'hudson_ticket_claim') return true;
    }
  }
  return false;
}

async function panelAlreadyExists(channel) {
  const messages = await channel.messages?.fetch?.({ limit: 25 }).catch(() => null);
  if (!messages) return false;
  return messages.some((message) => messageHasTicketPanel(message));
}

async function prepareThread(channel) {
  if (!channel.isThread?.()) return;

  if (channel.archived && channel.manageable) {
    await channel.setArchived(false, 'Hudson Shop ticket integration').catch(() => null);
  }

  if (channel.joinable) {
    await channel.join().catch((err) => {
      console.error(
        '[ticket-thread-join]',
        `thread=${channel.id}`,
        `parent=${channel.parentId}`,
        err.code || err.message
      );
    });
  }
}

async function onTicketChannelCreated(channel, store) {
  if (!channel?.guild || !channel.isTextBased()) return;

  const settings = store.getSettings(channel.guild.id);
  if (!settings.ticketWelcome || !isTicketChannel(channel, settings)) return;
  if (recentlyPosted.has(channel.id)) return;

  recentlyPosted.add(channel.id);
  setTimeout(() => recentlyPosted.delete(channel.id), 30_000).unref?.();

  try {
    await prepareThread(channel);
    if (await panelAlreadyExists(channel)) return;

    await postTicketPanel(channel);
    console.log(
      '[ticket-panel]',
      `posted channel=${channel.id}`,
      `parent=${channel.parentId || 'none'}`,
      `thread=${Boolean(channel.isThread?.())}`
    );
  } catch (err) {
    console.error(
      '[ticket-panel]',
      `failed channel=${channel.id}`,
      `parent=${channel.parentId || 'none'}`,
      `thread=${Boolean(channel.isThread?.())}`,
      err.code || err.message
    );
  }
}

async function scanTicketParents(client, store) {
  if (watcherRunning || !client.isReady()) return;
  watcherRunning = true;

  try {
    for (const guild of client.guilds.cache.values()) {
      const settings = store.getSettings(guild.id);
      if (!settings.ticketWelcome) continue;

      for (const parentId of settings.ticketParentChannelIds || []) {
        const parent = await guild.channels.fetch(parentId).catch(() => null);
        if (!parent?.threads?.fetchActive) continue;

        const active = await parent.threads.fetchActive().catch((err) => {
          console.error('[ticket-scan]', `parent=${parentId}`, err.code || err.message);
          return null;
        });

        if (!active?.threads) continue;

        for (const thread of active.threads.values()) {
          await onTicketChannelCreated(thread, store);
        }
      }
    }
  } finally {
    watcherRunning = false;
  }
}

function startTicketWatcher(client, store) {
  setTimeout(() => scanTicketParents(client, store).catch((err) => console.error('[ticket-scan]', err.message)), 4_000).unref?.();

  setInterval(
    () => scanTicketParents(client, store).catch((err) => console.error('[ticket-scan]', err.message)),
    10_000
  ).unref?.();
}

function maskedOrder(orderId) {
  const s = String(orderId);
  return s.length <= 8 ? s : `••••${s.slice(-6)}`;
}

async function processClaim({ interaction, orderId, client, store, publicConfirmation = false }) {
  const normalizedOrder = String(orderId || '').trim().toUpperCase();
  if (normalizedOrder.length < 3) {
    return interaction.editReply({ content: 'Enter a valid order ID from your Hudson Shop receipt.' });
  }

  const existing = store.getClaim(normalizedOrder);
  if (existing) {
    return interaction.editReply({
      content: existing.userId === interaction.user.id
        ? `You already submitted order **${maskedOrder(normalizedOrder)}** for review. Current status: **${existing.status || 'pending'}**.`
        : 'That order ID has already been submitted for review. Please ask staff if you believe this is a mistake.'
    });
  }

  const claim = {
    orderId: normalizedOrder,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  const result = await store.claimOrder(normalizedOrder, claim);
  if (!result.ok) {
    return interaction.editReply({ content: 'That order ID was just submitted by someone else. Please ask staff to review it.' });
  }

  await interaction.editReply({
    content: '✅ **Claim request submitted.** Staff will manually verify your order ID and handle your product in this ticket.'
  });

  if (publicConfirmation && interaction.channel?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('Claim Request Submitted')
      .setDescription(`<@${interaction.user.id}> submitted an order ID for staff review.`)
      .addFields(
        { name: 'Order', value: maskedOrder(normalizedOrder), inline: true },
        { name: 'Status', value: 'Pending staff review', inline: true }
      )
      .setTimestamp();

    await interaction.channel.send({
      embeds: [embed],
      allowedMentions: { users: [interaction.user.id] }
    }).catch(() => null);
  }

  await sendLog(client, store, interaction.guildId, {
    title: 'Claim request submitted',
    description: `<@${interaction.user.id}> submitted an order ID for manual review.`,
    color: 0xFEE75C,
    fields: [
      { name: 'Order ID', value: normalizedOrder, inline: true },
      { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.id})`, inline: true },
      { name: 'Ticket/Channel', value: `<#${interaction.channelId}>`, inline: true }
    ]
  });
}

async function handleTicketButton(interaction, store) {
  if (interaction.customId === 'hudson_ticket_purchase') {
    const url = store.getSettings(interaction.guildId).storeUrl || process.env.STORE_URL || 'https://thehudsonshop.com';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Open TheHudsonShop.com').setEmoji('🛒')
    );

    return interaction.reply({
      content: 'Ready to purchase? Use the button below. If you have a question before buying, press **Support** on the ticket menu.',
      components: [row],
      ephemeral: true
    });
  }

  if (interaction.customId === 'hudson_ticket_support') {
    const modal = new ModalBuilder().setCustomId('hudson_support_modal').setTitle('Hudson Shop Support');
    const product = new TextInputBuilder().setCustomId('product').setLabel('What product do you need help with?').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
    const issue = new TextInputBuilder().setCustomId('issue').setLabel('What is happening?').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true);
    const tried = new TextInputBuilder().setCustomId('tried').setLabel('What have you already tried?').setStyle(TextInputStyle.Paragraph).setMaxLength(700).setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(product),
      new ActionRowBuilder().addComponents(issue),
      new ActionRowBuilder().addComponents(tried)
    );

    return interaction.showModal(modal);
  }

  if (interaction.customId === 'hudson_ticket_claim') {
    const modal = new ModalBuilder().setCustomId('hudson_claim_modal').setTitle('Claim Your Purchase');
    const orderId = new TextInputBuilder()
      .setCustomId('order_id')
      .setLabel('Hudson Shop Order ID')
      .setPlaceholder('Enter the order ID from your receipt')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(orderId));
    return interaction.showModal(modal);
  }
}

async function handleTicketModal(interaction, client, store) {
  if (interaction.customId === 'hudson_support_modal') {
    const product = interaction.fields.getTextInputValue('product');
    const issue = interaction.fields.getTextInputValue('issue');
    const tried = interaction.fields.getTextInputValue('tried') || 'Not provided';

    await interaction.reply({ content: '✅ Support details submitted.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Support Request')
      .setDescription(`Submitted by <@${interaction.user.id}>`)
      .addFields(
        { name: 'Product', value: product.slice(0, 100) },
        { name: 'Issue', value: issue.slice(0, 1000) },
        { name: 'Already Tried', value: tried.slice(0, 700) }
      )
      .setTimestamp();

    return interaction.channel.send({
      embeds: [embed],
      allowedMentions: { users: [interaction.user.id] }
    });
  }

  if (interaction.customId === 'hudson_claim_modal') {
    const orderId = interaction.fields.getTextInputValue('order_id');
    await interaction.deferReply({ ephemeral: true });
    return processClaim({
      interaction,
      orderId,
      client,
      store,
      publicConfirmation: true
    });
  }
}

module.exports = {
  postTicketPanel,
  isTicketChannel,
  onTicketChannelCreated,
  scanTicketParents,
  startTicketWatcher,
  handleTicketButton,
  handleTicketModal,
  processClaim
};
