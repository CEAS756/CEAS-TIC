const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const qrDir = path.join(__dirname, '../../data/qrcodes');
if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

function buildUPIString(upiId, name, amount, transactionNote = 'Ceas Reward Payment') {
  const params = new URLSearchParams({
    pa: upiId,
    pn: name,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: transactionNote,
  });
  return `upi://pay?${params.toString()}`;
}

async function generatePaymentQR(upiId, upiName, amount, paymentId) {
  const upiString = buildUPIString(upiId, upiName, amount, `Ceas Payment #${paymentId}`);
  const filePath = path.join(qrDir, `payment_${paymentId}.png`);

  await QRCode.toFile(filePath, upiString, {
    errorCorrectionLevel: 'H',
    width: 400,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });

  return filePath;
}

function deleteQRFile(paymentId) {
  const filePath = path.join(qrDir, `payment_${paymentId}.png`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = { generatePaymentQR, buildUPIString, deleteQRFile };
