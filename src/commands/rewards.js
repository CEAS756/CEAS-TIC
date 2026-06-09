const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listRewards, getUserRewards } = require('../utils/database');
const { infoEmbed, errorEmbed, COLORS } = require('../utils/embeds');

async function handleRewardsList(responder, guildId) {
  const rewards = listRewards(guildId);
  if (!rewards.length) {
    return responder.reply({ embeds: [infoEmbed('Rewards', 'No rewards set up yet. Admin can use `!addreward` to add some.')] });
  }

  const typeIcons = { owo: '🐺', nitro: '💎', inr: '💸', custom: '🎁' };
  const lines = rewards.map(r => {
    const icon = typeIcons[r.type] || '🎁';
    return `${icon} **${r.name}** (${r.type.toUpperCase()})${r.description ? `\n↳ ${r.description}` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle('🎁 Available Rewards')
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `${rewards.length} reward(s) available` })
    .setTimestamp();

  return responder.reply({ embeds: [embed] });
}

async function handleMyRewards(responder, guildId, userId) {
  const rewards = getUserRewards(userId, guildId);
  if (!rewards.length) {
    return responder.reply({ embeds: [infoEmbed('Your Rewards', 'You have not received any rewards yet.')] });
  }

  const statusIcons = { free: '✅', pending: '⏳', paid: '✅', cancelled: '❌' };
  const lines = rewards.map(r => {
    const icon = statusIcons[r.payment_status] || '❓';
    const date = new Date(r.given_at * 1000).toLocaleDateString();
    return `${icon} **${r.name}** — ${r.type.toUpperCase()} | Given by <@${r.given_by}> on ${date}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎁 Your Rewards')
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${rewards.length} reward(s) total` })
    .setTimestamp();

  return responder.reply({ embeds: [embed] });
}

module.exports = {
  name: 'rewards',
  aliases: ['rewardlist', 'myrewards'],
  description: 'List available rewards or your received rewards',

  async execute(message, args) {
    const sub = (args[0] || 'list').toLowerCase();
    if (sub === 'mine' || sub === 'my') {
      return handleMyRewards(message, message.guild.id, message.author.id);
    }
    return handleRewardsList(message, message.guild.id);
  },

  data: new SlashCommandBuilder()
    .setName('rewards')
    .setDescription('View rewards')
    .addStringOption(opt =>
      opt.setName('view')
        .setDescription('What to view')
        .setRequired(false)
        .addChoices(
          { name: 'All Rewards', value: 'list' },
          { name: 'My Rewards', value: 'mine' },
        )
    ),

  async executeSlash(interaction) {
    const view = interaction.options.getString('view') || 'list';
    if (view === 'mine') return handleMyRewards(interaction, interaction.guildId, interaction.user.id);
    return handleRewardsList(interaction, interaction.guildId);
  },
};
