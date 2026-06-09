const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { removeReward } = require('../utils/database');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'removereward',
  aliases: ['delreward', 'deletereward'],
  description: 'Remove a reward from the server (admin only)',

  async execute(message, args) {
    if (!args[0]) return message.reply({ embeds: [errorEmbed('Usage', '`!removereward <name>`')] });
    if (!isAdmin(message.member)) return message.reply({ embeds: [errorEmbed('No Permission', 'Only admins can do this.')] });
    const ok = removeReward(args[0].toLowerCase(), message.guild.id);
    if (!ok) return message.reply({ embeds: [errorEmbed('Not Found', `No reward \`${args[0]}\` found.`)] });
    return message.reply({ embeds: [successEmbed('Removed', `Reward **${args[0]}** has been removed.`)] });
  },

  data: new SlashCommandBuilder()
    .setName('removereward')
    .setDescription('Remove a reward (admin only)')
    .addStringOption(opt => opt.setName('name').setDescription('Reward name to remove').setRequired(true)),

  async executeSlash(interaction) {
    if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No Permission', 'Admins only.')], ephemeral: true });
    const name = interaction.options.getString('name');
    const ok = removeReward(name.toLowerCase(), interaction.guildId);
    if (!ok) return interaction.reply({ embeds: [errorEmbed('Not Found', `No reward \`${name}\` found.`)] });
    return interaction.reply({ embeds: [successEmbed('Removed', `Reward **${name}** removed.`)] });
  },
};
