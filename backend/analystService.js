// Analyst Service - real Wall Street analyst tracking via FMP API
// No fake/fallback data — returns real FMP data only, persisted to DB for cache

const { fmp } = require('./apiClient');
const { pool } = require('./db');

const FMP_API_KEY = process.env.FMP_API_KEY || '';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in-memory cache
let fmpRateLimited = false;
let fmpRateLimitedAt = 0;
const RATE_LIMIT_COOLDOWN = 30 * 60 * 1000; // retry after 30 min

let _cache = null;
let _cacheTime = 0;
let _inProgress = false;

const ANALYST_FIRMS = [
  { id: 'goldman-sachs', name: 'Goldman Sachs', focus: 'Large Cap' },
  { id: 'morgan-stanley', name: 'Morgan Stanley', focus: 'Growth' },
  { id: 'jp-morgan', name: 'JP Morgan', focus: 'Value' },
  { id: 'bofa', name: 'Bank of America', focus: 'Dividend' },
  { id: 'citi', name: 'Citigroup', focus: 'Growth' },
  { id: 'ubs', name: 'UBS Group', focus: 'Defensive' },
  { id: 'deutsche-bank', name: 'Deutsche Bank', focus: 'Cyclical' },
  { id: 'barclays', name: 'Barclays', focus: 'Growth' },
  { id: 'wells-fargo', name: 'Wells Fargo', focus: 'Value' },
  { id: 'rbc-capital', name: 'RBC Capital Markets', focus: 'Innovation' },
  { id: 'piper-sandler', name: 'Piper Sandler', focus: 'Mid Cap' },
  { id: 'needham', name: 'Needham & Co', focus: 'Small Cap' },
  { id: 'canaccord', name: 'Canaccord Genuity', focus: 'Small Cap' },
  { id: 'stifel', name: 'Stifel Financial', focus: 'Mid Cap' },
  { id: 'jefferies', name: 'Jefferies', focus: 'Growth' },
  { id: 'oppenheimer', name: 'Oppenheimer', focus: 'Innovation' },
  { id: 'raymond-james', name: 'Raymond James', focus: 'Conservative' },
  { id: 'wedbush', name: 'Wedbush Securities', focus: 'Technology' },
  { id: 'keybanc', name: 'KeyBanc Capital Markets', focus: 'Technology' },
  { id: 'hsbc', name: 'HSBC', focus: 'Global Macro' },
];

const TOP_COVERED_STOCKS = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'META', 'TSLA', 'JPM', 'V',
  'UNH', 'LLY', 'WMT', 'XOM', 'PG', 'JNJ', 'HD', 'KO', 'PEP', 'MRK',
  'ABBV', 'BAC', 'PFE', 'AVGO', 'COST', 'AMD', 'INTC', 'CRM', 'NFLX',
  'DIS', 'MCD', 'NKE', 'SBUX', 'GS', 'MS', 'C', 'WFC', 'BA', 'CAT',
  'ORCL', 'CSCO', 'QCOM', 'AMGN', 'TXN', 'IBM', 'HON', 'LOW', 'UPS', 'SPCX', 'NOK', 'SMCI', 'RKLB', 'MRVL', 'ARM', 'MSTR', 'HPE', 'CCL', 'NU', 'TTD', 'ITUB', 'VALE', 'NIO', 'STLA',
];

async function ensureTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analyst_cache (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL,
        source TEXT NOT NULL DEFAULT 'fmp',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } catch (e) {
    console.error('[AnalystService] Failed to ensure analyst_cache table:', e.message);
  }
}

async function loadFromDb() {
  try {
    const { rows } = await pool.query(
      'SELECT data, created_at FROM analyst_cache ORDER BY id DESC LIMIT 1'
    );
    if (rows.length > 0) {
      return { ...rows[0].data, source: 'fmp_cached', cachedAt: rows[0].created_at.toISOString() };
    }
  } catch (e) {
    console.error('[AnalystService] DB read error:', e.message);
  }
  return null;
}

async function saveToDb(result) {
  try {
    await pool.query(
      'INSERT INTO analyst_cache (data, source) VALUES ($1, $2)',
      [JSON.stringify(result), result.source || 'fmp']
    );
  } catch (e) {
    console.error('[AnalystService] DB write error:', e.message);
  }
}

