const { incrementMessages } = require('../utils/database');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return;

    incrementMessages(message.author.id, message.guild.id);

    const prefix = client.prefix;

    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
      await command.execute(message, args, client);
    } catch (err) {
      console.error(`[CMD ERROR] ${commandName}:`, err);
      message.reply({ embeds: [errorEmbed('Command Error', err.message || 'Something went wrong.')] }).catch(() => {});
    }
  },
};
