const { EmbedBuilder } = require('discord.js');

const COLORS = {
  primary: 0x5865F2,
  success: 0x57F287,
  error: 0xED4245,
  warning: 0xFEE75C,
  info: 0x5865F2,
  gold: 0xF1C40F,
};

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setTimestamp();
}

function statsEmbed(member, stats) {
  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📊 Stats for ${member.displayName}`)
    .setThumbnail(member.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '💬 Messages', value: `${stats.messages}`, inline: true },
      { name: '🎤 Voice Time', value: `${formatMinutes(stats.voice_minutes)}`, inline: true },
      { name: '📨 Invites', value: `${stats.invites}`, inline: true },
      { name: '🤝 Invited By', value: stats.invited_by ? `<@${stats.invited_by}>` : 'Unknown', inline: true },
    )
    .setTimestamp();
}

function leaderboardEmbed(title, entries, valueKey, valueFormatter) {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = entries.map((e, i) => {
    const medal = medals[i] || `**${i + 1}.**`;
    const val = valueFormatter ? valueFormatter(e[valueKey]) : e[valueKey];
    return `${medal} <@${e.user_id}> — ${val}`;
  });

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`🏆 ${title}`)
    .setDescription(lines.join('\n') || 'No data yet.')
    .setTimestamp();
}

function rewardEmbed(reward) {
  const typeIcons = { owo: '🐺', nitro: '💎', inr: '💸', custom: '🎁' };
  const icon = typeIcons[reward.type] || '🎁';
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(`${icon} Reward: ${reward.name}`)
    .setDescription(reward.description || 'No description.')
    .addFields({ name: 'Type', value: reward.type.toUpperCase(), inline: true })
    .setTimestamp();
}

function paymentEmbed(amount, upiId, upiName, paymentId) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('💳 Payment Request')
    .setDescription(`Scan the QR code below or use the UPI ID to complete your payment.\n\nOnce paid, notify the admin to confirm with \`!confirm ${paymentId}\`.`)
    .addFields(
      { name: '💰 Amount', value: `₹${amount}`, inline: true },
      { name: '📱 UPI ID', value: `\`${upiId}\``, inline: true },
      { name: '👤 Pay To', value: upiName, inline: true },
      { name: '🔖 Payment ID', value: `#${paymentId}`, inline: false },
    )
    .setFooter({ text: 'This request will expire after admin confirmation.' })
    .setTimestamp();
}

function formatMinutes(minutes) {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = {
  successEmbed, errorEmbed, infoEmbed, warningEmbed,
  statsEmbed, leaderboardEmbed, rewardEmbed, paymentEmbed, formatMinutes,
  COLORS,
};
