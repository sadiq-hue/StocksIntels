const { PaydClient, PaydWebhookVerificationError } = require('payd-node-sdk');

const payd = new PaydClient({
  apiUsername: process.env.PAYD_API_USERNAME,
  apiPassword: process.env.PAYD_API_PASSWORD,
  defaultCallbackUrl: `${process.env.PAYD_CALLBACK_URL}/api/payments/payd-callback`,
  defaultUsername: process.env.PAYD_USERNAME,
  walletType: process.env.PAYD_WALLET_TYPE || 'local',
});

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) {
    return `+${digits}`;
  }
  return digits.startsWith('0') ? `+254${digits.slice(1)}` : `+254${digits}`;
}

async function createCardCheckout({ amount, phoneNumber, narration }) {
  const result = await payd.collections.card({
    amount: Math.round(amount),
    phoneNumber: normalizePhone(phoneNumber),
    narration: narration || 'StocksIntels Subscription',
  });
  return { checkoutUrl: result.checkoutUrl };
}

async function checkTransactionStatus(reference) {
  return await payd.transactions.getStatus(reference);
}

function verifyWebhookSignature(payload, signature) {
  return payd.webhooks.verifySignature(payload, signature, process.env.PAYD_API_SECRET);
}

module.exports = {
  createCardCheckout,
  checkTransactionStatus,
  verifyWebhookSignature,
};
