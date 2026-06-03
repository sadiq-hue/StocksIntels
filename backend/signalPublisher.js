// Signal Publisher - Background worker that generates signals and publishes via Redis
const { generateSignals } = require('./signalService');
const { getQuotesBatch } = require('./marketService');
const { connect, publishBatchSignalUpdate, publishSignalNotifications } = require('./queueService');
const { pool } = require('./db');

const SIGNAL_INTERVAL_MS = parseInt(process.env.SIGNAL_INTERVAL_MS || '30000', 10);
const NSE_SYMBOLS = ['SCOM','EQTY','KCB','EABL','BAMB','ABSA','SBIC','KPLC','NMG','CRAY','KLG','OLYM','UMEM','TOTL','STAN','COOP','JUB','KNRE','LKL','CIC','HFCK','IMH'];
const GLOBAL_SYMBOLS = [
  'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','NFLX',
  'LLY','AVGO','UNH','XOM','PG','JNJ','WMT','CVX','HD','KO',
  'PEP','COST','MRK','ABBV','BAC','TMO','ORCL','CSCO','ADBE','CRM',
  'AMD','INTC','TXN','QCOM','AMGN','IBM','BA','GE','CAT','DIS',
  'MCD','NKE','SBUX','GS','MS','C','WFC','BLK','SCHW','AXP',
  'UPS','RTX','HON','LOW','MMM','MDT','AMAT','MU','NOW','UBER',
  'ABNB','PLTR','SNOW','DDOG','CRWD','PANW','FTNT','SQ','PYPL','COIN',
];

const ALL_SYMBOLS = [
  ...NSE_SYMBOLS.map(s => `NSE:${s}`),
  ...GLOBAL_SYMBOLS,
];

let intervalHandle = null;
let running = false;

async function generateAndPublish() {
  if (running) return;
  running = true;

  try {
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

    // 5. Persist signals to database for history
    await persistSignals(signals);

    // 6. Create notifications for important signal changes and publish via Redis
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

async function persistSignals(signals) {
  try {
    const values = signals.map(s => [
      s.ticker,
      s.signal,
      s.confidence,
      s.price,
      s.change || 0,
      s.entry || s.price,
      s.stopLoss || 0,
      s.target1 || 0,
      s.target2 || 0,
      s.riskReward || 1,
      s.sector || 'General',
      s.market || 'Global',
      s.currency || 'USD',
      s.type || 'Swing Trade',
      s.timeframe || '2-4 weeks',
      s.reason || '',
    ]);

    // Batch insert, upsert on conflict (ticker + date bucket)
    const placeholders = values.map((_, i) => {
      const base = i * 16;
      return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11}, $${base+12}, $${base+13}, $${base+14}, $${base+15}, $${base+16}, NOW())`;
    }).join(',');

    const flat = values.flat();
    await pool.query(
      `INSERT INTO signal_history (ticker, signal, confidence, price, change_pct, entry_price, stop_loss, target1, target2, risk_reward, sector, market, currency, trade_type, timeframe, reason, generated_at)
       VALUES ${placeholders}
       ON CONFLICT DO NOTHING`,
      flat
    );
  } catch (error) {
    // signal_history table may not exist yet; log and move on
    if (error.code !== '42P01') {
      console.error('[SignalPublisher] DB persist error:', error.message);
    }
  }
}

function start() {
  if (intervalHandle) return;
  console.log(`[SignalPublisher] Starting background worker (interval: ${SIGNAL_INTERVAL_MS}ms)`);

  // Fire immediately, then on interval
  generateAndPublish();
  intervalHandle = setInterval(generateAndPublish, SIGNAL_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
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

module.exports = { start, stop, generateAndPublish };
