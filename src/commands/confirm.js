const { SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { getPaymentRequest, completePayment, cancelPayment, deleteQRFile } = require('../utils/database');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { deleteQRFile: removeQR } = require('../utils/payment');

async function handleConfirm(responder, guildId, admin, paymentId) {
  if (!isAdmin(admin)) {
    return responder.reply({ embeds: [errorEmbed('No Permission', 'Only admins can confirm payments.')], ephemeral: true });
  }

  const payment = getPaymentRequest(paymentId);
  if (!payment) return responder.reply({ embeds: [errorEmbed('Not Found', `Payment request #${paymentId} not found.`)] });
  if (payment.guild_id !== guildId) return responder.reply({ embeds: [errorEmbed('Not Found', 'Payment not found in this server.')] });
  if (payment.status !== 'pending') {
    return responder.reply({ embeds: [errorEmbed('Already Processed', `Payment #${paymentId} is already **${payment.status}**.`)] });
  }

  completePayment(paymentId);
  removeQR(paymentId);

  return responder.reply({
    embeds: [
      successEmbed('Payment Confirmed!',
        `Payment **#${paymentId}** of ₹${payment.amount} for <@${payment.user_id}> has been confirmed!\n\nReward is now marked as paid.`
      ),
    ],
  });
}

async function handleCancel(responder, guildId, admin, paymentId) {
  if (!isAdmin(admin)) {
    return responder.reply({ embeds: [errorEmbed('No Permission', 'Only admins can cancel payments.')], ephemeral: true });
  }

  const payment = getPaymentRequest(paymentId);
  if (!payment || payment.guild_id !== guildId) return responder.reply({ embeds: [errorEmbed('Not Found', `Payment #${paymentId} not found.`)] });

  cancelPayment(paymentId);
  removeQR(paymentId);

  return responder.reply({
    embeds: [successEmbed('Payment Cancelled', `Payment #${paymentId} has been cancelled.`)],
  });
}

module.exports = {
  name: 'confirm',
  aliases: ['confirmpay', 'pay-confirm'],
  description: 'Confirm a pending payment request',

  async execute(message, args) {
    const id = parseInt(args[0]);
    if (!id) return message.reply({ embeds: [errorEmbed('Usage', '`!confirm <payment_id>`')] });
    return handleConfirm(message, message.guild.id, message.member, id);
  },

  data: new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Confirm a pending payment request')
    .addIntegerOption(opt => opt.setName('id').setDescription('Payment request ID').setRequired(true)),

  async executeSlash(interaction) {
    const id = interaction.options.getInteger('id');
    return handleConfirm(interaction, interaction.guildId, interaction.member, id);
  },
};
