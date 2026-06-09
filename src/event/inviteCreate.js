const { upsertInvite } = require('../utils/database');

module.exports = {
  name: 'inviteCreate',
  async execute(invite, client) {
    upsertInvite(invite.code, invite.guild.id, invite.inviter?.id || 'unknown', invite.uses || 0);
    console.log(`[INVITE] New invite ${invite.code} created by ${invite.inviter?.tag}`);
  },
};
