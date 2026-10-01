const { PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { requirePermission } = require('./permissions');
const { sendLog } = require('./logger');
const { ShopClient } = require('./shop');
const DOWNLOADS_URL = 'https://thehudsonshop.com/downloads';
function normalizeProduct(input) { return String(input || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function createDeliveryHandler(client, store, shop = new ShopClient()) {
const deliveries = new Set();
async function handleDeliver(interaction) {
  const key = `${interaction.guildId}:${interaction.options.getString('order-id')?.trim().toUpperCase() || interaction.options.getUser('member', true).id}`;
  if (deliveries.has(key)) return interaction.reply({ content: 'This delivery is already being processed.', ephemeral: true });
  deliveries.add(key);
  try { return await deliverProduct(interaction); } finally { deliveries.delete(key); }
}

async function deliverProduct(interaction) {
  if (!await requirePermission(interaction, PermissionFlagsBits.ManageRoles, store)) return;
  if (shop.enabled) {
    if (interaction.guildId !== shop.guildId) return interaction.reply({ content: 'Website delivery is only available in the configured Hudson Shop server.', ephemeral: true });
    if (!await requirePermission(interaction, PermissionFlagsBits.ManageGuild, store)) return;
  }
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.options.getUser('member', true);
  const rawOrderId = interaction.options.getString('order-id');
  const orderId = rawOrderId ? rawOrderId.trim().toUpperCase() : null;
  if (shop.enabled && !orderId) return interaction.editReply('Provide the website HUD- order ID. /deliver confirms that order in Shop Payments and grants Discord access. Verify payment and the customer before running it.');
  if (orderId && !/^[A-Z0-9][A-Z0-9_-]{2,99}$/.test(orderId)) return interaction.editReply('Order IDs must contain 3–100 letters, numbers, hyphens, or underscores.');
  const productInput = interaction.options.getString('product', true);
  const product = normalizeProduct(productInput);
  const settings = store.getSettings(interaction.guildId);
  let claim = orderId ? store.getClaim(orderId, interaction.guildId) : null;
  if (claim && claim.userId !== user.id) return interaction.editReply('This order was claimed by a different member. Resolve the claim before delivering.');
  if (claim?.status === 'delivered') return interaction.editReply('This order is already marked delivered.');

  if (!settings.customerRoleId) return interaction.editReply('❌ Set the Customer role first with **/setup customer-role**.');

  const productRoleId = settings.productRoles?.[product];
  if (!productRoleId) return interaction.editReply(`❌ No Discord role is mapped to **${productInput}**. Use **/product-role set** first.`);

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply('❌ I could not find that member in this server.');

  const actor = await interaction.guild.members.fetch(interaction.user.id);
  for (const roleId of new Set([settings.customerRoleId, productRoleId])) {
    const role = await interaction.guild.roles.fetch(roleId);
    if (!role || role.id === interaction.guildId || role.managed || !role.editable) return interaction.editReply('A delivery role is missing or above my role. Check the role mappings and hierarchy.');
    if (interaction.guild.ownerId !== actor.id && actor.roles.highest.comparePositionTo(role) <= 0) return interaction.editReply('You can only deliver roles below your highest role.');
    if (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageRoles) || role.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.editReply('Delivery roles must not grant server administration permissions.');
  }

  let websiteOrder;
  if (shop.enabled) {
    websiteOrder = await shop.inspectOrder(orderId, product);
    if (claim?.websiteOrderId && claim.websiteOrderId !== websiteOrder.id) return interaction.editReply('The saved website order does not match this reference. Ask the server owner to review it.');
    if (['confirming', 'uncertain'].includes(claim?.websiteDeliveryState) && !websiteOrder.delivered) return interaction.editReply('A previous website confirmation has an uncertain outcome. Check Confirm & Deliver in Shop Payments first, then retry once the website shows delivered. The bot will not send another confirmation automatically.');
  }

  if (orderId && !claim) {
    const result = await store.claimOrder(orderId, {
      orderId, guildId: interaction.guildId, userId: user.id, channelId: interaction.channelId,
      status: 'pending', submittedAt: new Date().toISOString(), submittedBy: interaction.user.id
    });
    if (!result.ok) return interaction.editReply('This order was just claimed. Review its owner and retry.');
    claim = result.claim;
  }

  if (shop.enabled) {
    if (!websiteOrder.delivered) {
      await store.updateClaim(orderId, {
        websiteOrderId: websiteOrder.id, websiteDeliveryState: 'confirming',
        websiteAttemptedAt: new Date().toISOString(), websiteAttemptedBy: interaction.user.id
      }, interaction.guildId);
      try {
        websiteOrder = await shop.confirmOrder(websiteOrder);
      } catch (error) {
        await store.updateClaim(orderId, { websiteDeliveryState: 'uncertain' }, interaction.guildId);
        await sendLog(client, store, interaction.guildId, { title: 'Website delivery requires review', description: `A shop confirmation attempted by <@${interaction.user.id}> did not report completion. Check the order in Payments before retrying. Discord roles were not assigned.`, fields: [{ name: 'Order', value: orderId }] });
        return interaction.editReply(`Website delivery could not be verified. ${error.message} Discord roles were not assigned.`);
      }
    }
    await store.updateClaim(orderId, {
      websiteOrderId: websiteOrder.id, websiteDeliveryState: 'confirmed',
      websiteDeliveredAt: websiteOrder.deliveredAt
    }, interaction.guildId);
  }

  try {
    const reason = orderId
      ? `Delivered ${productInput} • order ${orderId} • by ${interaction.user.tag}`
      : `Delivered ${productInput} by ${interaction.user.tag}`;
    await member.roles.add([settings.customerRoleId, productRoleId], reason);
  } catch (err) {
    return interaction.editReply(`${shop.enabled ? 'Website delivery is complete. Retry /deliver after fixing Discord permissions; the website confirmation will not be repeated. ' : ''}I couldn't assign the roles. Make sure my bot role is above the Customer and product roles and has **Manage Roles**. Discord error: ${err.message}`);
  }

  if (claim && claim.guildId === interaction.guildId && claim.userId === user.id) {
    await store.updateClaim(orderId, {
      status: 'delivered',
      product,
      customerRoleId: settings.customerRoleId,
      productRoleId,
      deliveredBy: interaction.user.id,
      deliveredAt: new Date().toISOString()
    }, interaction.guildId);
  }

  const deliveryReference = orderId ? ` for order **${orderId}**` : '';
  await interaction.editReply(`✅ **${productInput}** delivered to <@${user.id}>${deliveryReference}. ${shop.enabled ? 'Website delivery verified. ' : ''}Customer + product roles were assigned.`);

  if (interaction.channel?.isTextBased()) {
    const tutorialChannelId = settings.tutorialChannels?.[product] || null;
    const tutorialText = tutorialChannelId
      ? `If you need further assistance, the **${productInput} tutorial** is available in <#${tutorialChannelId}>.`
      : 'If you need further assistance, contact staff in this ticket.';

    const deliveryFields = [
      {
        name: '1. Check Your Email',
        value: 'Your key was delivered to the email used to purchase. Check that inbox for your key.'
      },
      {
        name: '2. Download the Loader',
        value: `[Download from TheHudsonShop.com](${DOWNLOADS_URL})\nLog into your account with the email used to purchase, then download the loader.`
      },
      {
        name: '3. Please Vouch',
        value: settings.vouchesChannelId ? `Once everything is working, please leave a vouch in <#${settings.vouchesChannelId}>.` : 'Once everything is working, we would appreciate your feedback.'
      },
      {
        name: 'Need Help?',
        value: tutorialText
      }
    ];

    if (orderId) {
      deliveryFields.push({
        name: 'Order ID',
        value: orderId,
        inline: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Product Access Granted')
      .setDescription(`<@${user.id}>, your **${productInput}** purchase has been delivered.`)
      .addFields(deliveryFields)
      .setFooter({ text: 'The Hudson Shop • Thank you for your purchase!' })
      .setTimestamp();

    const downloadRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(DOWNLOADS_URL)
        .setLabel('Download Loader')
        .setEmoji('⬇️')
    );

    await interaction.channel.send({
      content: `<@${user.id}>`,
      embeds: [embed],
      components: [downloadRow],
      allowedMentions: { users: [user.id] }
    }).catch(() => null);
  }

  const logFields = [
    { name: 'Product', value: productInput, inline: true },
    { name: 'Customer Role', value: `<@&${settings.customerRoleId}>`, inline: true },
    { name: 'Product Role', value: `<@&${productRoleId}>`, inline: true }
  ];
  if (orderId) logFields.push({ name: 'Order ID', value: orderId, inline: true });

  return sendLog(client, store, interaction.guildId, {
    title: 'Product delivered',
    description: `<@${interaction.user.id}> delivered **${productInput}** to <@${user.id}>.`,
    color: 0x57F287,
    fields: logFields
  });
}


return handleDeliver;
}
module.exports = { createDeliveryHandler };
