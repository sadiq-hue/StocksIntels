// Signal Publisher - Background worker that publishes signals via Redis.
// Signal generation is owned by signalService (hourly interval + 30-min stale
// background refresh). This worker only republishes the current cached set so it
// never triggers a guards-bypassing full regeneration every cycle.
const { generateSignals } = require('./signalService');
const { connect, publishBatchSignalUpdate, publishSignalNotifications } = require('./queueService');
const { pool } = require('./db');
const engineConfig = require('./engineConfig');

function isMarketOpenNow() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // NSE (Nairobi): 09:00-15:00 EAT = 06:00-12:00 UTC
  if (utcMinutes >= 360 && utcMinutes < 720) return true;
  // US markets: 09:30-16:00 ET
  const month = now.getMonth();
  const isDST = month >= 2 && month <= 9;
  const etOffset = isDST ? -4 : -5;
  const etMinutes = ((utcMinutes + etOffset * 60) % 1440 + 1440) % 1440;
  return etMinutes >= 570 && etMinutes < 960;
}

function getSignalIntervalMs() {
  return engineConfig.getConfig().signalInterval || 300000;
}

let intervalHandle = null;
let running = false;
let lastRatings = new Map();

async function generateAndPublish() {
  if (running) return;
  running = true;

  try {
    const skipMarketHours = process.env.SIGNAL_PUBLISHER_SKIP_MARKET_HOURS === 'true';
    if (!skipMarketHours && !isMarketOpenNow()) {
      console.log(`[SignalPublisher] Markets closed (US hours only), skipping cycle. Set SIGNAL_PUBLISHER_SKIP_MARKET_HOURS=true to bypass.`);
      return;
    }

    const startTime = Date.now();

    // Pull the current cached signal set without forcing a regeneration cycle.
    // quick=true returns the cache immediately (kicking the designed 30-min stale
    // background refresh when needed) instead of running a full generation here.
    const signals = await generateSignals(null, true);
    if (!Array.isArray(signals) || signals.length === 0) return;

    // Publish the current set to Redis subscribers
    await publishBatchSignalUpdate(signals);
    console.log(`[SignalPublisher] Published ${signals.length} signals in ${Date.now() - startTime}ms`);

    // Only notify when a ticker's rating actually changed. Without this every
    // cycle inserts a duplicate notification for every user per significant signal.
    const changedSignals = signals.filter(s => lastRatings.get(s.ticker) !== s.signal);
    for (const s of signals) lastRatings.set(s.ticker, s.signal);
    if (changedSignals.length > 0) {
      const notifications = await createSignalNotifications(changedSignals);
      if (notifications.length > 0) {
        await publishSignalNotifications(notifications);
      }
    }

  } catch (error) {
    console.error('[SignalPublisher] Error:', error.message);
  } finally {
    running = false;
  }
}

function start() {
  if (intervalHandle) return;
  const initialInterval = getSignalIntervalMs();
  console.log(`[SignalPublisher] Starting background worker (interval: ${initialInterval}ms)`);

  // Fire immediately, then schedule
  generateAndPublish();
  function scheduleNext() {
    const ms = getSignalIntervalMs();
    intervalHandle = setTimeout(() => {
      generateAndPublish().finally(() => scheduleNext());
    }, ms);
  }
  scheduleNext();
}

function stop() {
  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
  }
  running = false;
  console.log('[SignalPublisher] Stopped');
}

async function createSignalNotifications(signals) {
  try {
    // Get all users
    const { rows: users } = await pool.query('SELECT id FROM users').catch(() => ({ rows: [] }));
    if (users.length === 0) return [];

    // Only notify for significant signals
    const significantSignals = signals.filter(s =>
      ['Strong Buy', 'Buy', 'Sell', 'Strong Sell'].includes(s.signal)
    );

    if (significantSignals.length === 0) return [];

    const notifications = [];

    for (const user of users) {
      for (const sig of significantSignals) {
        const isBullish = sig.signal === 'Strong Buy' || sig.signal === 'Buy';
        const title = isBullish
          ? `🟢 ${sig.signal} Signal: ${sig.ticker}`
          : `🔴 ${sig.signal} Signal: ${sig.ticker}`;
        const body = `${sig.name} — ${sig.signal} with ${sig.confidence}% confidence. ${sig.sector} | ${sig.market} | Target: ${sig.currency} ${sig.target1}`;
        const link = `/app/stock/${sig.ticker}?market=${sig.market === 'NSE' ? 'nse' : 'us'}`;

        // DB-level dedup: skip if an identical notification was already created
        // for this user/ticker/rating within the last 24h. This protects against
        // duplicate spam after a server restart (lastRatings resets to empty) and
        // when the admin "Generate Signals" endpoint bypasses the in-memory check.
        const dup = await pool.query(
          `SELECT 1 FROM notifications
           WHERE user_id = $1 AND title = $2 AND type = 'signal'
             AND created_at > NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          [user.id, title]
        );
        if (dup.rows.length > 0) continue;

        const { rows } = await pool.query(
          `INSERT INTO notifications (user_id, title, body, type, link)
           VALUES ($1, $2, $3, 'signal', $4)
           RETURNING id, user_id, title, body, type, read, link, created_at`,
          [user.id, title, body, link]
        );
        notifications.push(rows[0]);
      }
    }

    console.log(`[SignalPublisher] Created ${notifications.length} signal notifications for ${users.length} users`);
    return notifications;
  } catch (error) {
    console.error('[SignalPublisher] Notification creation error:', error.message);
    return [];
  }
}

module.exports = { start, stop, generateAndPublish, createSignalNotifications };
