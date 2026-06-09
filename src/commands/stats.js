const { SlashCommandBuilder } = require('discord.js');
const { getMemberStats } = require('../utils/database');
const { statsEmbed, errorEmbed } = require('../utils/embeds');

async function handleStats(responder, guild, targetUser, targetMember) {
  const stats = getMemberStats(targetUser.id, guild.id);
  const member = targetMember || await guild.members.fetch(targetUser.id).catch(() => null);
  return responder.reply({ embeds: [statsEmbed(member || targetUser, stats)] });
}

module.exports = {
  name: 'stats',
  aliases: ['profile', 'rank'],
  description: 'View your or another user\'s stats',

  async execute(message, args) {
    const targetUser = message.mentions.users.first() || message.author;
    const targetMember = message.mentions.members.first() || message.member;
    return handleStats(message, message.guild, targetUser, targetMember);
  },

  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View stats for yourself or another user')
    .addUserOption(opt => opt.setName('user').setDescription('User to check (defaults to you)').setRequired(false)),

  async executeSlash(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const targetMember = interaction.options.getMember('user') || interaction.member;
    return handleStats(interaction, interaction.guild, targetUser, targetMember);
  },
};
