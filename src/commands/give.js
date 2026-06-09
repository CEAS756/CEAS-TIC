const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const {
  getReward, giveUserReward, hasReceivedReward,
  createPaymentRequest, listRewards,
} = require('../utils/database');
const { generatePaymentQR } = require('../utils/payment');
const { successEmbed, errorEmbed, paymentEmbed } = require('../utils/embeds');

const INR_REGEX = /^(\d+(?:\.\d{1,2})?)inr$/i;

async function handleGive(responder, guildId, giver, targetUser, targetMember, rewardArg) {
  if (!isAdmin(giver)) {
    return responder.reply({ embeds: [errorEmbed('No Permission', 'You need admin permissions to give rewards.')], ephemeral: true });
  }

  const inrMatch = rewardArg.match(INR_REGEX);

  if (inrMatch) {
    const amount = parseFloat(inrMatch[1]);
    if (amount <= 0) return responder.reply({ embeds: [errorEmbed('Invalid Amount', 'Amount must be greater than 0.')] });

    const paymentId = createPaymentRequest(targetUser.id, guildId, amount, giver.id, responder.channelId || responder.channel?.id);

    const upiId = process.env.UPI_ID || 'yourname@upi';
    const upiName = process.env.UPI_NAME || 'Ceas Rewards';

    let qrFile;
    try {
      const filePath = await generatePaymentQR(upiId, upiName, amount, paymentId);
      qrFile = new AttachmentBuilder(filePath, { name: `payment_${paymentId}.png` });
    } catch (err) {
      console.error('[QR] Failed to generate QR:', err.message);
    }

    const embed = paymentEmbed(amount, upiId, upiName, paymentId);
    embed.setDescription(
      `**Payment request for ${targetMember ? targetMember.displayName : targetUser.username}**\n\n` +
      `Scan the QR code or use the UPI ID to send **₹${amount}**.\n\n` +
      `Once payment is done, admin must run:\n\`!confirm ${paymentId}\``
    );

    const payload = { embeds: [embed] };
    if (qrFile) payload.files = [qrFile];

    return responder.reply(payload);
  }

  const reward = getReward(rewardArg.toLowerCase(), guildId);
  if (!reward) {
    const allRewards = listRewards(guildId);
    const list = allRewards.map(r => `\`${r.name}\``).join(', ') || 'None set. Use `!addreward` first.';
    return responder.reply({
      embeds: [errorEmbed('Reward Not Found', `Reward \`${rewardArg}\` not found.\n**Available rewards:** ${list}`)],
    });
  }

  if (hasReceivedReward(targetUser.id, guildId, reward.id)) {
    return responder.reply({
      embeds: [errorEmbed('Already Rewarded', `<@${targetUser.id}> has already received the **${reward.name}** reward and cannot receive it again.`)],
    });
  }

  giveUserReward(targetUser.id, guildId, reward.id, giver.id);

  return responder.reply({
    embeds: [
      successEmbed('Reward Given!', `<@${targetUser.id}> has been given the **${reward.name}** reward!\n\n${reward.description || ''}`),
    ],
  });
}

module.exports = {
  name: 'give',
  aliases: [],
  description: 'Give a reward or INR payment request to a user',
  usage: '!give <amount>inr @user | !give <reward_name> @user',

  async execute(message, args) {
    if (args.length < 2) {
      return message.reply({ embeds: [errorEmbed('Usage', '`!give <reward/amount+inr> @user`\nExamples:\n`!give 1000inr @user`\n`!give nitro @user`')] });
    }

    const rewardArg = args[0];
    const targetUser = message.mentions.users.first();
    if (!targetUser) return message.reply({ embeds: [errorEmbed('Missing User', 'Please mention a user. Example: `!give 1000inr @user`')] });

    const targetMember = message.mentions.members.first();
    return handleGive(message, message.guild.id, message.member, targetUser, targetMember, rewardArg);
  },

  data: new SlashCommandBuilder()
    .setName('give')
    .setDescription('Give a reward or generate a payment request for a user')
    .addUserOption(opt => opt.setName('user').setDescription('The user to reward').setRequired(true))
    .addStringOption(opt => opt.setName('reward').setDescription('Reward name (e.g. nitro, owo) or amount+inr (e.g. 1000inr)').setRequired(true)),

  async executeSlash(interaction) {
    const targetUser = interaction.options.getUser('user');
    const rewardArg = interaction.options.getString('reward');
    const targetMember = interaction.options.getMember('user');
    return handleGive(interaction, interaction.guildId, interaction.member, targetUser, targetMember, rewardArg);
  },
};
