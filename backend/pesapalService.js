const axios = require('axios');

const PESAPAL_ENV = process.env.PESAPAL_ENV === 'production' ? 'production' : 'sandbox';
const BASE = PESAPAL_ENV === 'production'
  ? 'https://pay.pesapal.com/v3/api'
  : 'https://cybqa.pesapal.com/pesapalv3/api';
const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || process.env.WEBHOOK_URL || 'https://stockintel-backend-production.up.railway.app';
const IPN_URL = process.env.PESAPAL_IPN_URL || `${BACKEND_URL}/api/payments/pesapal-ipn`;

let _token = null;
let _tokenExpiry = 0;
let _ipnId = null;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('Pesapal is not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET.');
  }
  const res = await axios.post(`${BASE}/Auth/RequestToken`, {
    consumer_key: CONSUMER_KEY,
    consumer_secret: CONSUMER_SECRET,
  });
  if (res.data && res.data.token) {
    const exp = res.data.expiryDate ? new Date(res.data.expiryDate).getTime() : Date.now() + 50 * 60 * 1000;
    _tokenExpiry = exp - 60000;
    _token = res.data.token;
    return _token;
  }
  throw new Error('Pesapal auth failed: ' + JSON.stringify(res.data));
}

async function getIpnId() {
  if (_ipnId) return _ipnId;
  if (process.env.PESAPAL_IPN_ID) {
    _ipnId = process.env.PESAPAL_IPN_ID;
    return _ipnId;
  }
  const token = await getToken();
  try {
    const res = await axios.post(`${BASE}/URLSetup/RegisterIPN`, {
      url: IPN_URL,
      ipn_notification_type: 'GET',
    }, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    _ipnId = res.data.ipn_id || res.data.ipnId;
    if (_ipnId) return _ipnId;
  } catch (e) {
    console.error('[PESAPAL] RegisterIPN failed:', e.message);
  }
  throw new Error('Pesapal IPN not registered. Set PESAPAL_IPN_ID or ensure the IPN URL is reachable.');
}

async function createOrder({ amount, currency = 'USD', reference, plan, durationMonths }) {
  const token = await getToken();
  const ipnId = await getIpnId();
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const planSlug = (plan || 'starter').toLowerCase();
  const body = {
    amount: Number(amount).toFixed(2),
    currency: (currency || 'USD').toUpperCase(),
    description: `StocksIntels ${plan || 'Subscription'} ${period}`,
    callback_url: `${FRONTEND_URL}/subscribe/${planSlug}?pesapal=success&ref=${reference}`,
    notification_id: ipnId,
    merchant_reference: reference,
    billing_address: { email_address: '', phone_number: '', country_code: 'KE', first_name: 'Customer', last_name: 'Customer' },
  };
  const res = await axios.post(`${BASE}/Transactions/SubmitOrderRequest`, body, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  if (res.data && res.data.redirect_url) {
    return {
      redirectUrl: res.data.redirect_url,
      orderTrackingId: res.data.order_tracking_id,
      reference: res.data.merchant_reference || reference,
    };
  }
  throw new Error('Pesapal order creation failed: ' + JSON.stringify(res.data));
}

async function getStatus(orderTrackingId) {
  const token = await getToken();
  const res = await axios.get(`${BASE}/Transactions/GetTransactionStatus`, {
    params: { orderTrackingId },
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.data;
}

module.exports = { createOrder, getStatus, getIpnId, BASE };
