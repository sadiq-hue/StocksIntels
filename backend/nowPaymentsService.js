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
  const baseBody = {
    price_amount: Number(amount),
    price_currency: (currency || 'USD').toLowerCase(),
    order_id: reference,
    order_description: `StocksIntels ${plan || 'Subscription'} ${period}`,
    ipn_callback_url: `${BACKEND_URL}/api/payments/crypto-webhook`,
    success_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=success&ref=${reference}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${planSlug}?crypto=cancelled`,
  };

  const postInvoice = async (body) => {
    console.log('[NowPayments] Creating invoice:', JSON.stringify({ ...body, ipn_callback_url: '***' }));
    const res = await axios.post(`${NOWPAYMENTS_API}/invoice`, body, {
      headers: { 'x-api-key': NOWPAYMENTS_API_KEY, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return res.data;
  };

  const mapResult = (data) => ({
    invoiceUrl: data.invoice_url || data.payment_url || data.url,
    id: data.id,
    reference: data.order_id || reference,
  });

  const body = { ...baseBody };
  if (cryptoTicker) body.pay_currency = String(cryptoTicker).toUpperCase();

  try {
    return mapResult(await postInvoice(body));
  } catch (err) {
    const data = err.response?.data;
    const msg = (data?.message || '') + ' ' + (data?.code || '');
    const currencyUnavailable = /unavailable/i.test(msg) || /currency/i.test(msg) || data?.code === 'INVALID_REQUEST_PARAMS';
    // Some coins (e.g. USDT) may be disabled on new/unverified accounts — fall back
    // to letting the payer choose any available coin on the hosted invoice page.
    if (cryptoTicker && currencyUnavailable) {
      console.warn(`[NowPayments] pay_currency ${cryptoTicker} unavailable — retrying without it`);
      return mapResult(await postInvoice(baseBody));
    }
    if (err.response) {
      console.error('[NowPayments] Invoice error:', err.response.status, JSON.stringify(err.response.data));
    }
    throw err;
  }
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
