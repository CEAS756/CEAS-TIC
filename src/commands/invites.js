const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMemberStats } = require('../utils/database');
const { COLORS, errorEmbed } = require('../utils/embeds');

async function handleInvites(responder, guild, targetUser) {
  const stats = getMemberStats(targetUser.id, guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📨 Invites for ${targetUser.username}`)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '📨 Total Invites', value: `${stats.invites}`, inline: true },
      { name: '🤝 Invited By', value: stats.invited_by ? `<@${stats.invited_by}>` : 'Unknown / Organic', inline: true },
    )
    .setTimestamp();
  return responder.reply({ embeds: [embed] });
}

module.exports = {
  name: 'invites',
  aliases: ['invite'],
  description: 'Check how many people a user has invited',

  async execute(message, args) {
    const target = message.mentions.users.first() || message.author;
    return handleInvites(message, message.guild, target);
  },

  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Check invite count for yourself or another user')
    .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(false)),

  async executeSlash(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    return handleInvites(interaction, interaction.guild, target);
  },
};
