// Web Push notification service.
//
// Stores browser PushSubscription objects per user and delivers compact,
// non-blocking web-push messages (Firebase FCM, Apple APNs, Mozilla autopush).
// VAPID keys are read from env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// The module is safe to require even when VAPID keys are missing — delivery is
// simply a no-op until keys are configured.

const http = require('https');
const webpush = require('web-push');
const { pool } = require('./db');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@stocksintels.com';

webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

// Notification type -> subscription pref key mapping. Mirrors the frontend
// NotificationPrefs shape so users can opt in/out per category from Settings.
const TYPE_TO_PREF = {
  signal: 'tradingSignals',
  message: 'chatMessages',
  news: 'marketNews',
  portfolio: 'portfolioUpdates',
  price_alert: 'priceAlerts',
  nse_report: null, // admin-use-only; never pushed
};
const DEFAULT_PREFS = () => ({
  priceAlerts: true,
  tradingSignals: true,
  marketNews: true,
  portfolioUpdates: true,
  chatMessages: false,
});

function toSubscription(row) {
  try {
    return {
      endpoint: row.endpoint,
      keys: JSON.parse(row.keys),
      prefs: typeof row.prefs === 'string' ? JSON.parse(row.prefs) : row.prefs || DEFAULT_PREFS(),
    };
  } catch {
    return null;
  }
}

async function ensureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    keys TEXT NOT NULL,
    prefs JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );`);
}

/** Upsert a browser subscription for a user (one endpoint = one row). */
async function subscribe({ userId, subscription, prefs }) {
  await ensureTable();
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys) return { error: 'Invalid subscription' };
  const normalizedPrefs = prefs || DEFAULT_PREFS();
  const result = await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, keys, prefs, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       keys = EXCLUDED.keys,
       prefs = EXCLUDED.prefs,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, user_id, endpoint, keys, prefs`,
    [userId, endpoint, JSON.stringify(keys), JSON.stringify(normalizedPrefs)]
  );
  return result.rows[0];
}

/** Remove a subscription (endpoint identified by URL). */
async function unsubscribe({ userId, endpoint }) {
  await ensureTable();
  const result = await pool.query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2 RETURNING id',
    [endpoint, userId]
  );
  return { removed: result.rowCount > 0 };
}

/** Delete all subscriptions registered to an endpoint (e.g. expired token). */
async function removeByEndpoint(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function getSubscriptionsForUser(userId) {
  const { rows } = await pool.query(
    'SELECT id, endpoint, keys, prefs FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  return rows.map(toSubscription).filter(Boolean);
}

async function getSubscriptionsForUsers(userIds) {
  if (!userIds.length) return [];
  const { rows } = await pool.query(
    'SELECT id, user_id, endpoint, keys, prefs FROM push_subscriptions WHERE user_id = ANY($1::int[])',
    [userIds]
  );
  return rows.map((r) => ({ ...toSubscription(r), user_id: r.user_id })).filter(Boolean);
}

function shouldPushForPrefs(prefs, type) {
  const prefKey = TYPE_TO_PREF[type];
  // No category mapping → info/unknown types always pushed.
  if (!prefKey) return true;
  // User without stored prefs → all enabled except chat (matches frontend default).
  if (!prefs || typeof prefs !== 'object') {
    return prefKey !== 'chatMessages';
  }
  if (typeof prefs[prefKey] === 'boolean') return prefs[prefKey];
  return prefKey !== 'chatMessages';
}

function buildPayload(notification) {
  return JSON.stringify({
    title: notification.title || 'StocksIntels',
    body: notification.body || '',
    icon: '/logo1.jpg',
    badge: '/apple-touch-icon.png',
    data: { url: notification.link || '/app/dashboard', id: notification.id, type: notification.type },
    vibrate: [100, 50, 100],
  });
}

function sendOne(subscription, notification) {
  if (!PUBLIC_KEY || !PRIVATE_KEY) return Promise.resolve(false);
  if (!subscription?.endpoint) return Promise.resolve(false);
  const payload = buildPayload(notification);
  return webpush
    .sendNotification(subscription, payload, { TTL: 86400 })
    .then(() => true)
    .catch(async (err) => {
      // 404/410 → subscription expired; drop it so we stop hammering dead endpoints.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        try { await removeByEndpoint(subscription.endpoint); } catch { /* ignore */ }
        return false;
      }
      console.warn('[Push] send failed:', err.statusCode || '', err.message || err);
      return false;
    });
}

/**
 * Deliver a web push to every matching subscription for one user.
 * Respects the user's per-category prefs stored on each subscription.
 */
async function sendPushToUser(userId, notification) {
  try {
    const subs = await getSubscriptionsForUser(userId);
    if (!subs.length) return 0;
    const matches = subs.filter((s) => shouldPushForPrefs(s.prefs, notification.type));
    if (!matches.length) return 0;
    const results = await Promise.all(matches.map((s) => sendOne(s, notification)));
    return results.filter(Boolean).length;
  } catch (err) {
    console.warn('[Push] sendPushToUser error:', err.message);
    return 0;
  }
}

/**
 * Deliver a web push to matching subscriptions for many users at once.
 * userIds: array of numeric ids.
 */
async function sendPushToUsers(userIds, notification) {
  const ids = (userIds || []).filter(Boolean);
  if (!ids.length) return 0;
  try {
    const subs = await getSubscriptionsForUsers(ids);
    if (!subs.length) return 0;
    const matches = subs.filter((s) => shouldPushForPrefs(s.prefs, notification.type));
    if (!matches.length) return 0;
    const results = await Promise.all(matches.map((s) => sendOne(s, notification)));
    return results.filter(Boolean).length;
  } catch (err) {
    console.warn('[Push] sendPushToUsers error:', err.message);
    return 0;
  }
}

module.exports = {
  ensureTable,
  subscribe,
  unsubscribe,
  sendPushToUser,
  sendPushToUsers,
  TYPE_TO_PREF,
};