async function fetchFromFmp() {
  const allRecs = [];
  for (let i = 0; i < TOP_COVERED_STOCKS.length; i++) {
    const symbol = TOP_COVERED_STOCKS[i];
    try {
      const response = await fmp.get(`${FMP_BASE_URL}/analyst-stock-recommendations`, {
        params: { symbol, apikey: FMP_API_KEY },
      });
      if (Array.isArray(response.data)) {
        for (const r of response.data) {
          if (!r.analystFirm) continue;
          allRecs.push({
            symbol,
            firm: r.analystFirm,
            rating: r.rating || 'Neutral',
            targetPrice: r.targetPrice || 0,
            priceAtRecommendation: r.priceAtRecommendation || 0,
            publishedDate: r.publishedDate || r.date || null,
          });
        }
      }
    } catch (e) {
      if (e.response?.status === 429) {
        console.warn(`[AnalystService] FMP rate limited at symbol ${symbol}, ${i + 1}/${TOP_COVERED_STOCKS.length} done`);
        fmpRateLimited = true;
        fmpRateLimitedAt = Date.now();
        break;
      }
    }
    if (i < TOP_COVERED_STOCKS.length - 1 && !fmpRateLimited) {
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  return allRecs;
}

async function fetchAnalystData() {
  // Return in-memory cache if fresh
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
  if (_inProgress) return _cache || { firms: [], total: 0, totalRatings: 0, timestamp: new Date().toISOString(), source: 'pending' };
  _inProgress = true;

  try {
    let result = null;

    // Try FMP if API key exists and not rate-limited (or cooldown expired)
    const canTryFmp = FMP_API_KEY && (!fmpRateLimited || (Date.now() - fmpRateLimitedAt > RATE_LIMIT_COOLDOWN));
    if (canTryFmp) {
      const recs = await fetchFromFmp();
      if (recs.length > 0) {
        result = aggregateByFirm(recs);
        // Persist real data to DB
        await saveToDb(result);
      }
    }

    // If no fresh FMP data, try DB cache
    if (!result) {
      result = await loadFromDb();
    }

    // If still nothing — return empty, never fake data
    if (!result) {
      result = { firms: [], total: 0, totalRatings: 0, timestamp: new Date().toISOString(), source: 'none' };
    }

    _cache = result;
    _cacheTime = Date.now();
    return result;
  } catch (error) {
    console.error('[AnalystService] Error:', error.message);
    // Try DB cache on error
    const dbResult = await loadFromDb();
    if (dbResult) {
      _cache = dbResult;
      _cacheTime = Date.now();
      return dbResult;
    }
    return { firms: [], total: 0, totalRatings: 0, timestamp: new Date().toISOString(), source: 'none' };
  } finally {
    _inProgress = false;
  }
}

function aggregateByFirm(allRecs) {
  const byFirm = {};
  for (const rec of allRecs) {
    const firm = rec.firm;
    if (!byFirm[firm]) {
      byFirm[firm] = { firm, totalRatings: 0, stocks: {}, ratings: { 'Strong Buy': 0, 'Buy': 0, 'Neutral': 0, 'Sell': 0, 'Strong Sell': 0 }, totalTargets: 0, targetSum: 0 };
    }
    byFirm[firm].totalRatings++;
    if (rec.targetPrice > 0) {
      byFirm[firm].totalTargets++;
      byFirm[firm].targetSum += rec.targetPrice;
    }
    if (rec.rating in byFirm[firm].ratings) byFirm[firm].ratings[rec.rating]++;
    if (!byFirm[firm].stocks[rec.symbol]) byFirm[firm].stocks[rec.symbol] = [];
    byFirm[firm].stocks[rec.symbol].push(rec);
  }

  const { getFundamentals } = require('./signalService');
  const firms = ANALYST_FIRMS.map(firmMeta => {
    const f = byFirm[firmMeta.name];
    if (!f || f.totalRatings === 0) return null;

    let topRating = 'Neutral', topCount = 0;
    for (const [r, c] of Object.entries(f.ratings)) {
      if (c > topCount) { topCount = c; topRating = r; }
    }

    const sectorCounts = {};
    for (const sym of Object.keys(f.stocks)) {
      try {
        const fund = getFundamentals(sym);
        const sec = fund?.sector || 'Other';
        sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
      } catch { sectorCounts['Other'] = (sectorCounts['Other'] || 0) + 1; }
    }
    let topSector = 'Other', maxSec = 0;
    for (const [s, c] of Object.entries(sectorCounts)) {
      if (c > maxSec) { maxSec = c; topSector = s; }
    }

    const allPicks = Object.values(f.stocks).flat();
    allPicks.sort((a, b) => {
      if (!a.publishedDate || !b.publishedDate) return 0;
      return new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime();
    });
    const uniqueSymbols = [];
    const seen = new Set();
    for (const pick of allPicks) {
      if (!seen.has(pick.symbol)) { seen.add(pick.symbol); uniqueSymbols.push(pick); if (uniqueSymbols.length >= 3) break; }
    }

    const avgTarget = f.totalTargets > 0 ? f.targetSum / f.totalTargets : 0;

    return {
      id: firmMeta.id,
      name: firmMeta.name,
      rating: topRating,
      totalRatings: f.totalRatings,
      topSector,
      picks: uniqueSymbols.map(p => ({
        symbol: p.symbol,
        rating: p.rating,
        targetPrice: p.targetPrice,
        priceAtRecommendation: p.priceAtRecommendation,
        publishedDate: p.publishedDate,
      })),
      avgTargetPrice: avgTarget,
      ratings: f.ratings,
    };
  }).filter(Boolean);

  return {
    firms,
    total: firms.length,
    totalRatings: allRecs.length,
    timestamp: new Date().toISOString(),
    source: 'fmp',
  };
}

// Initialize table on load
ensureTable();

module.exports = { fetchAnalystData, ANALYST_FIRMS };
