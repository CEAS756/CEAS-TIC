const { ActivityType } = require('discord.js');
const { registerSlashCommands } = require('../utils/loader');
const { upsertInvite } = require('../utils/database');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`[READY] Logged in as ${client.user.tag}`);
    client.user.setActivity('your invites 👀', { type: ActivityType.Watching });

    for (const [, guild] of client.guilds.cache) {
      try {
        const invites = await guild.invites.fetch();
        invites.forEach(invite => {
          upsertInvite(invite.code, guild.id, invite.inviter?.id || 'unknown', invite.uses || 0);
        });
        console.log(`[INVITES] Cached ${invites.size} invites for ${guild.name}`);
      } catch (err) {
        console.warn(`[INVITES] Could not fetch invites for ${guild.name}:`, err.message);
      }
    }

    await registerSlashCommands(client);
  },
};
