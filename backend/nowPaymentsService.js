const axios = require('axios');
const crypto = require('crypto');

const NOWPAYMENTS_API = process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || process.env.WEBHOOK_URL || 'https://stockintel-backend-production.up.railway.app';

async function createInvoice({ amount, currency = 'USD', reference, plan, durationMonths, cryptoTicker }) {
  if (!NOWPAYMENTS_API_KEY) {
    throw new Error('NowPayments is not configured. Please set NOWPAYMENTS_API_KEY.');
  }
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const planSlug = (plan || 'starter').toLowerCase();
  const body = {
    price_amount: Number(amount),
    price_currency: (currency || 'USD').toLowerCase(),
    order_id: reference,
    order_description: `StocksIntels ${plan || 'Subscription'} ${period}`,
    ipn_callback_url: `${BACKEND_URL}/api/payments/crypto-webhook`,
    success_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=success&ref=${reference}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=cancelled`,
  };
  if (cryptoTicker) body.pay_currency = String(cryptoTicker).toUpperCase();

  console.log('[NowPayments] Creating invoice:', JSON.stringify({ ...body, ipn_callback_url: '***' }));

  let res;
  try {
    res = await axios.post(`${NOWPAYMENTS_API}/invoice`, body, {
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  } catch (err) {
    if (err.response) {
      console.error('[NowPayments] Invoice error:', err.response.status, JSON.stringify(err.response.data));
    }
    throw err;
  }

  return {
    invoiceUrl: res.data.invoice_url || res.data.payment_url || res.data.url,
    id: res.data.id,
    reference: res.data.order_id || reference,
  };
}

// NowPayments signs each IPN with an HMAC-SHA512 of the raw request body,
// using the IPN secret configured in the NowPayments dashboard.
function verifyIpn(rawBody, signature) {
  if (!NOWPAYMENTS_IPN_SECRET || !signature) return false;
  const expected = crypto.createHmac('sha512', NOWPAYMENTS_IPN_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { createInvoice, verifyIpn };
