const axios = require('axios');

const isSandbox = process.env.TRIPLE_A_MODE !== 'live';
const TRIPLE_A_API = `https://api.triple-a.io/api/v2`;

const CLIENT_ID = process.env.TRIPLE_A_CLIENT_ID;
const CLIENT_SECRET = process.env.TRIPLE_A_CLIENT_SECRET;
const MERCHANT_KEY = process.env.TRIPLE_A_MERCHANT_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || process.env.WEBHOOK_URL || 'https://stocksintels-backend.railway.app';

async function getAccessToken() {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(`${TRIPLE_A_API}/oauth/token`, {
    grant_type: 'client_credentials',
  }, {
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });
  return res.data.access_token;
}

async function createCheckoutSession({ amount, currency = 'USD', reference, plan, durationMonths, cryptoTicker, cryptoNetwork }) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Triple-A is not configured. Please set TRIPLE_A_CLIENT_ID and TRIPLE_A_CLIENT_SECRET.');
  }

  const accessToken = await getAccessToken();
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const description = `StocksIntels ${plan || 'Subscription'} ${period}`;
  const planSlug = (plan || 'starter').toLowerCase();

  const body = {
    type: 'triplea',
    merchant_key: MERCHANT_KEY || '',
    order_currency: currency,
    order_amount: Number(amount),
    order_id: reference,
    description,
    payer_id: reference,
    notify_url: `${BACKEND_URL}/api/payments/crypto-webhook`,
    success_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=success&ref=${reference}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=cancelled`,
    sandbox: isSandbox,
    metadata: {
      plan: plan || 'Subscription',
      duration_months: durationMonths || 1,
      cryptoTicker: cryptoTicker || null,
      cryptoNetwork: cryptoNetwork || null,
    },
  };

  const res = await axios.post(`${TRIPLE_A_API}/payment`, body, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  return {
    checkoutUrl: res.data.checkout_url || res.data.hosted_url || res.data.url,
    sessionId: res.data.session_id || res.data.id,
    reference: res.data.order_id || reference,
  };
}

module.exports = { createCheckoutSession };