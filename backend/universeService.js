// Dynamic stock universe.
//
// The hard-coded ALL_SYMBOLS list remains the always-scanned core. This service
// adds three outside pools without turning every cycle into a 10k-symbol scan:
//   - news catalysts (highest priority, short-term movers)
//   - StockAnalysis gainers/losers (micro/small-cap movers)
//   - SEC company_tickers.json catalog (rotated, so every listed US filer is
//     eventually covered; on-demand lookups jump the queue)
//
// Only a bounded slice is admitted to each signal cycle. Dynamic symbols must
// have live fundamentals before they can emit a signal (enforced in
// signalService), so a wider universe never manufactures ratings from fallback
// templates.

const axios = require('axios');
const { pool } = require('./db');
const { ALL_SYMBOLS } = require('./stockData');

const CORE = new Set(ALL_SYMBOLS.map(s => String(s).toUpperCase()));
const dynamic = new Map();
const TIER_RANK = { catalyst: 0, 'on-demand': 1, mover: 2, africa: 3, catalog: 4 };
const MAX_DYNAMIC = 15000;
const SEC_HEADERS = {
  'User-Agent': 'StocksIntels research contact@stocksintels.com',
  Accept: 'application/json',
};

let readyPromise = null;
let cycleCursor = 0;
let africaCursor = 0;
let lastMoverRefresh = 0;
let catalogRefreshedAt = 0;
let africaRefreshedAt = 0;

function normalizeSymbol(value) {
  let s = String(value || '').trim().toUpperCase();
  if (/^(NGX|JSE):/.test(s)) {
    const [exchange, ticker] = s.split(':');
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker || '')) return null;
    return `${exchange}:${ticker}`;
  }
  if (s.startsWith('US:')) s = s.slice(3);
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) return null;
  return s;
}

function isCore(symbol) {
  return CORE.has(normalizeSymbol(symbol));
}

function tierOf(meta) {
  return TIER_RANK[meta?.tier] != null ? TIER_RANK[meta.tier] : 99;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS universe_symbols (
      symbol TEXT PRIMARY KEY,
      market TEXT NOT NULL DEFAULT 'US',
      name TEXT,
      sector TEXT,
      source TEXT,
      tier TEXT NOT NULL DEFAULT 'catalog',
      cik TEXT,
      catalyst_type TEXT,
      catalyst_direction TEXT,
      catalyst_strength INTEGER,
      change_pct DOUBLE PRECISION,
      volume BIGINT,
      market_cap DOUBLE PRECISION,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_universe_symbols_tier_seen ON universe_symbols (tier, last_seen DESC)');
}

async function reload() {
  const { rows } = await pool.query(`
    SELECT symbol, market, name, sector, source, tier, cik,
           catalyst_type, catalyst_direction, catalyst_strength,
           change_pct, volume, market_cap, added_at, last_seen
    FROM universe_symbols
  `);
  dynamic.clear();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol || CORE.has(symbol)) continue;
    dynamic.set(symbol, {
      symbol,
      market: row.market || 'US',
      name: row.name || null,
      sector: row.sector || null,
      source: row.source || null,
      tier: row.tier || 'catalog',
      cik: row.cik || null,
      catalystType: row.catalyst_type || null,
      catalystDirection: row.catalyst_direction || null,
      catalystStrength: row.catalyst_strength || null,
      changePct: row.change_pct != null ? Number(row.change_pct) : null,
      volume: row.volume != null ? Number(row.volume) : null,
      marketCap: row.market_cap != null ? Number(row.market_cap) : null,
      addedAt: row.added_at ? new Date(row.added_at).toISOString() : null,
      lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
    });
  }
}

