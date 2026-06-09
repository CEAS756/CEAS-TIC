const { SlashCommandBuilder } = require('discord.js');
const { infoEmbed } = require('../utils/embeds');

module.exports = {
  name: 'ping',
  aliases: ['latency'],
  description: 'Check bot latency',

  async execute(message, args, client) {
    const sent = await message.reply({ embeds: [infoEmbed('Pinging...', '⏱️')] });
    const latency = sent.createdTimestamp - message.createdTimestamp;
    await sent.edit({ embeds: [infoEmbed('Pong! 🏓', `Latency: **${latency}ms**\nAPI: **${client.ws.ping}ms**`)] });
  },

  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency'),

  async executeSlash(interaction, client) {
    await interaction.reply({ embeds: [infoEmbed('Pong! 🏓', `Latency: **${client.ws.ping}ms**`)] });
  },
};
