const axios = require('axios');

const PAYPAL_API = process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_RETURN_URL = process.env.PAYPAL_RETURN_URL;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;

  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(`${PAYPAL_API}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  accessToken = res.data.access_token;
  tokenExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;
  return accessToken;
}

async function createOrder({ amount, currency = 'USD', description, externalReference }) {
  const token = await getAccessToken();
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: externalReference,
      description: description || 'StocksIntels Subscription',
      amount: {
        currency_code: currency,
        value: amount.toFixed(2),
      },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: `${PAYPAL_RETURN_URL}/api/payments/paypal-capture`,
          cancel_url: `${PAYPAL_RETURN_URL}/api/payments/paypal-cancel`,
        },
      },
    },
  };

  const res = await axios.post(`${PAYPAL_API}/v2/checkout/orders`, payload, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const approveLink = res.data.links.find(l => l.rel === 'payer-action');
  return {
    orderId: res.data.id,
    status: res.data.status,
    checkoutUrl: approveLink?.href,
  };
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await axios.post(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {}, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const capture = res.data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: res.data.id,
    status: res.data.status,
    captureStatus: capture?.status,
    captureId: capture?.id,
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    payerEmail: res.data.payer?.email_address,
    payerName: `${res.data.payer?.name?.given_name || ''} ${res.data.payer?.name?.surname || ''}`.trim(),
    referenceId: res.data.purchase_units?.[0]?.reference_id,
    createTime: res.data.create_time,
    updateTime: res.data.update_time,
  };
}

async function verifyWebhookSignature(headers, body) {
  try {
    const token = await getAccessToken();
    const payload = {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: body,
    };
    const res = await axios.post(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}

module.exports = {
  createOrder,
  captureOrder,
  verifyWebhookSignature,
};
