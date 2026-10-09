// Bachs payment service — hosted checkout covering cards, mobile money and
// crypto from one session (adaptive pricing converts a USD price to the
// customer's local currency).
//
// Docs: https://docs.bachs.io
//   Sandbox:    https://sandbox-api.bachs.io   (sk_sandbox_ keys)
//   Production: https://api.bachs.io           (sk_live_ keys)
//
// We charge a one-time amount per billing period and activate our own
// subscription for the chosen duration on confirmation (Bachs subscriptions
// are USD-card-only, so they can't carry crypto / mobile money).

const axios = require('axios');
const crypto = require('crypto');

const API_BASE = (process.env.BACHS_API_URL || 'https://sandbox-api.bachs.io').replace(/\/$/, '');
const API_KEY = process.env.BACHS_API_KEY || '';
const WEBHOOK_SECRET = process.env.BACHS_WEBHOOK_SECRET || '';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://admin.stocksintels.com').replace(/\/$/, '');

function isConfigured() {
  return Boolean(API_KEY);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Bachs reports plan slugs in the redirect URL; keep it to a single lowercase
// word (Core/Pro/Premium) and carry the billing period alongside.
function planSlug(plan) {
  return encodeURIComponent(String(plan || 'pro').trim().toLowerCase().split(/\s+/)[0]);
}

async function createCheckout({ amount, currency = 'USD', reference, plan, durationMonths = 1, userId = null, email, name }) {
  if (!isConfigured()) throw new Error('Bachs is not configured (BACHS_API_KEY missing)');
  const months = parseInt(durationMonths, 10) || 1;
  const period = months >= 12 ? 'yearly' : 'monthly';
  const slug = planSlug(plan);

  const payload = {
    pricing: { currency, amount: Number(amount).toFixed(2) },
    reference: String(reference).slice(0, 128),
    success_url: `${FRONTEND_URL}/subscribe/${slug}?period=${period}&bachs=success&ref=${encodeURIComponent(String(reference))}`,
    cancel_url: `${FRONTEND_URL}/subscribe/${slug}?period=${period}&bachs=cancelled`,
    expires_in_minutes: 60,
    metadata: {
      user_id: userId != null ? String(userId) : '',
      plan: String(plan || ''),
      duration_months: String(months),
    },
  };
  if (email) payload.customer = { email, ...(name ? { name } : {}) };

  const res = await axios.post(`${API_BASE}/v1/checkout-sessions`, payload, {
    headers: authHeaders(),
    timeout: 20000,
  });
  const data = res.data || {};
  return {
    checkoutId: data.checkout_id,
    checkoutUrl: data.checkout_url,
    status: data.status,
    reference: data.reference,
  };
}

async function getCheckout(checkoutId) {
  if (!isConfigured()) throw new Error('Bachs is not configured (BACHS_API_KEY missing)');
  const res = await axios.get(`${API_BASE}/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, {
    headers: authHeaders(),
    timeout: 15000,
  });
  return res.data || {};
}

// A checkout is paid when the session's payment status or the underlying charge
// status has terminal-succeeded, or nothing remains outstanding on the charge.
function isPaid(session) {
  if (!session) return false;
  const terminal = ['succeeded', 'paid', 'completed', 'successful'];
  const ps = String(session.payment_status || '').toLowerCase();
  const cs = String(session.charge?.status || '').toLowerCase();
  if (terminal.includes(ps)) return true;
  if (terminal.includes(cs)) return true;
  const remaining = parseFloat(session.charge?.amount_remaining);
  const paid = parseFloat(session.charge?.amount_paid);
  return Number.isFinite(remaining) && remaining === 0 && Number.isFinite(paid) && paid > 0;
}

// Verify a Bachs webhook signature. Accepts the preferred X-Bachs-Signature-V2
// header (t=...,v1=...) and the legacy X-Bachs-Signature + X-Bachs-Timestamp
// headers. When no signing secret is configured this returns true; the caller
// then relies on the API re-query (getCheckout/isPaid) for trust.
function verifyWebhook(rawBody, headers) {
  if (!WEBHOOK_SECRET) return true;
  const h = headers || {};
  const v2 = h['x-bachs-signature-v2'];
  let timestamp;
  let signatures = [];
  if (v2) {
    for (const part of String(v2).split(',')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === 't') timestamp = v;
      else if (k === 'v1') signatures.push(v);
    }
  } else {
    timestamp = h['x-bachs-timestamp'];
    if (h['x-bachs-signature']) signatures = [String(h['x-bachs-signature'])];
  }
  if (!timestamp || signatures.length === 0) return false;

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${ts}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  return signatures.some((s) => {
    const buf = Buffer.from(String(s));
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });
}

module.exports = { isConfigured, createCheckout, getCheckout, isPaid, verifyWebhook, API_BASE };
