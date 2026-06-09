const { setInvitedBy, upsertInvite, getAllInvites, getOrCreateMember } = require('../utils/database');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    const guild = member.guild;
    getOrCreateMember(member.id, guild.id);

    try {
      const newInvites = await guild.invites.fetch();
      const oldInviteData = getAllInvites(guild.id);
      const oldMap = {};
      oldInviteData.forEach(i => { oldMap[i.invite_code] = i.uses; });

      let usedInviter = null;

      for (const [code, invite] of newInvites) {
        const oldUses = oldMap[code] ?? 0;
        const newUses = invite.uses ?? 0;
        if (newUses > oldUses) {
          usedInviter = invite.inviter?.id || null;
          upsertInvite(code, guild.id, invite.inviter?.id || 'unknown', newUses);
        } else {
          upsertInvite(code, guild.id, invite.inviter?.id || oldMap[code] || 'unknown', newUses);
        }
      }

      if (usedInviter) {
        setInvitedBy(member.id, guild.id, usedInviter);
        console.log(`[INVITE] ${member.user.tag} joined via ${usedInviter}`);
      }
    } catch (err) {
      console.warn('[INVITE] Could not track invite:', err.message);
    }
  },
};
