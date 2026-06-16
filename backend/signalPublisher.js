// Signal Publisher - Background worker that generates signals and publishes via Redis
const { generateSignals } = require('./signalService');
const { getQuotesBatch } = require('./marketService');
const { connect, publishBatchSignalUpdate, publishSignalNotifications } = require('./queueService');
const { pool } = require('./db');
const engineConfig = require('./engineConfig');

function isMarketOpenNow() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const month = now.getMonth();
  const isDST = month >= 2 && month <= 9;
  const etOffset = isDST ? -4 : -5;
  const etMinutes = ((utcMinutes + etOffset * 60) % 1440 + 1440) % 1440;
  return etMinutes >= 570 && etMinutes < 960;
}

function getSignalIntervalMs() {
  return engineConfig.getConfig().signalInterval || 300000;
}
const GLOBAL_SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','NFLX',
  'LLY','AVGO','UNH','XOM','PG','JNJ','WMT','CVX','HD','KO',
  'PEP','COST','MRK','ABBV','BAC','TMO','ORCL','CSCO','ADBE','CRM',
  'AMD','INTC','TXN','QCOM','AMGN','IBM','BA','GE','CAT','DIS',
  'MCD','NKE','SBUX','GS','MS','C','WFC','BLK','SCHW','AXP',
  'UPS','RTX','HON','LOW','MMM','MDT','AMAT','MU','NOW','UBER',
  'ABNB','PLTR','SNOW','DDOG','CRWD','PANW','FTNT','SQ','PYPL','COIN',
  'SPCX','NOK','SMCI','RKLB','RDW','ASTS','SATS','IREN','GRAB','PATH',
  'MRVL','CPNG','NU','TTD','ITUB','CCL','SOUN','HPE','VALE','NIO',
  'ARM','MSTR','ROKU','IONQ','HIMS','STLA','CAG','ACHR','PL',
];

const ALL_SYMBOLS = GLOBAL_SYMBOLS;

let intervalHandle = null;
let running = false;

async function generateAndPublish() {
  if (running) return;
  running = true;

  try {
    if (!isMarketOpenNow()) {
      console.log(`[SignalPublisher] Markets closed (weekend/holiday), skipping cycle`);
      return;
    }

    const startTime = Date.now();

    // 1. Fetch live market data
    const marketData = await getQuotesBatch(ALL_SYMBOLS);

    // 2. Build marketData map keyed by ticker as expected by generateSignals
    const liveMarketData = {};
    for (const [symbol, quote] of Object.entries(marketData)) {
      const ticker = symbol.replace('NSE:', '');
      liveMarketData[ticker] = {
        price: quote.price,
        changePercent: quote.changePercent,
        volume: quote.volume,
      };
    }

    // 3. Generate signals using real market data
    const signals = await generateSignals(liveMarketData);

    // 4. Publish all signals via Redis
    if (signals.length > 0) {
      await publishBatchSignalUpdate(signals);
      console.log(`[SignalPublisher] Published ${signals.length} signals in ${Date.now() - startTime}ms`);
    }

    // 5. Create notifications for important signal changes and publish via Redis
    const notifications = await createSignalNotifications(signals);
    if (notifications.length > 0) {
      await publishSignalNotifications(notifications);
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
