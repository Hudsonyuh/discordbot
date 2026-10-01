const { PermissionFlagsBits: P } = require('discord.js');

function hasCommandPermission(interaction, permission, settings) {
  if (!interaction.inGuild?.()) return false;
  if (interaction.memberPermissions?.has(permission)) return true;
  // The configured staff role grants operational commands, not role/configuration authority.
  if (permission !== P.ManageMessages) return false;
  const roles = interaction.member?.roles;
  return Boolean(settings.staffRoleId && (roles?.cache?.has(settings.staffRoleId) || (Array.isArray(roles) && roles.includes(settings.staffRoleId))));
}

async function requirePermission(interaction, permission, store) {
  if (hasCommandPermission(interaction, permission, store.getSettings(interaction.guildId))) return true;
  await interaction.reply({ content: 'You do not have the required server permission for this action.', ephemeral: true });
  return false;
}
module.exports = { hasCommandPermission, requirePermission };
