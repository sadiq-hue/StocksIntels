const axios = require('axios');
const qs = require('querystring');

const isSandbox = process.env.TRIPLE_A_MODE !== 'live';
const TRIPLE_A_API = `https://api.triple-a.io/api/v2`;

const CLIENT_ID = process.env.TRIPLE_A_CLIENT_ID;
const CLIENT_SECRET = process.env.TRIPLE_A_CLIENT_SECRET;
const MERCHANT_KEY = process.env.TRIPLE_A_MERCHANT_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || process.env.WEBHOOK_URL || 'https://stocksintels-backend.railway.app';

async function getAccessToken() {
  const res = await axios.post(`${TRIPLE_A_API}/oauth/token`,
    qs.stringify({
      client_id: CLIENT_ID,
      grant_type: 'client_credentials',
      client_secret: CLIENT_SECRET,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  );
  return res.data.access_token;
}

async function createCheckoutSession({ amount, currency = 'USD', reference, plan, durationMonths, cryptoTicker, cryptoNetwork }) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Triple-A is not configured. Please set TRIPLE_A_CLIENT_ID and TRIPLE_A_CLIENT_SECRET.');
  }

  const accessToken = await getAccessToken();
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const planSlug = (plan || 'starter').toLowerCase();

  const body = {
    type: 'triplea',
    merchant_key: MERCHANT_KEY || '',
    order_currency: currency,
    order_amount: Number(amount),
    order_id: reference,
    payer_id: reference,
    success_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=success&ref=${reference}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=cancelled`,
    notify_url: `${BACKEND_URL}/api/payments/crypto-webhook`,
    sandbox: isSandbox,
    cart: {
      items: [
        {
          amount: Number(amount),
          quantity: 1,
          label: `StocksIntels ${plan || 'Subscription'} ${period}`,
          sku: reference,
        },
      ],
      shipping_cost: 0,
      shipping_discount: 0,
      tax_cost: 0,
    },
    metadata: {
      plan: plan || 'Subscription',
      duration_months: durationMonths || 1,
      cryptoTicker: cryptoTicker || null,
      cryptoNetwork: cryptoNetwork || null,
    },
  };

  let res;
  try {
    res = await axios.post(`${TRIPLE_A_API}/payment`, body, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  } catch (err) {
    if (err.response) {
      console.error('Triple-A API error:', {
        status: err.response.status,
        data: JSON.stringify(err.response.data),
        headers: err.response.headers,
      });
    }
    throw err;
  }

  return {
    checkoutUrl: res.data.checkout_url || res.data.hosted_url || res.data.url,
    sessionId: res.data.session_id || res.data.id || res.data.payment_reference,
    reference: res.data.order_id || reference,
  };
}

module.exports = { createCheckoutSession };