async function persist(entries) {
  if (!entries.length) return;
  const chunkSize = 400;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    for (const m of chunk) {
      const start = params.length + 1;
      values.push(`($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7}, $${start + 8}, $${start + 9}, $${start + 10}, $${start + 11}, $${start + 12})`);
      params.push(
        m.symbol, m.market || 'US', m.name || null, m.sector || null, m.source || null,
        m.tier || 'catalog', m.cik || null, m.catalystType || null, m.catalystDirection || null,
        m.catalystStrength != null ? Number(m.catalystStrength) : null,
        m.changePct != null ? Number(m.changePct) : null,
        m.volume != null ? Number(m.volume) : null,
        m.marketCap != null ? Number(m.marketCap) : null
      );
    }
    await pool.query(`
      INSERT INTO universe_symbols (
        symbol, market, name, sector, source, tier, cik,
        catalyst_type, catalyst_direction, catalyst_strength,
        change_pct, volume, market_cap
      ) VALUES ${values.join(',')}
      ON CONFLICT (symbol) DO UPDATE SET
        market = EXCLUDED.market,
        name = COALESCE(EXCLUDED.name, universe_symbols.name),
        sector = COALESCE(EXCLUDED.sector, universe_symbols.sector),
        source = COALESCE(EXCLUDED.source, universe_symbols.source),
        tier = CASE
          WHEN universe_symbols.tier = 'catalyst' THEN 'catalyst'
          WHEN EXCLUDED.tier = 'catalyst' THEN 'catalyst'
          WHEN universe_symbols.tier = 'on-demand' THEN 'on-demand'
          WHEN EXCLUDED.tier = 'on-demand' THEN 'on-demand'
          WHEN universe_symbols.tier = 'mover' THEN 'mover'
          WHEN EXCLUDED.tier = 'mover' THEN 'mover'
          WHEN universe_symbols.tier = 'africa' THEN 'africa'
          WHEN EXCLUDED.tier = 'africa' THEN 'africa'
          ELSE 'catalog'
        END,
        cik = COALESCE(EXCLUDED.cik, universe_symbols.cik),
        catalyst_type = COALESCE(EXCLUDED.catalyst_type, universe_symbols.catalyst_type),
        catalyst_direction = COALESCE(EXCLUDED.catalyst_direction, universe_symbols.catalyst_direction),
        catalyst_strength = COALESCE(EXCLUDED.catalyst_strength, universe_symbols.catalyst_strength),
        change_pct = COALESCE(EXCLUDED.change_pct, universe_symbols.change_pct),
        volume = COALESCE(EXCLUDED.volume, universe_symbols.volume),
        market_cap = COALESCE(EXCLUDED.market_cap, universe_symbols.market_cap),
        last_seen = NOW()
    `, params);
  }
}

async function init() {
  try {
    await ensureSchema();
    await reload();
  } catch (e) {
    console.warn(`[Universe] persistence unavailable: ${e.message}`);
  }
  // Catalog refresh is background: the core universe and any persisted dynamic
  // names remain usable while the ~10k SEC list is upserted.
  refreshCatalog().catch(() => {});
  refreshAfricanCatalog().catch(() => {});
}

function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function addSymbols(input, opts = {}) {
  await ready();
  const list = Array.isArray(input) ? input : [input];
  const now = new Date().toISOString();
  const normalized = [];
  for (const raw of list) {
    const item = typeof raw === 'string' ? { symbol: raw } : (raw || {});
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol || CORE.has(symbol)) continue;
    const prev = dynamic.get(symbol);
    const requestedTier = item.tier || opts.tier || 'catalog';
    const prevTier = prev?.tier || 'catalog';
    const tier = (TIER_RANK[requestedTier] ?? 99) < (TIER_RANK[prevTier] ?? 99)
      ? requestedTier
      : prevTier;
    if (!prev && tier === 'catalog' && dynamic.size >= MAX_DYNAMIC) continue;
    const meta = {
      symbol,
      market: item.market || prev?.market
        || (symbol.startsWith('NGX:') ? 'NGX' : symbol.startsWith('JSE:') ? 'JSE' : 'US'),
      name: item.name || prev?.name || null,
      sector: item.sector || prev?.sector || null,
      source: item.source || prev?.source || null,
      tier,
      cik: item.cik || prev?.cik || null,
      catalystType: item.catalystType || prev?.catalystType || null,
      catalystDirection: item.catalystDirection || prev?.catalystDirection || null,
      catalystStrength: item.catalystStrength != null ? item.catalystStrength : (prev?.catalystStrength ?? null),
      changePct: item.changePct != null ? item.changePct : (prev?.changePct ?? null),
      volume: item.volume != null ? item.volume : (prev?.volume ?? null),
      marketCap: item.marketCap != null ? item.marketCap : (prev?.marketCap ?? null),
      addedAt: prev?.addedAt || now,
      lastSeen: item.lastSeen || now,
    };
    dynamic.set(symbol, meta);
    normalized.push(meta);
  }
  persist(normalized).catch(() => {});
  return normalized.map(m => m.symbol);
}

