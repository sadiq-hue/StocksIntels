// Broad catalog screener.
//
// The full SEC catalog (~9k US filers) is too large to run through the full
// signal pipeline every cycle. This service does the cheap part often: it pulls
// a batched Yahoo snapshot for every catalog name, ranks trend/momentum/liquidity
// inside market-cap buckets, and promotes only the strongest names into the
// `screen` tier. The signal engine then runs its full evidence/scenario/gate
// pipeline on that bounded candidate set.
//
// This is what lets small/mid/large caps get looked at without pretending a
// 10k-symbol deep scan is free.

const yahooService = require('./yahooService');
const universeService = require('./universeService');

const SCAN_INTERVAL_MS = Number(process.env.CATALOG_SCREEN_INTERVAL_MS) || 6 * 60 * 60 * 1000;
const CHUNK = 100;
const CHUNK_GAP_MS = Number(process.env.CATALOG_SCREEN_GAP_MS) || 250;
const PER_BUCKET = Math.max(5, Number(process.env.CATALOG_SCREEN_PER_BUCKET) || 50);
const MIN_PRICE = 1;
const MIN_MARKET_CAP = 50 * 1000 * 1000;
const MIN_AVG_VOLUME = 10000;
const MIN_DOLLAR_VOLUME = Number(process.env.CATALOG_SCREEN_MIN_DOLLAR_VOLUME) || 1000000;

const BUCKETS = [
  { key: 'large', min: 10 * 1000 * 1000 * 1000 },
  { key: 'mid', min: 2 * 1000 * 1000 * 1000 },
  { key: 'small', min: 300 * 1000 * 1000 },
  { key: 'micro', min: MIN_MARKET_CAP },
];

let inflight = null;
let timer = null;
let lastRun = null;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function bucketFor(marketCap) {
  for (const bucket of BUCKETS) {
    if (marketCap >= bucket.min) return bucket.key;
  }
  return null;
}

function screenScore(quote) {
  const quoteType = String(quote?.quoteType || '').toUpperCase();
  if (quoteType !== 'EQUITY') return null;
  // Keep the candidate pool to listed venues. Pink/OTC shells and foreign
  // ordinary lines have poor execution quality and are not useful long ideas.
  const exchange = String(quote?.exchange || '');
  if (/otc|pink|oqx|oid|grey|expert|pnk/i.test(exchange)) return null;
  const price = Number(quote?.regularMarketPrice);
  const sma50 = Number(quote?.fiftyDayAverage);
  const sma200 = Number(quote?.twoHundredDayAverage);
  const high52 = Number(quote?.fiftyTwoWeekHigh);
  const low52 = Number(quote?.fiftyTwoWeekLow);
  const change = Number(quote?.regularMarketChangePercent);
  const volume = Number(quote?.regularMarketVolume);
  const avgVolume = Number(quote?.averageDailyVolume3Month) || volume;
  const marketCap = Number(quote?.marketCap);

  if (!Number.isFinite(price) || price < MIN_PRICE) return null;
  if (!Number.isFinite(marketCap) || marketCap < MIN_MARKET_CAP) return null;
  if (!Number.isFinite(avgVolume) || avgVolume < MIN_AVG_VOLUME) return null;
  if (!Number.isFinite(price * avgVolume) || price * avgVolume < MIN_DOLLAR_VOLUME) return null;

  let score = 0;
  if (Number.isFinite(sma200) && sma200 > 0 && price > sma200) score += 25;
  if (Number.isFinite(sma50) && sma50 > 0 && price > sma50) score += 20;
  if (Number.isFinite(sma50) && Number.isFinite(sma200) && sma50 > sma200) score += 10;
  if (Number.isFinite(high52) && Number.isFinite(low52) && high52 > low52) {
    const position = clamp((price - low52) / (high52 - low52), 0, 1);
    score += position * 20;
  }
  if (Number.isFinite(change)) score += clamp(change, -10, 10);
  if (Number.isFinite(volume) && Number.isFinite(avgVolume) && avgVolume > 0) {
    score += clamp((volume / avgVolume) * 5, 0, 15);
  }
  return { score: Math.round(score * 100) / 100, bucket: bucketFor(marketCap) };
}

