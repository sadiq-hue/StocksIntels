const { broker } = require('./apiClient');

const PAYHERO_BASE_URL = process.env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke/api/v2';
const PAYHERO_AUTH_TOKEN = process.env.PAYHERO_AUTH_TOKEN;
const PAYHERO_CHANNEL_ID = process.env.PAYHERO_CHANNEL_ID;
const PAYHERO_CALLBACK_URL = process.env.PAYHERO_CALLBACK_URL;

function generateReference() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let ref = '';
  for (let i = 0; i < 10; i++) {
    ref += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return ref;
}

async function sendStkPush({ amount, phoneNumber, externalReference, customerName }) {
  const ref = externalReference || generateReference();

  const payload = {
    amount,
    phone_number: phoneNumber,
    channel_id: parseInt(PAYHERO_CHANNEL_ID, 10),
    provider: 'm-pesa',
    external_reference: ref,
    customer_name: customerName || 'Customer',
    callback_url: `${PAYHERO_CALLBACK_URL}/api/payments/callback`,
  };

  const response = await broker.post(`${PAYHERO_BASE_URL}/payments`, payload, {
    headers: {
      'Authorization': PAYHERO_AUTH_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  return {
    success: response.data.success,
    status: response.data.status,
    reference: response.data.reference,
    checkoutRequestId: response.data.CheckoutRequestID,
    externalReference: ref,
  };
}

async function checkTransactionStatus(reference) {
  const response = await broker.get(`${PAYHERO_BASE_URL}/transaction-status`, {
    params: { reference },
    headers: {
      'Authorization': PAYHERO_AUTH_TOKEN,
    },
  });

  return {
    success: response.data.success,
    status: response.data.status,
    provider: response.data.provider,
    providerReference: response.data.provider_reference,
    transactionDate: response.data.transaction_date,
  };
}

module.exports = {
  sendStkPush,
  checkTransactionStatus,
  generateReference,
};
