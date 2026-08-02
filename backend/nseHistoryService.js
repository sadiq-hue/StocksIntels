// NSE History Service - durable daily price-history store for Nairobi Securities Exchange stocks.
// Sources (in reliability order):
//   1. KenyanStocks.com API  - authoritative EOD daily OHLCV for all NSE stocks (free, reliable)
//   2. Live intraday quotes  - accumulated daily bars persisted to Postgres so history survives restarts
//   3. MyStocks Africa / Alpha Vantage - best-effort deep-history bootstraps when available
// This replaces the old in-memory-only accumulator which was empty on fresh containers.

const axios = require('axios');
const { pool } = require('./db');

const MAX_BARS = 260; // ~1 year of trading days

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nse_daily_history (
      ticker VARCHAR(20) NOT NULL,
      date DATE NOT NULL,
      open NUMERIC(15,4),
      high NUMERIC(15,4),
      low NUMERIC(15,4),
      close NUMERIC(15,4) NOT NULL,
      volume BIGINT DEFAULT 0,
      source VARCHAR(40) DEFAULT 'live',
      PRIMARY KEY (ticker, date)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_nse_daily_history_ticker_date ON nse_daily_history (ticker, date)`);
}

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

async function getBar(ticker, date) {
  const { rows } = await pool.query(
    'SELECT ticker, date, open, high, low, close, volume, source FROM nse_daily_history WHERE ticker=$1 AND date=$2',
    [ticker, date]
  );
  return rows[0] || null;
}

// Merge a daily bar into the store. For the same ticker+date:
//   - open  keeps the earliest recorded open (live intraday open wins over late seed)
//   - high/low expand to cover both sources
//   - close uses the newest value (EOD seed supersedes intraday)
//   - volume uses the max (avoids double-counting running intraday volume)
// Returns true if a row now exists.
async function upsertBar(ticker, bar, source = 'live') {
  if (!ticker) return false;
  const date = (bar && bar.date) ? String(bar.date).slice(0, 10) : new Date().toISOString().split('T')[0];
  const open = num(bar && bar.open);
  const high = num(bar && bar.high);
  const low = num(bar && bar.low);
  const close = num(bar && bar.close);
  const volume = num(bar && bar.volume) || 0;
  if (close == null || !(close > 0)) return false;

  const existing = await getBar(ticker, date);
  const merged = {
    open: existing && existing.open != null ? num(existing.open) : open,
    high: Math.max(existing && existing.high != null ? num(existing.high) : 0, high != null ? high : 0),
    low: Math.min(
      existing && existing.low != null ? num(existing.low) : (low != null ? low : high != null ? high : close),
      low != null ? low : (existing && existing.low != null ? num(existing.low) : close)
    ),
    close,
    volume: Math.max(existing ? num(existing.volume) || 0 : 0, volume || 0),
    source: source || 'live',
  };

  await pool.query(
    `INSERT INTO nse_daily_history (ticker, date, open, high, low, close, volume, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ticker, date) DO UPDATE SET
       open = EXCLUDED.open,
       high = EXCLUDED.high,
       low = EXCLUDED.low,
       close = EXCLUDED.close,
       volume = EXCLUDED.volume,
       source = EXCLUDED.source`,
    [ticker, date, merged.open, merged.high, merged.low, merged.close, merged.volume, merged.source]
  );
  return true;
}

// Daily bars ascending (oldest first). Returns [] if none.
async function getBars(ticker, limit = MAX_BARS) {
  const { rows } = await pool.query(
    `SELECT date, open, high, low, close, volume, source FROM nse_daily_history
     WHERE ticker=$1 ORDER BY date ASC LIMIT $2`,
    [ticker, limit]
  );
  return rows.map((r) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close: num(r.close),
    volume: num(r.volume) || 0,
    source: r.source,
  }));
}

// Convert DB bars into the price array shape analyzeTechnicals expects
// (array of closes with .volumes/.highs/.lows props). null when <2 bars.
function toPriceArray(bars) {
  if (!bars || bars.length < 2) return null;
  const prices = bars.map((b) => b.close);
  prices.volumes = bars.map((b) => b.volume).filter((v) => v > 0);
  prices.highs = bars.map((b) => b.high);
  prices.lows = bars.map((b) => b.low);
  return prices;
}

// Seed the latest EOD bar for every NSE stock from the KenyanStocks.com API.
// This is the reliable baseline: gives each symbol a real daily bar immediately.
async function seedFromKenyanStocks() {
  try {
    const ks = require('./kenyanStocksScraper');
    const stocks = await ks.getStocksData();
    if (!Array.isArray(stocks) || stocks.length === 0) return { seeded: 0 };
    let seeded = 0;
    for (const s of stocks) {
      const close = num(s.close);
      if (close == null || !(close > 0) || !s.close_date) continue;
      const ok = await upsertBar(
        s.symbol,
        {
          date: s.close_date,
          open: num(s.previous_price) || close,
          high: num(s.high) || close,
          low: num(s.low) || close,
          close,
          volume: num(s.volume) || 0,
        },
        'kenyanstocks'
      );
      if (ok) seeded++;
    }
    if (seeded > 0) console.log(`[NseHistory] Seeded ${seeded} NSE daily bars from KenyanStocks.com`);
    return { seeded };
  } catch (e) {
    console.warn(`[NseHistory] KenyanStocks seed failed: ${e.message}`);
    return { seeded: 0 };
  }
}

// Persist an array of bars ({date, open, high, low, close, volume}) into the
// durable store. The signal engine calls this after every successful MyStocks
// history fetch so that a later MyStocks outage still has history to serve.
async function persistBars(ticker, bars, source = 'mystocksafrica') {
  if (!ticker || !Array.isArray(bars) || bars.length === 0) return 0;
  let n = 0;
  for (const b of bars) {
    const ok = await upsertBar(ticker, b, source);
    if (ok) n++;
  }
  return n;
}

// Best-effort 6-month bootstrap from MyStocks Africa partner API (currently 401; recovers automatically).
async function seedFromMystocksAfrica(ticker) {
  try {
    const msa = require('./mystocksAfricaApi');
    const bars = await msa.fetchHistorical(`NSE:${ticker}`, '6mo');
    if (!bars || bars.length < 2) return 0;
    let n = 0;
    for (const b of bars) {
      const ok = await upsertBar(ticker, b, 'mystocksafrica');
      if (ok) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

// Best-effort daily bootstrap from Alpha Vantage (TIME_SERIES_DAILY, .NR exchange suffix).
// Returns { n, quota } where quota=true means the free-tier daily limit was hit.
async function seedFromAlphaVantage(ticker) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) return { n: 0, quota: true };
  try {
    const resp = await axios.get('https://www.alphavantage.co/query', {
      params: { function: 'TIME_SERIES_DAILY', symbol: `${ticker}.NR`, apikey: key, outputsize: 'compact' },
      timeout: 8000,
    });
    const data = resp.data;
    if (data && data['Information']) return { n: 0, quota: /apologize|spreading out|call frequency/i.test(data.Information) };
    const ts = data && data['Time Series (Daily)'];
    if (!ts || typeof ts !== 'object') return { n: 0, quota: false };
    let n = 0;
    for (const [date, o] of Object.entries(ts)) {
      const ok = await upsertBar(
        ticker,
        { date, open: o['1. open'], high: o['2. high'], low: o['3. low'], close: o['4. close'], volume: o['5. volume'] },
        'alphavantage'
      );
      if (ok) n++;
    }
    return { n, quota: false };
  } catch (e) {
    if (e && e.response && (e.response.status === 429 || e.response.status === 403)) return { n: 0, quota: true };
    return { n: 0, quota: false };
  }
}

// Deep-bootstrap pass for symbols with <2 bars. OPT-IN via NSE_HISTORY_DEEP_BOOTSTRAP=1
// because it consumes the shared Alpha Vantage free-tier quota and makes slow external
// calls at boot. The reliable baseline (KenyanStocks seed + live accumulation) runs always.
const DEEP_BOOTSTRAP_DAILY_CAP = 10;

async function deepBootstrapEnabled() {
  return process.env.NSE_HISTORY_DEEP_BOOTSTRAP === '1';
}

async function deepBootstrapRanToday() {
  try {
    const { rows } = await pool.query(
      `SELECT cache_value FROM app_cache WHERE cache_key = 'nse_history_deep_boot'`
    );
    if (!rows[0]) return false;
    const today = new Date().toISOString().split('T')[0];
    return String(rows[0].cache_value).slice(0, 10) === today;
  } catch {
    return false;
  }
}

async function markDeepBootstrapDone() {
  const today = new Date().toISOString().split('T')[0];
  try {
    await pool.query(
      `INSERT INTO app_cache (cache_key, cache_value, updated_at)
       VALUES ('nse_history_deep_boot', $1, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET cache_value = EXCLUDED.cache_value, updated_at = NOW()`,
      [today]
    );
  } catch { /* best-effort */ }
}

async function bootstrapDeeperHistory() {
  try {
    if (!(await deepBootstrapEnabled()) || (await deepBootstrapRanToday())) return;
    const { NSE_SYMBOLS } = require('./stockData');
    let attempts = 0;
    let quotaHit = false;
    for (const ticker of NSE_SYMBOLS) {
      if (quotaHit || attempts >= DEEP_BOOTSTRAP_DAILY_CAP) break;
      const bars = await getBars(ticker, 2).catch(() => []);
      if (bars.length >= 2) continue;
      attempts++;
      const av = await seedFromAlphaVantage(ticker).catch(() => ({ n: 0, quota: false }));
      if (av.quota) { quotaHit = true; break; }
      if (av.n === 0) {
        const n = await seedFromMystocksAfrica(ticker).catch(() => 0);
        if (n === 0) await new Promise((r) => setTimeout(r, 150));
      }
    }
    await markDeepBootstrapDone();
    console.log('[NseHistory] Deep bootstrap complete (attempts=' + attempts + ' quotaHit=' + quotaHit + ')');
  } catch (e) {
    console.warn('[NseHistory] Deep bootstrap failed:', e.message);
  }
}

// Entry point called at startup. Ensures schema, seeds the reliable baseline,
// then kicks off the optional deep-history bootstrap in the background.
async function bootstrapNseHistory() {
  try {
    await ensureTable();
  } catch (e) {
    console.warn('[NseHistory] ensureTable failed:', e.message);
  }
  try {
    await seedFromKenyanStocks();
  } catch (e) {
    console.warn('[NseHistory] bootstrap seed failed:', e.message);
  }
  // Deep bootstrap (MyStocks Africa / Alpha Vantage) runs non-blocking.
  bootstrapDeeperHistory().catch(() => {});
}

module.exports = {
  ensureTable,
  upsertBar,
  getBars,
  toPriceArray,
  persistBars,
  seedFromKenyanStocks,
  seedFromMystocksAfrica,
  seedFromAlphaVantage,
  bootstrapNseHistory,
  bootstrapDeeperHistory,
};
