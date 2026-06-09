const { startVoiceSession, endVoiceSession } = require('../utils/database');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    const userId = newState.id || oldState.id;
    const guildId = (newState.guild || oldState.guild).id;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    if (!wasInVoice && isInVoice) {
      startVoiceSession(userId, guildId);
    } else if (wasInVoice && !isInVoice) {
      const minutes = endVoiceSession(userId, guildId);
      if (minutes > 0) {
        console.log(`[VOICE] ${userId} left voice — +${minutes}m tracked`);
      }
    }
  },
};
