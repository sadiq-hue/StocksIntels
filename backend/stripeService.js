const Stripe = require('stripe');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

let _stripe;
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');
  }
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

async function createCheckoutSession({ amount, currency = 'usd', reference, plan, durationMonths }) {
  const stripe = getStripe();
  const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
  const planSlug = (plan || 'starter').toLowerCase();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: `StocksIntels ${plan || 'Subscription'} ${period}` },
          unit_amount: Math.round(Number(amount) * 100),
        },
        quantity: 1,
      },
    ],
    client_reference_id: reference,
    metadata: { plan: plan || 'Subscription', duration_months: String(durationMonths || 1) },
    success_url: `${FRONTEND_URL}/subscribe/${planSlug}?stripe=success&ref=${reference}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${planSlug}?stripe=cancelled`,
  });
  return { url: session.url, id: session.id, reference };
}

function verifyWebhook(rawBody, signature) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return null;
  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[STRIPE] Webhook verification failed:', e.message);
    return null;
  }
}

module.exports = { createCheckoutSession, verifyWebhook };
