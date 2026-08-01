// Sentiment History Service - durable per-symbol news sentiment store.
// Persists every fetched article's per-symbol sentiment so a symbol keeps a
// recent sentiment even on days when the live feed has no fresh article for it
// ("previous sentiments"). Historical sentiment is merged back into the live
// aggregation with a recency decay so quiet days don't erase a signal.

const { pool } = require('./db');

const HISTORY_WINDOW_DAYS = 14; // merge window for getHistorical
const PRUNE_AFTER_DAYS = 30;    // drop rows older than this

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_sentiment_history (
      article_id TEXT NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      headline TEXT,
      source VARCHAR(80),
      sentiment VARCHAR(20) NOT NULL,
      sentiment_score DOUBLE PRECISION,
      published_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (article_id, symbol)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_news_sentiment_symbol_time ON news_sentiment_history (symbol, published_at)`);
  // Catalyst columns added idempotently for pre-existing tables.
  await pool.query(`ALTER TABLE news_sentiment_history ADD COLUMN IF NOT EXISTS hot_type VARCHAR(30)`);
  await pool.query(`ALTER TABLE news_sentiment_history ADD COLUMN IF NOT EXISTS catalyst_direction VARCHAR(10)`);
  await pool.query(`ALTER TABLE news_sentiment_history ADD COLUMN IF NOT EXISTS catalyst_strength SMALLINT`);
}

// Recency weight for a row aged `ageDays`, linear decay over `window` days.
function ageWeight(ageDays, window = HISTORY_WINDOW_DAYS) {
  const w = 1 - (ageDays / Math.max(1, window));
  return Math.max(0.15, w);
}

// Persist articles -> one row per (article, relatedStock). Idempotent.
async function persist(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return 0;
  const params = [];
  const valueGroups = [];
  let inserted = 0;

  const flush = async () => {
    if (valueGroups.length === 0) return;
    const sql = `
      INSERT INTO news_sentiment_history (article_id, symbol, headline, source, sentiment, sentiment_score, published_at, hot_type, catalyst_direction, catalyst_strength)
      VALUES ${valueGroups.join(', ')}
      ON CONFLICT (article_id, symbol) DO NOTHING
    `;
    const res = await pool.query(sql, params);
    inserted += res.rowCount || 0;
    params.length = 0;
    valueGroups.length = 0;
  };

  for (const a of articles) {
    const syms = Array.isArray(a.relatedStocks) ? a.relatedStocks : [];
    if (syms.length === 0) continue;
    const publishedAt = a.publishedAt ? new Date(a.publishedAt) : new Date();
    if (isNaN(publishedAt.getTime())) continue;
    const sentiment = ['positive', 'negative', 'neutral'].includes(a.sentiment) ? a.sentiment : 'neutral';
    const score = a.sentimentScore != null && isFinite(Number(a.sentimentScore)) ? Number(a.sentimentScore) : null;
    const hotType = a.catalystDirection
      ? String(a.catalyst || '').slice(0, 30)
      : String(a.hotType || '').slice(0, 30);
    const catDir = ['positive', 'negative'].includes(a.catalystDirection) ? String(a.catalystDirection) : null;
    const catStrength = a.catalystDirection && a.catalystStrength != null && !isNaN(Number(a.catalystStrength)) ? Number(a.catalystStrength) : null;
    for (const sym of syms) {
      const s = String(sym || '').toUpperCase().trim();
      if (!s) continue;
      params.push(
        String(a.id || ''), s, String(a.headline || '').slice(0, 300), String(a.source || '').slice(0, 80),
        sentiment, score, publishedAt, hotType, catDir, catStrength
      );
      valueGroups.push(`($${params.length - 9}, $${params.length - 8}, $${params.length - 7}, $${params.length - 6}, $${params.length - 5}, $${params.length - 4}, $${params.length - 3}, $${params.length - 2}, $${params.length - 1}, $${params.length})`);
      if (valueGroups.length >= 200) await flush();
    }
  }
  await flush();
  return inserted;
}

// Per-symbol dominant sentiment over the last `days`, weighted by recency.
// Returns { SYMBOL: 'positive' | 'negative' | 'neutral' }.
async function getHistorical(days = HISTORY_WINDOW_DAYS) {
  const { rows } = await pool.query(
    `SELECT symbol, sentiment, published_at FROM news_sentiment_history
     WHERE published_at >= now() - ($1::int * interval '1 day')`,
    [days]
  );
  const agg = {};
  for (const r of rows) {
    const sym = String(r.symbol || '').toUpperCase();
    if (!sym) continue;
    const ageDays = Math.max(0, (Date.now() - new Date(r.published_at).getTime()) / 864e5);
    const w = ageWeight(ageDays, days);
    const s = r.sentiment === 'positive' ? 'positive' : r.sentiment === 'negative' ? 'negative' : 'neutral';
    if (!agg[sym]) agg[sym] = { positive: 0, negative: 0, neutral: 0 };
    agg[sym][s] += w;
  }
  const result = {};
  for (const [sym, c] of Object.entries(agg)) {
    result[sym] = (c.positive > c.negative && c.positive > c.neutral) ? 'positive'
      : (c.negative > c.positive && c.negative > c.neutral) ? 'negative' : 'neutral';
  }
  return result;
}

// Per-symbol strongest catalyst over the last `days` (recency-weighted).
// Returns { [SYMBOL]: { direction, type, strength, headline, source, publishedAt } }.
async function getCatalystHistorical(days = HISTORY_WINDOW_DAYS) {
  const { rows } = await pool.query(
    `SELECT symbol, hot_type, catalyst_direction, catalyst_strength, headline, source, published_at
     FROM news_sentiment_history
     WHERE catalyst_direction IN ('positive', 'negative')
       AND published_at >= now() - ($1::int * interval '1 day')`,
    [days]
  );
  const agg = {};
  for (const r of rows) {
    const sym = String(r.symbol || '').toUpperCase();
    if (!sym || !r.hot_type) continue;
    const ageDays = Math.max(0, (Date.now() - new Date(r.published_at).getTime()) / 864e5);
    const strength = Number(r.catalyst_strength) || 1;
    const weight = strength * ageWeight(ageDays, days);
    const prev = agg[sym];
    if (!prev || weight > prev._w) {
      agg[sym] = {
        direction: r.catalyst_direction,
        type: r.hot_type,
        strength,
        headline: String(r.headline || '').slice(0, 200),
        source: r.source || '',
        publishedAt: r.published_at,
        _w: weight,
      };
    }
  }
  const result = {};
  for (const [sym, v] of Object.entries(agg)) {
    const { _w, ...clean } = v;
    result[sym] = clean;
  }
  return result;
}

// Merge live (today) sentiment over historical. Live wins for symbols present
// in both; historical fills gaps so quiet days keep a signal.
function mergeSentimentMaps(live, historical) {
  const out = { ...(historical || {}) };
  for (const [sym, val] of Object.entries(live || {})) out[sym] = val;
  return out;
}

async function prune(days = PRUNE_AFTER_DAYS) {
  const res = await pool.query(`DELETE FROM news_sentiment_history WHERE published_at < now() - ($1::int * interval '1 day')`, [days]);
  return res.rowCount || 0;
}

module.exports = { ensureTable, persist, getHistorical, getCatalystHistorical, mergeSentimentMaps, ageWeight, prune, HISTORY_WINDOW_DAYS };
