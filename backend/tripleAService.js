const axios = require('axios');

const TRIPLE_A_API = process.env.TRIPLE_A_MODE === 'live'
  ? 'https://api.triple-a.io/api/v1'
  : 'https://api.sandbox.triple-a.io/api/v1';

const CLIENT_ID = process.env.TRIPLE_A_CLIENT_ID;
const CLIENT_SECRET = process.env.TRIPLE_A_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || process.env.WEBHOOK_URL || 'https://stocksintels-backend.railway.app';
const WEBHOOK_URL = `${BACKEND_URL}/api/payments/crypto-webhook`;

async function createCheckoutSession({ amount, currency = 'USD', reference, plan, durationMonths, cryptoTicker, cryptoNetwork }) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Triple-A is not configured. Please set TRIPLE_A_CLIENT_ID and TRIPLE_A_CLIENT_SECRET.');
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const description = `StocksIntels ${plan || 'Subscription'} ${period}`;
  const planSlug = (plan || 'starter').toLowerCase();

  const body = {
    amount: Number(amount),
    currency,
    reference,
    description,
    metadata: {
      plan: plan || 'Subscription',
      duration_months: durationMonths || 1,
      cryptoTicker: cryptoTicker || null,
      cryptoNetwork: cryptoNetwork || null,
    },
    success_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=success&ref=${reference}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=cancelled`,
    webhook_url: `${WEBHOOK_URL}`,
  };

  const res = await axios.post(`${TRIPLE_A_API}/checkout/sessions`, body, {
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  return {
    checkoutUrl: res.data.checkout_url,
    sessionId: res.data.session_id,
    reference: res.data.reference || reference,
  };
}

module.exports = { createCheckoutSession };
