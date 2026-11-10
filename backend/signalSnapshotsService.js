// Durable read model for the market intelligence page.
//
// The generation engine writes its latest assessment here for every symbol it
// scores (including Hold), while the API reads paginated rows from Postgres.
// This keeps the UI independent of a full signal cycle and gives coverage /
// staleness visibility for every analyzed name.

const { pool } = require('./db');

let schemaPromise = null;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS signal_snapshots (
          ticker TEXT PRIMARY KEY,
          name TEXT,
          market TEXT,
          sector TEXT,
          tier TEXT,
          signal TEXT,
          action TEXT,
          confidence INTEGER,
          score INTEGER,
          price DOUBLE PRECISION,
          entry DOUBLE PRECISION,
          stop_loss DOUBLE PRECISION,
          target1 DOUBLE PRECISION,
          target2 DOUBLE PRECISION,
          target3 DOUBLE PRECISION,
          horizon TEXT,
          timeframe TEXT,
          catalyst JSONB,
          news_summary JSONB,
          data_source TEXT,
          analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB,
          next_refresh_at TIMESTAMPTZ
        )
      `);
      await pool.query('ALTER TABLE signal_snapshots ADD COLUMN IF NOT EXISTS next_refresh_at TIMESTAMPTZ');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_snapshots_action_score ON signal_snapshots (action, score DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_snapshots_market_score ON signal_snapshots (market, score DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_snapshots_analyzed ON signal_snapshots (analyzed_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_snapshots_next_refresh ON signal_snapshots (next_refresh_at)');
    })().catch(e => {
      schemaPromise = null;
      console.warn('[SignalSnapshots] schema unavailable:', e.message);
      throw e;
    });
  }
  return schemaPromise;
}

function cleanNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Tiered refresh policy. Actionable/catalyst names are refreshed more often;
// catalog names are allowed to age so the engine never tries to rescan 10k
// symbols every cycle.
function refreshMinutes(row) {
  if (row.catalyst) return 15;
  if (row.tier === 'catalyst') return 15;
  if (row.tier === 'mover' || row.tier === 'on-demand') return 30;
  if (row.tier === 'screen') return 360;
  if (row.tier === 'africa') return 360;
  if (row.tier === 'catalog') return 1440;
  if (row.tier === 'core') {
    return row.action === 'buy' || row.action === 'sell' ? 30 : 60;
  }
  return 60;
}

function toRow(s) {
  const row = {
    ticker: String(s.ticker || '').toUpperCase(),
    name: s.name || null,
    market: s.market || null,
    sector: s.sector || null,
    tier: s.tier || 'core',
    signal: s.signal || 'Hold',
    action: s.action || 'hold',
    confidence: cleanNumber(s.confidence),
    score: cleanNumber(s.score ?? s.analysis?.overall?.score),
    price: cleanNumber(s.price),
    entry: cleanNumber(s.entry ?? s.entryPrice),
    stop_loss: cleanNumber(s.stopLoss),
    target1: cleanNumber(s.target1),
    target2: cleanNumber(s.target2),
    target3: cleanNumber(s.target3),
    horizon: s.horizon || null,
    timeframe: s.timeframe || null,
    catalyst: s.catalyst || null,
    news_summary: s.newsSummary || null,
    data_source: s.dataSource || null,
    payload: s,
  };
  row.next_refresh_at = new Date(Date.now() + refreshMinutes(row) * 60 * 1000).toISOString();
  return row;
}

async function upsertMany(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) return 0;
  try {
    await ensureSchema();
  } catch { return 0; }
  const seen = new Map();
  for (const s of signals) {
    if (!s?.ticker) continue;
    const row = toRow(s);
    if (row.ticker) seen.set(row.ticker, row);
  }
  const rows = [...seen.values()];
  let written = 0;
  const chunkSize = 150;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    for (const r of chunk) {
      const p = params.length + 1;
      values.push(`($${p},$${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11},$${p + 12},$${p + 13},$${p + 14},$${p + 15},$${p + 16},$${p + 17},$${p + 18},$${p + 19},NOW(),$${p + 20},$${p + 21})`);
      params.push(
        r.ticker, r.name, r.market, r.sector, r.tier, r.signal, r.action,
        r.confidence != null ? Math.round(r.confidence) : null,
        r.score != null ? Math.round(r.score) : null,
        r.price, r.entry, r.stop_loss, r.target1, r.target2, r.target3,
        r.horizon, r.timeframe, r.catalyst, r.news_summary, r.data_source,
        JSON.stringify(r.payload || {}), r.next_refresh_at
      );
    }
    await pool.query(`
      INSERT INTO signal_snapshots (
        ticker,name,market,sector,tier,signal,action,confidence,score,price,
        entry,stop_loss,target1,target2,target3,horizon,timeframe,catalyst,
        news_summary,data_source,analyzed_at,payload,next_refresh_at
      ) VALUES ${values.join(',')}
      ON CONFLICT (ticker) DO UPDATE SET
        name=COALESCE(EXCLUDED.name,signal_snapshots.name),
        market=COALESCE(EXCLUDED.market,signal_snapshots.market),
        sector=COALESCE(EXCLUDED.sector,signal_snapshots.sector),
        tier=EXCLUDED.tier,
        signal=EXCLUDED.signal,
        action=EXCLUDED.action,
        confidence=EXCLUDED.confidence,
        score=EXCLUDED.score,
        price=EXCLUDED.price,
        entry=EXCLUDED.entry,
        stop_loss=EXCLUDED.stop_loss,
        target1=EXCLUDED.target1,
        target2=EXCLUDED.target2,
        target3=EXCLUDED.target3,
        horizon=EXCLUDED.horizon,
        timeframe=EXCLUDED.timeframe,
        catalyst=EXCLUDED.catalyst,
        news_summary=EXCLUDED.news_summary,
        data_source=EXCLUDED.data_source,
        analyzed_at=NOW(),
        payload=EXCLUDED.payload,
        next_refresh_at=EXCLUDED.next_refresh_at
    `, params);
    written += chunk.length;
  }
  return written;
}

async function getSnapshot(ticker) {
  await ensureSchema();
  const res = await pool.query('SELECT * FROM signal_snapshots WHERE ticker=$1', [String(ticker || '').toUpperCase()]);
  return res.rows[0] || null;
}

// Return the subset of candidates whose tiered refresh window has elapsed.
// New symbols (not in the snapshot table) are always due.
async function getDueSymbols(symbols = []) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];
  await ensureSchema();
  const unique = [...new Set(symbols.map(s => String(s || '').toUpperCase()).filter(Boolean))];
  if (!unique.length) return [];
  const res = await pool.query(
    'SELECT ticker, next_refresh_at FROM signal_snapshots WHERE ticker = ANY($1)',
    [unique]
  );
  const byTicker = new Map(res.rows.map(r => [r.ticker, r.next_refresh_at]));
  const now = Date.now();
  return unique.filter(s => {
    if (!byTicker.has(s)) return true;
    const next = byTicker.get(s);
    return !next || new Date(next).getTime() <= now;
  });
}

async function getRefreshStats() {
  await ensureSchema();
  const [due, tiers] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM signal_snapshots WHERE next_refresh_at IS NULL OR next_refresh_at <= NOW()"),
    pool.query("SELECT COALESCE(tier,'core') AS tier, COUNT(*)::int AS count FROM signal_snapshots WHERE next_refresh_at IS NULL OR next_refresh_at <= NOW() GROUP BY tier"),
  ]);
  return {
    dueNow: due.rows[0]?.count || 0,
    dueByTier: Object.fromEntries(tiers.rows.map(r => [r.tier, r.count])),
  };
}

async function listSnapshots({ page = 1, limit = 50, market, action, minScore, sort = 'score' } = {}) {
  await ensureSchema();
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const where = [];
  const params = [];
  if (market && market !== 'all') {
    params.push(String(market).toUpperCase());
    where.push(`market = $${params.length}`);
  }
  if (action && action !== 'all') {
    params.push(String(action).toLowerCase());
    where.push(`action = $${params.length}`);
  }
  if (minScore != null && Number.isFinite(Number(minScore))) {
    params.push(Number(minScore));
    where.push(`score >= $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = sort === 'confidence' ? 'confidence DESC NULLS LAST'
    : sort === 'recent' ? 'analyzed_at DESC'
      : 'score DESC NULLS LAST';
  const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM signal_snapshots ${whereSql}`, params);
  const dataParams = [...params, lim, (pageNum - 1) * lim];
  const rows = await pool.query(
    `SELECT ticker,name,market,sector,tier,signal,action,confidence,score,price,
            entry,stop_loss,target1,target2,target3,horizon,timeframe,
            catalyst,news_summary,data_source,analyzed_at,next_refresh_at
     FROM signal_snapshots ${whereSql}
     ORDER BY ${order}
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );
  return {
    rows: rows.rows,
    total: countRes.rows[0]?.total || 0,
    page: pageNum,
    limit: lim,
  };
}

async function getCoverage() {
  await ensureSchema();
  const [totals, actions, markets, tiers] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE analyzed_at > NOW() - INTERVAL \'1 hour\')::int AS fresh FROM signal_snapshots'),
    pool.query('SELECT action, COUNT(*)::int AS count FROM signal_snapshots GROUP BY action'),
    pool.query('SELECT market, COUNT(*)::int AS count FROM signal_snapshots GROUP BY market'),
    pool.query('SELECT tier, COUNT(*)::int AS count FROM signal_snapshots GROUP BY tier'),
  ]);
  const refresh = await getRefreshStats();
  return {
    total: totals.rows[0]?.total || 0,
    freshLastHour: totals.rows[0]?.fresh || 0,
    ...refresh,
    byAction: Object.fromEntries(actions.rows.map(r => [r.action, r.count])),
    byMarket: Object.fromEntries(markets.rows.map(r => [r.market, r.count])),
    byTier: Object.fromEntries(tiers.rows.map(r => [r.tier, r.count])),
  };
}

module.exports = { upsertMany, getSnapshot, getDueSymbols, getRefreshStats, listSnapshots, getCoverage, ensureSchema };