async function fetchQuotes(symbols) {
  const quotes = {};
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    try {
      const part = await yahooService.fetchV7Quotes(chunk);
      if (part) Object.assign(quotes, part);
    } catch { /* keep scanning remaining chunks */ }
    if (i + CHUNK < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, CHUNK_GAP_MS));
    }
  }
  return quotes;
}

async function screen() {
  if (inflight) return inflight;
  inflight = (async () => {
    const startedAt = Date.now();
    const universe = await universeService.getScreenUniverse();
    const symbols = [...new Set(universe.map(u => u.symbol).filter(Boolean))];
    if (!symbols.length) return { scanned: 0, selected: 0, reason: 'empty catalog' };

    const quotes = await fetchQuotes(symbols);
    const byBucket = new Map(BUCKETS.map(b => [b.key, []]));
    const ranked = [];

    for (const [symbol, quote] of Object.entries(quotes)) {
      const scored = screenScore(quote);
      if (!scored || !scored.bucket) continue;
      const row = {
        symbol,
        name: quote.company_name || null,
        marketCap: Number(quote.marketCap) || null,
        changePct: Number(quote.regularMarketChangePercent) || null,
        volume: Number(quote.regularMarketVolume) || null,
        score: scored.score,
        bucket: scored.bucket,
      };
      ranked.push(row);
      byBucket.get(scored.bucket).push(row);
    }

    const selected = [];
    const selectedSet = new Set();
    for (const bucket of BUCKETS) {
      const rows = byBucket.get(bucket.key).sort((a, b) => b.score - a.score);
      for (const row of rows.slice(0, PER_BUCKET)) {
        if (selectedSet.has(row.symbol)) continue;
        selected.push(row);
        selectedSet.add(row.symbol);
      }
    }
    // If a cap bucket is thin, fill the candidate budget from the overall best.
    const target = PER_BUCKET * BUCKETS.length;
    for (const row of ranked.sort((a, b) => b.score - a.score)) {
      if (selected.length >= target) break;
      if (selectedSet.has(row.symbol)) continue;
      selected.push(row);
      selectedSet.add(row.symbol);
    }

    const selectedSymbols = selected.map(r => r.symbol);
    if (selectedSymbols.length) {
      await universeService.addSymbols(selected.map(r => ({
        symbol: r.symbol,
        name: r.name,
        source: 'catalog-screen',
        tier: 'screen',
        changePct: r.changePct,
        volume: r.volume,
        marketCap: r.marketCap,
      })), { tier: 'screen' });
    }
    await universeService.replaceTier('screen', selectedSymbols);

    lastRun = {
      at: new Date().toISOString(),
      scanned: symbols.length,
      quoted: Object.keys(quotes).length,
      selected: selectedSymbols.length,
      byBucket: Object.fromEntries(BUCKETS.map(b => [
        b.key,
        selected.filter(r => r.bucket === b.key).length,
      ])),
      durationMs: Date.now() - startedAt,
    };
    console.log(`[CatalogScreen] scanned ${lastRun.scanned}, quoted ${lastRun.quoted}, selected ${lastRun.selected} (${JSON.stringify(lastRun.byBucket)}) in ${lastRun.durationMs}ms`);
    return lastRun;
  })().finally(() => { inflight = null; });
  return inflight;
}

function start() {
  if (timer) return;
  setTimeout(() => screen().catch(() => {}), 120000);
  timer = setInterval(() => screen().catch(() => {}), SCAN_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function getStatus() {
  return { lastRun, intervalMs: SCAN_INTERVAL_MS, perBucket: PER_BUCKET };
}

module.exports = { screen, start, getStatus };