async function observeCatalysts(catalysts = {}) {
  const entries = Object.entries(catalysts || {}).map(([symbol, c]) => ({
    symbol,
    source: 'news-catalyst',
    tier: 'catalyst',
    catalystType: c?.type || null,
    catalystDirection: c?.direction || null,
    catalystStrength: c?.strength || null,
  }));
  return addSymbols(entries, { tier: 'catalyst' });
}

async function fetchYahooMovers() {
  const screener = async (id) => {
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${id}&count=25`,
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    return res.data?.finance?.result?.[0]?.quotes || [];
  };
  const [gainers, losers] = await Promise.all([screener('day_gainers'), screener('day_losers')]);
  return [...gainers, ...losers].map(q => ({
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    source: 'yahoo-movers',
    tier: 'mover',
    changePct: q.regularMarketChangePercent,
    volume: q.regularMarketVolume,
    marketCap: q.marketCap,
  })).filter(m => m.symbol);
}

async function refreshMovers() {
  if (Date.now() - lastMoverRefresh < 5 * 60 * 1000) return [];
  lastMoverRefresh = Date.now();
  try {
    const movers = require('./stockAnalysisMovers');
    const [gainers, losers] = await Promise.all([movers.getGainers(25), movers.getLosers(25)]);
    const entries = [...gainers, ...losers].map(m => ({
      symbol: m.ticker,
      name: m.name,
      source: 'stockanalysis-movers',
      tier: 'mover',
      changePct: m.changePercent,
      volume: m.volume,
      marketCap: m.marketCap,
    }));
    if (entries.length) return addSymbols(entries, { tier: 'mover' });
  } catch (e) {
    console.warn(`[Universe] stockanalysis movers failed: ${e.message}`);
  }
  try {
    return addSymbols(await fetchYahooMovers(), { tier: 'mover' });
  } catch (e) {
    console.warn(`[Universe] yahoo movers failed: ${e.message}`);
    return [];
  }
}

async function refreshCatalog() {
  if (Date.now() - catalogRefreshedAt < 24 * 60 * 60 * 1000) return;
  catalogRefreshedAt = Date.now();
  try {
    const res = await axios.get('https://www.sec.gov/files/company_tickers.json', {
      timeout: 30000,
      headers: SEC_HEADERS,
    });
    const rows = Object.values(res.data || {});
    const entries = rows
      .map(r => ({
        symbol: r.ticker,
        name: r.title,
        source: 'sec-catalog',
        cik: r.cik_str != null ? String(r.cik_str).padStart(10, '0') : null,
      }))
      .filter(r => r.symbol && r.name);
    await addSymbols(entries, { tier: 'catalog', source: 'sec-catalog' });
    console.log(`[Universe] SEC catalog refreshed: ${entries.length} rows`);
  } catch (e) {
    console.warn(`[Universe] catalog refresh failed: ${e.message}`);
  }
}

async function refreshAfricanCatalog() {
  if (Date.now() - africaRefreshedAt < 24 * 60 * 60 * 1000) return;
  africaRefreshedAt = Date.now();
  const msa = require('./mystocksAfricaApi');
  for (const exchange of ['NGX', 'JSE']) {
    try {
      const res = await msa.listAllStocks(exchange, { limit: 200, maxPages: 25 });
      const entries = (res.data || [])
        .map(r => {
          const ticker = String(r.ticker || r.symbol || '').toUpperCase().replace(/^[A-Z]+:/, '');
          if (!ticker) return null;
          return {
            symbol: `${exchange}:${ticker}`,
            market: exchange,
            name: r.name || null,
            sector: r.sector || null,
            source: 'mystocks-africa',
            tier: 'africa',
            changePct: r.changePct != null ? Number(r.changePct) : null,
            volume: r.volume != null ? Number(r.volume) : null,
          };
        })
        .filter(Boolean);
      await addSymbols(entries, { tier: 'africa', source: 'mystocks-africa' });
      console.log(`[Universe] ${exchange} catalog refreshed: ${entries.length} rows`);
    } catch (e) {
      console.warn(`[Universe] ${exchange} catalog refresh failed: ${e.message}`);
    }
  }
}

function sortPriority(a, b) {
  return (tierOf(a) - tierOf(b))
    || ((Number(b.catalystStrength) || 0) - (Number(a.catalystStrength) || 0))
    || (new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));
}

async function getCycleSymbols(limit = 60) {
  await ready();
  const rows = [...dynamic.values()];
  const out = [];
  const add = (symbol) => { if (out.length < limit && !out.includes(symbol)) out.push(symbol); };

  // Catalysts and on-demand names lead; fixed shares go to movers and the
  // rotating NGX/JSE catalog, with the rest advancing the US catalog.
  const catalystBudget = Math.ceil(limit * 0.30);
  const onDemandBudget = Math.ceil(limit * 0.15);
  const moverBudget = Math.ceil(limit * 0.15);
  const africaBudget = Math.ceil(limit * 0.15);

  rows.filter(r => r.tier === 'catalyst').sort(sortPriority)
    .slice(0, catalystBudget).forEach(r => add(r.symbol));
  rows.filter(r => r.tier === 'on-demand').sort(sortPriority)
    .slice(0, onDemandBudget).forEach(r => add(r.symbol));
  rows.filter(r => r.tier === 'mover').sort(sortPriority)
    .slice(0, moverBudget).forEach(r => add(r.symbol));

  const africa = rows.filter(r => r.tier === 'africa');
  if (africa.length && out.length < limit) {
    const start = africaCursor % africa.length;
    const rotated = [...africa.slice(start), ...africa.slice(0, start)];
    const take = Math.min(africaBudget, limit - out.length, rotated.length);
    rotated.slice(0, take).forEach(r => add(r.symbol));
    africaCursor = (africaCursor + Math.max(take, 1)) % africa.length;
  }

  const catalog = rows.filter(r => r.tier === 'catalog');
  if (catalog.length && out.length < limit) {
    const start = cycleCursor % catalog.length;
    const rotated = [...catalog.slice(start), ...catalog.slice(0, start)];
    const take = Math.min(limit - out.length, rotated.length);
    rotated.slice(0, take).forEach(r => add(r.symbol));
    cycleCursor = (cycleCursor + Math.max(take, 1)) % catalog.length;
  }
  return out;
}

function getMeta(symbol) {
  const s = normalizeSymbol(symbol);
  return s ? dynamic.get(s) || null : null;
}

function isDynamic(symbol) {
  return !!getMeta(symbol);
}

function getStats() {
  const byTier = {};
  for (const m of dynamic.values()) byTier[m.tier] = (byTier[m.tier] || 0) + 1;
  return {
    core: CORE.size,
    dynamic: dynamic.size,
    byTier,
    catalogRefreshedAt: catalogRefreshedAt ? new Date(catalogRefreshedAt).toISOString() : null,
    africaRefreshedAt: africaRefreshedAt ? new Date(africaRefreshedAt).toISOString() : null,
    lastMoverRefresh: lastMoverRefresh ? new Date(lastMoverRefresh).toISOString() : null,
    maxDynamic: MAX_DYNAMIC,
  };
}

function addOnDemand(symbol) {
  return addSymbols([{ symbol, source: 'on-demand', tier: 'on-demand' }], { tier: 'on-demand' });
}

ready().catch(() => {});

module.exports = {
  addSymbols,
  addOnDemand,
  observeCatalysts,
  refreshMovers,
  refreshCatalog,
  refreshAfricanCatalog,
  getCycleSymbols,
  getMeta,
  isDynamic,
  isCore,
  getStats,
};
