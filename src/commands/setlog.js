const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { setGuildSetting } = require('../utils/database');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'setlog',
  aliases: ['logchannel'],
  description: 'Set the log channel (admin only)',

  async execute(message, args) {
    if (!isAdmin(message.member)) return message.reply({ embeds: [errorEmbed('No Permission', 'Admins only.')] });
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply({ embeds: [errorEmbed('Usage', '`!setlog #channel`')] });
    setGuildSetting(message.guild.id, 'log_channel', channel.id);
    return message.reply({ embeds: [successEmbed('Log Channel Set', `Logs will be sent to ${channel}.`)] });
  },

  data: new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Set the bot log channel (admin only)')
    .addChannelOption(opt => opt.setName('channel').setDescription('Log channel').setRequired(true)),

  async executeSlash(interaction) {
    if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No Permission', 'Admins only.')], ephemeral: true });
    const channel = interaction.options.getChannel('channel');
    setGuildSetting(interaction.guildId, 'log_channel', channel.id);
    return interaction.reply({ embeds: [successEmbed('Log Channel Set', `Logs will be sent to ${channel}.`)] });
  },
};
