const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../utils/embeds');

const HELP_DATA = [
  {
    category: '📊 Tracking',
    commands: [
      { name: '!stats [@user]', desc: 'View messages, voice time, and invites' },
      { name: '!leaderboard [messages|voice|invites]', desc: 'Server leaderboard' },
    ],
  },
  {
    category: '🎁 Rewards',
    commands: [
      { name: '!rewards', desc: 'List all available rewards' },
      { name: '!rewards mine', desc: 'See your received rewards' },
      { name: '!give <reward> @user', desc: 'Give a reward to a user (admin)' },
      { name: '!give 1000inr @user', desc: 'Generate ₹1000 UPI payment QR for a user (admin)' },
      { name: '!confirm <id>', desc: 'Confirm a payment after receiving it (admin)' },
    ],
  },
  {
    category: '⚙️ Admin',
    commands: [
      { name: '!addreward <name> <type> [desc]', desc: 'Add a reward (owo/nitro/inr/custom)' },
      { name: '!removereward <name>', desc: 'Remove a reward' },
      { name: '!setlog #channel', desc: 'Set log channel' },
      { name: '!adminrole @role', desc: 'Add a role as admin for this bot' },
    ],
  },
  {
    category: '🔧 General',
    commands: [
      { name: '!help', desc: 'Show this help menu' },
      { name: '!ping', desc: 'Check bot latency' },
    ],
  },
];

async function handleHelp(responder, prefix) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📖 Ceas Bot — Command Guide')
    .setDescription(`Prefix: \`${prefix}\` • All commands also work as slash commands (/)\n\u200b`)
    .setTimestamp()
    .setFooter({ text: 'Ceas — Invite • Message • Voice • Rewards' });

  HELP_DATA.forEach(section => {
    const value = section.commands.map(c => `\`${c.name}\` — ${c.desc}`).join('\n');
    embed.addFields({ name: section.category, value, inline: false });
  });

  return responder.reply({ embeds: [embed] });
}

module.exports = {
  name: 'help',
  aliases: ['h', 'commands', 'cmds'],
  description: 'Show help menu',

  async execute(message, args, client) {
    return handleHelp(message, client.prefix);
  },

  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all Ceas bot commands'),

  async executeSlash(interaction, client) {
    return handleHelp(interaction, client.prefix);
  },
};
