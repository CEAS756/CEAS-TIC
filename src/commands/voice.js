const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getMemberStats } = require('../utils/database');
const { COLORS, formatMinutes } = require('../utils/embeds');

async function handleVoice(responder, guild, targetUser) {
  const stats = getMemberStats(targetUser.id, guild.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`🎤 Voice Time for ${targetUser.username}`)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .addFields({ name: '⏱️ Total Voice Time', value: formatMinutes(stats.voice_minutes), inline: true })
    .setTimestamp();
  return responder.reply({ embeds: [embed] });
}

module.exports = {
  name: 'voice',
  aliases: ['voicetime', 'vc'],
  description: 'Check voice time for yourself or another user',

  async execute(message, args) {
    const target = message.mentions.users.first() || message.author;
    return handleVoice(message, message.guild, target);
  },

  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Check voice time')
    .addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(false)),

  async executeSlash(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    return handleVoice(interaction, interaction.guild, target);
  },
};
