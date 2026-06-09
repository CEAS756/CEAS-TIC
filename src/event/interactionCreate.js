const { errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.slashCommands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.executeSlash(interaction, client);
    } catch (err) {
      console.error(`[SLASH ERROR] ${interaction.commandName}:`, err);
      const embed = errorEmbed('Command Error', err.message || 'Something went wrong.');
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [embed], ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
      }
    }
  },
};
