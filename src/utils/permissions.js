const { getGuildSettings } = require('./database');

function isOwner(userId) {
  return userId === process.env.OWNER_ID;
}

function isAdmin(member) {
  if (isOwner(member.id)) return true;
  if (member.permissions.has('Administrator')) return true;

  const settings = getGuildSettings(member.guild.id);
  let adminRoles = [];
  try { adminRoles = JSON.parse(settings.admin_roles || '[]'); } catch {}

  return member.roles.cache.some(r => adminRoles.includes(r.id));
}

function requireAdmin(interaction_or_message) {
  const member = interaction_or_message.member;
  if (!isAdmin(member)) {
    return false;
  }
  return true;
}

module.exports = { isOwner, isAdmin, requireAdmin };
