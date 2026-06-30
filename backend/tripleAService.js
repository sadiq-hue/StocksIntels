const axios = require('axios');

const TRIPLE_A_API = process.env.TRIPLE_A_MODE === 'live'
  ? 'https://api.triple-a.io/api/v1'
  : 'https://api.sandbox.triple-a.io/api/v1';

const CLIENT_ID = process.env.TRIPLE_A_CLIENT_ID;
const CLIENT_SECRET = process.env.TRIPLE_A_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://stocksintels-backend.railway.app/api/payments/crypto-webhook';

async function createCheckoutSession({ amount, currency = 'USD', reference, plan, durationMonths }) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const description = `StocksIntels ${plan || 'Subscription'} ${period}`;

  const res = await axios.post(`${TRIPLE_A_API}/checkout/sessions`, {
    amount: Number(amount),
    currency,
    reference,
    description,
    metadata: {
      plan: plan || 'Subscription',
      duration_months: durationMonths || 1,
    },
    success_url: `${FRONTEND_URL}/subscribe/${(plan || 'starter').toLowerCase()}?crypto=success`,
    cancel_url: `${FRONTEND_URL}/subscribe/${(plan || 'starter').toLowerCase()}?crypto=cancelled`,
    webhook_url: `${WEBHOOK_URL}`,
  }, {
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
  });

  return {
    checkoutUrl: res.data.checkout_url,
    sessionId: res.data.session_id,
    reference: res.data.reference || reference,
  };
}

module.exports = { createCheckoutSession };
