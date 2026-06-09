const { SlashCommandBuilder } = require('discord.js');
const { getLeaderboard } = require('../utils/database');
const { leaderboardEmbed, formatMinutes, errorEmbed } = require('../utils/embeds');

const TYPES = {
  messages: { label: 'Top Chatters', unit: v => `${v} msgs` },
  voice: { key: 'voice_minutes', label: 'Top Voice', unit: formatMinutes },
  invites: { label: 'Top Inviters', unit: v => `${v} invites` },
};

async function handleLeaderboard(responder, guildId, typeArg = 'messages') {
  const typeKey = typeArg === 'voice' ? 'voice_minutes' : typeArg;
  const meta = TYPES[typeArg] || TYPES.messages;
  const label = meta.label;
  const valueKey = meta.key || typeArg;
  const entries = getLeaderboard(guildId, valueKey);

  return responder.reply({ embeds: [leaderboardEmbed(label, entries, valueKey, meta.unit)] });
}

module.exports = {
  name: 'leaderboard',
  aliases: ['lb', 'top'],
  description: 'Show leaderboard for messages, voice, or invites',

  async execute(message, args) {
    const type = (args[0] || 'messages').toLowerCase();
    if (!['messages', 'voice', 'invites'].includes(type)) {
      return message.reply({ embeds: [errorEmbed('Invalid Type', 'Choose: `messages`, `voice`, or `invites`')] });
    }
    return handleLeaderboard(message, message.guild.id, type);
  },

  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the server leaderboard')
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Leaderboard type')
        .setRequired(false)
        .addChoices(
          { name: 'Messages', value: 'messages' },
          { name: 'Voice Time', value: 'voice' },
          { name: 'Invites', value: 'invites' },
        )
    ),

  async executeSlash(interaction) {
    const type = interaction.options.getString('type') || 'messages';
    return handleLeaderboard(interaction, interaction.guildId, type);
  },
};
