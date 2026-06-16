const { broker } = require('./apiClient');

const PAYHERO_BASE_URL = process.env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke/api/v2';
const PAYHERO_AUTH_TOKEN = process.env.PAYHERO_AUTH_TOKEN;
const PAYHERO_CHANNEL_ID = process.env.PAYHERO_CHANNEL_ID;
const PAYHERO_CALLBACK_URL = process.env.PAYHERO_CALLBACK_URL;

function getAuthHeader() {
  if (!PAYHERO_AUTH_TOKEN) return null;
  const token = PAYHERO_AUTH_TOKEN.trim();
  const lower = token.toLowerCase();
  if (lower.startsWith('basic ') || lower.startsWith('bearer ')) return token;
  return `Bearer ${token}`;
}

function validateConfig() {
  const missing = [];
  if (!PAYHERO_AUTH_TOKEN) missing.push('PAYHERO_AUTH_TOKEN');
  if (!PAYHERO_CHANNEL_ID) missing.push('PAYHERO_CHANNEL_ID');
  if (!PAYHERO_CALLBACK_URL) missing.push('PAYHERO_CALLBACK_URL');
  if (missing.length > 0) {
    throw new Error(`PayHero configuration missing: ${missing.join(', ')}`);
  }
  const channelId = parseInt(PAYHERO_CHANNEL_ID, 10);
  if (Number.isNaN(channelId)) {
    throw new Error(`PAYHERO_CHANNEL_ID is not a valid number: ${PAYHERO_CHANNEL_ID}`);
  }
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error('PAYHERO_AUTH_TOKEN is empty');
  }
  return { channelId, authHeader };
}

function generateReference() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let ref = '';
  for (let i = 0; i < 10; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

async function sendStkPush({ amount, phoneNumber, externalReference, customerName }) {
  const { channelId, authHeader } = validateConfig();
  const ref = externalReference || generateReference();

  const payload = {
    amount,
    phone_number: phoneNumber,
    channel_id: channelId,
    provider: 'm-pesa',
    external_reference: ref,
    customer_name: customerName || 'Customer',
    callback_url: `${PAYHERO_CALLBACK_URL}/api/payments/callback`,
  };

  console.log('[PayHero] Sending STK push payload:', JSON.stringify({ ...payload, phone_number: '***' }));

  try {
    const response = await broker.post(`${PAYHERO_BASE_URL}/payments`, payload, {
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    });

    console.log('[PayHero] STK push response:', JSON.stringify(response.data));

    return {
      success: response.data?.success,
      status: response.data?.status,
      reference: response.data?.reference,
      checkoutRequestId: response.data?.CheckoutRequestID,
      externalReference: ref,
    };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[PayHero] STK push failed:', err.response?.status, detail);
    throw err;
  }
}

async function checkTransactionStatus(reference) {
  const { authHeader } = validateConfig();
  console.log('[PayHero] Checking status for reference:', reference);

  try {
    const response = await broker.get(`${PAYHERO_BASE_URL}/transaction-status`, {
      params: { reference },
      headers: {
        'Authorization': authHeader,
      },
    });

    console.log('[PayHero] Status response:', JSON.stringify(response.data));

    return {
      success: response.data?.success,
      status: response.data?.status,
      provider: response.data?.provider,
      providerReference: response.data?.provider_reference,
      transactionDate: response.data?.transaction_date,
    };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[PayHero] Status check failed:', err.response?.status, detail);
    throw err;
  }
}

module.exports = {
  sendStkPush,
  checkTransactionStatus,
  generateReference,
};
