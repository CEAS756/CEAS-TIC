const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { getGuildSettings, setGuildSetting } = require('../utils/database');
const { successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');

module.exports = {
  name: 'adminrole',
  aliases: ['setadmin'],
  description: 'Add or remove a bot admin role',

  async execute(message, args) {
    if (!isAdmin(message.member)) return message.reply({ embeds: [errorEmbed('No Permission', 'Server admins only.')] });

    const sub = args[0];
    if (!sub || !['add', 'remove', 'list'].includes(sub)) {
      return message.reply({ embeds: [errorEmbed('Usage', '`!adminrole add @role`\n`!adminrole remove @role`\n`!adminrole list`')] });
    }

    const settings = getGuildSettings(message.guild.id);
    let roles = [];
    try { roles = JSON.parse(settings.admin_roles || '[]'); } catch {}

    if (sub === 'list') {
      const list = roles.length ? roles.map(r => `<@&${r}>`).join(', ') : 'None';
      return message.reply({ embeds: [infoEmbed('Bot Admin Roles', list)] });
    }

    const role = message.mentions.roles.first();
    if (!role) return message.reply({ embeds: [errorEmbed('Missing Role', 'Please mention a role.')] });

    if (sub === 'add') {
      if (!roles.includes(role.id)) roles.push(role.id);
    } else {
      roles = roles.filter(r => r !== role.id);
    }

    setGuildSetting(message.guild.id, 'admin_roles', JSON.stringify(roles));
    return message.reply({ embeds: [successEmbed('Updated', `${sub === 'add' ? 'Added' : 'Removed'} ${role} as a bot admin role.`)] });
  },

  data: new SlashCommandBuilder()
    .setName('adminrole')
    .setDescription('Manage bot admin roles')
    .addSubcommand(sc => sc.setName('add').setDescription('Add admin role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Remove admin role').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(sc => sc.setName('list').setDescription('List admin roles')),

  async executeSlash(interaction) {
    if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [errorEmbed('No Permission', 'Server admins only.')], ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const settings = getGuildSettings(interaction.guildId);
    let roles = [];
    try { roles = JSON.parse(settings.admin_roles || '[]'); } catch {}

    if (sub === 'list') {
      const list = roles.length ? roles.map(r => `<@&${r}>`).join(', ') : 'None';
      return interaction.reply({ embeds: [infoEmbed('Bot Admin Roles', list)] });
    }

    const role = interaction.options.getRole('role');
    if (sub === 'add') {
      if (!roles.includes(role.id)) roles.push(role.id);
    } else {
      roles = roles.filter(r => r !== role.id);
    }
    setGuildSetting(interaction.guildId, 'admin_roles', JSON.stringify(roles));
    return interaction.reply({ embeds: [successEmbed('Updated', `${sub === 'add' ? 'Added' : 'Removed'} ${role} as a bot admin role.`)] });
  },
};
