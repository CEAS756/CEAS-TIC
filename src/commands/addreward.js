const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { addReward, removeReward } = require('../utils/database');
const { successEmbed, errorEmbed } = require('../utils/embeds');

const VALID_TYPES = ['owo', 'nitro', 'inr', 'custom'];

async function handleAdd(responder, guildId, admin, name, type, description) {
  if (!isAdmin(admin)) return responder.reply({ embeds: [errorEmbed('No Permission', 'Only admins can manage rewards.')], ephemeral: true });
  if (!VALID_TYPES.includes(type)) {
    return responder.reply({ embeds: [errorEmbed('Invalid Type', `Valid types: \`${VALID_TYPES.join(', ')}\``)] });
  }

  const ok = addReward(name.toLowerCase(), type.toLowerCase(), description || '', guildId);
  if (!ok) return responder.reply({ embeds: [errorEmbed('Duplicate', `A reward named \`${name}\` already exists.`)] });

  return responder.reply({ embeds: [successEmbed('Reward Added', `Reward **${name}** (${type.toUpperCase()}) has been added!\n${description || ''}`)] });
}

async function handleRemove(responder, guildId, admin, name) {
  if (!isAdmin(admin)) return responder.reply({ embeds: [errorEmbed('No Permission', 'Only admins can manage rewards.')], ephemeral: true });
  const ok = removeReward(name.toLowerCase(), guildId);
  if (!ok) return responder.reply({ embeds: [errorEmbed('Not Found', `No reward named \`${name}\` found.`)] });
  return responder.reply({ embeds: [successEmbed('Reward Removed', `Reward **${name}** has been removed.`)] });
}

module.exports = {
  name: 'addreward',
  aliases: ['newreward'],
  description: 'Add a reward to the server',

  async execute(message, args) {
    if (args.length < 2) {
      return message.reply({ embeds: [errorEmbed('Usage', '`!addreward <name> <type> [description]`\nTypes: `owo`, `nitro`, `inr`, `custom`\nExample: `!addreward nitro nitro Discord Nitro gift`')] });
    }
    const [name, type, ...descParts] = args;
    return handleAdd(message, message.guild.id, message.member, name, type, descParts.join(' '));
  },

  data: new SlashCommandBuilder()
    .setName('addreward')
    .setDescription('Add a new reward (admin only)')
    .addStringOption(opt => opt.setName('name').setDescription('Reward name').setRequired(true))
    .addStringOption(opt =>
      opt.setName('type').setDescription('Reward type').setRequired(true)
        .addChoices(
          { name: 'OWO Currency', value: 'owo' },
          { name: 'Discord Nitro', value: 'nitro' },
          { name: 'INR Payment', value: 'inr' },
          { name: 'Custom', value: 'custom' },
        )
    )
    .addStringOption(opt => opt.setName('description').setDescription('Optional description').setRequired(false)),

  async executeSlash(interaction) {
    const name = interaction.options.getString('name');
    const type = interaction.options.getString('type');
    const description = interaction.options.getString('description') || '';
    return handleAdd(interaction, interaction.guildId, interaction.member, name, type, description);
  },
};
