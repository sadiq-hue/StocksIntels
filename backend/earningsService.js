const axios = require('axios');
const signalService = require('./signalService');
const nseAfxScraper = require('./nseAfxScraper');
const kenyanStocksScraper = require('./kenyanStocksScraper');

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_KEY || 'd7ji2ihr01qhf13euuvgd7ji2ihr01qhf13euv00';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

let finnhubCalendarCache = [];
let finnhubCalendarTime = 0;
const FINNHUB_CAL_TTL = 1000 * 60 * 60 * 4;

const finnhubSurpriseCache = {};
const FINNHUB_SURPRISE_TTL = 1000 * 60 * 60 * 24;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let earningsCache = [];
let lastSyncTime = 0;
let syncInProgress = false;

const historicalCache = {};
let historicalFetchInProgress = false;
let historicalQueue = [];
let dbPersistCounter = 0;

const CACHE_TTL = 1000 * 60 * 60;
const ALPHA_RATE_LIMIT_MS = 12000;
const DB_PERSIST_EVERY = 10;

let pool = null;
try { pool = require('./db').pool; } catch {}

async function persistHistoricalCache() {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO app_cache (cache_key, cache_value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET cache_value = $2::jsonb, updated_at = NOW()`,
      ['earnings_historical_cache', JSON.stringify(historicalCache)]
    );
  } catch {}
}

async function loadHistoricalCache() {
  if (!pool) return;
  try {
    const result = await pool.query(
      `SELECT cache_value FROM app_cache WHERE cache_key = 'earnings_historical_cache'`
    );
    if (result.rows.length > 0 && result.rows[0].cache_value) {
      const saved = result.rows[0].cache_value;
      let loaded = 0;
      for (const [ticker, events] of Object.entries(saved)) {
        if (events && events.length > 0) {
          historicalCache[ticker] = events;
          loaded++;
        }
      }
      console.log(`[Earnings] Restored ${loaded} tickers with historical data from DB`);
    }
  } catch {}
}

// ── Finnhub Earnings Calendar ──

async function fetchFinnhubEarningsCalendar(fromDate, toDate) {
  if (finnhubCalendarCache.length > 0 && (Date.now() - finnhubCalendarTime) < FINNHUB_CAL_TTL) {
    return finnhubCalendarCache.filter(e => {
      const d = e.date;
      return d >= fromDate && d <= toDate;
    });
  }
  try {
    const url = `${FINNHUB_BASE}/calendar/earnings?from=${fromDate}&to=${toDate}&token=${FINNHUB_KEY}`;
    const res = await axios.get(url, { timeout: 15000 });
    const cal = res.data?.earningsCalendar || [];
    finnhubCalendarCache = cal.map(e => ({
      ticker: e.symbol,
      date: e.date,
      quarter: e.quarter,
      year: e.year,
      epsEstimate: e.epsEstimate,
      epsActual: e.epsActual,
      revenueEstimate: e.revenueEstimate,
      revenueActual: e.revenueActual,
      hour: e.hour,
    }));
    finnhubCalendarTime = Date.now();
    console.log(`[Earnings] Finnhub calendar loaded: ${finnhubCalendarCache.length} events`);
    return finnhubCalendarCache.filter(e => e.date >= fromDate && e.date <= toDate);
  } catch (e) {
    console.error('[Earnings] Finnhub calendar failed:', e.message);
    return [];
  }
}

async function fetchFinnhubEarningsSurprises(symbol) {
  if (finnhubSurpriseCache[symbol] && (Date.now() - finnhubSurpriseCache[symbol]._ts) < FINNHUB_SURPRISE_TTL) {
    return finnhubSurpriseCache[symbol].data;
  }
  try {
    const url = `${FINNHUB_BASE}/stock/earnings?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const res = await axios.get(url, { timeout: 10000 });
    const data = Array.isArray(res.data) ? res.data : [];
    finnhubSurpriseCache[symbol] = { data, _ts: Date.now() };
    return data;
  } catch {
    return [];
  }
}

async function fetchFinnhubEarningsBatch(symbols) {
  const results = {};
  const toFetch = symbols.slice(0, 20);
  for (const sym of toFetch) {
    results[sym] = await fetchFinnhubEarningsSurprises(sym);
    if (toFetch.indexOf(sym) < toFetch.length - 1) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }
  return results;
}

function getQuarter(date) {
  const m = date.getMonth();
  if (m <= 2) return 'Q1';
  if (m <= 5) return 'Q2';
  if (m <= 8) return 'Q3';
  return 'Q4';
}

function buildHistoricalEvents(ticker, data) {
  const fund = signalService.getFundamentals(ticker);
  const name = fund?.name || ticker;
  const sector = fund?.sector || 'Other';
  const events = [];
  const quarterly = data?.quarterlyEarnings || [];
  for (const q of quarterly) {
    const reportDate = new Date(q.reportedDate);
    if (isNaN(reportDate.getTime())) continue;
    const est = parseFloat(q.estimatedEPS) || 0;
    const act = parseFloat(q.reportedEPS) || 0;
    const surprisePct = parseFloat(q.surprisePercentage) || 0;
    const fiscalQ = Math.floor(reportDate.getMonth() / 3);
    events.push({
      id: `${ticker}-${q.reportedDate}`,
      ticker, name, date: reportDate.toISOString(),
      dateStr: `${MONTHS[reportDate.getMonth()]} ${reportDate.getDate()}, ${reportDate.getFullYear()}`,
      quarter: `Q${fiscalQ + 1}`, fiscalYear: reportDate.getFullYear(),
      estEPS: Math.max(est, 0.01),
      actualEPS: Math.max(act, 0.01),
      surprise: +surprisePct.toFixed(2),
      isBeat: surprisePct >= 0,
      market: 'global', sector,
      currency: 'USD',
      marketCap: fund?.marketCap || 0,
      revenue: 0,
      source: 'alpha_vantage',
    });
  }
  return events;
}

function mergeHistoricalIntoCache(ticker) {
  const events = historicalCache[ticker];
  if (!events || events.length === 0) return;
  const existingIds = new Set(earningsCache.map(e => e.id));
  for (const ev of events) {
    if (!existingIds.has(ev.id)) {
      earningsCache.push(ev);
      existingIds.add(ev.id);
    }
  }
  earningsCache.sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function fetchHistoricalForSymbol(ticker) {
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!alphaKey || historicalCache[ticker]) return;
  try {
    const url = `https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(ticker)}&apikey=${alphaKey}`;
    const res = await axios.get(url, { timeout: 15000 });
    const data = res.data;
    if (data && data.quarterlyEarnings) {
      historicalCache[ticker] = buildHistoricalEvents(ticker, data);
      mergeHistoricalIntoCache(ticker);
      dbPersistCounter++;
      if (dbPersistCounter % DB_PERSIST_EVERY === 0) persistHistoricalCache();
      console.log(`[Earnings] History loaded: ${ticker} (${historicalCache[ticker].length} quarters)`);
    }
  } catch (e) {
    historicalCache[ticker] = [];
  }
}

async function drainHistoricalQueue() {
  if (historicalFetchInProgress || historicalQueue.length === 0) return;
  historicalFetchInProgress = true;
  while (historicalQueue.length > 0) {
    const ticker = historicalQueue.shift();
    await fetchHistoricalForSymbol(ticker);
    if (historicalQueue.length > 0) {
      await new Promise(r => setTimeout(r, ALPHA_RATE_LIMIT_MS));
    }
  }
  await persistHistoricalCache();
  historicalFetchInProgress = false;
}

function enqueueHistoricalFetch(tickers) {
  let newCount = 0;
  for (const t of tickers) {
    if (!(t in historicalCache) && !historicalQueue.includes(t)) {
      historicalQueue.push(t);
      newCount++;
    }
  }
  if (newCount > 0) {
    drainHistoricalQueue();
  }
}

async function syncEarnings() {
  if (syncInProgress) return;
  syncInProgress = true;

  try {
    nseAfxScraper.fetchNseQuotes().catch(() => {});
    const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
    const allEvents = [];
    const trackedSet = new Set(signalService.ALL_SYMBOLS);

    // 1. Alpha Vantage EARNINGS_CALENDAR — upcoming earnings in one call
    if (alphaKey) {
      try {
        const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=12month&apikey=${alphaKey}`;
        const res = await axios.get(url, { timeout: 20000 });
        const csv = res.data;
        if (typeof csv === 'string') {
          const lines = csv.trim().split('\n');
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            const ticker = cols[0] || '';
            if (!ticker) continue;
            const fund = signalService.getFundamentals(ticker);
            const name = cols[1] || fund?.name || ticker;
            const sector = fund?.sector || 'Other';
            const reportDate = new Date(cols[2]);
            if (isNaN(reportDate.getTime())) continue;
            const qEnd = cols[3] ? new Date(cols[3]) : reportDate;
            const quarter = getQuarter(qEnd);
            const fiscalYear = qEnd.getFullYear();
            const estEps = parseFloat(cols[4]) || 0;

            allEvents.push({
              id: `${ticker}-${reportDate.toISOString().slice(0, 10)}`,
              ticker, name, date: reportDate.toISOString(),
              dateStr: `${MONTHS[reportDate.getMonth()]} ${reportDate.getDate()}, ${reportDate.getFullYear()}`,
              quarter, fiscalYear,
              estEPS: Math.max(estEps, 0.01),
              actualEPS: 0,
              surprise: 0, isBeat: true,
              market: 'global', sector,
              currency: cols[5] || 'USD',
              marketCap: fund?.marketCap || 0,
              revenue: 0,
              source: 'alpha_vantage',
            });
          }
          console.log(`[Earnings] Alpha Vantage returned ${allEvents.length} upcoming earnings events`);
        }
      } catch (e) {
        console.error('[Earnings] Alpha Vantage calendar failed:', e.message);
      }
    }

    // 1b. Finnhub earnings calendar — fallback for upcoming global events
    try {
      const fromStr = new Date().toISOString().slice(0, 10);
      const toDate = new Date();
      toDate.setMonth(toDate.getMonth() + 6);
      const toStr = toDate.toISOString().slice(0, 10);
      const finnhubEvents = await fetchFinnhubEarningsCalendar(fromStr, toStr);
      const existingIds = new Set(allEvents.map(e => e.id));
      for (const fe of finnhubEvents) {
        const id = `finnhub-${fe.ticker}-${fe.date}`;
        if (existingIds.has(id)) continue;
        const fund = signalService.getFundamentals(fe.ticker);
        const reportDate = new Date(fe.date);
        if (isNaN(reportDate.getTime())) continue;
        const fiscalQ = Math.floor(reportDate.getMonth() / 3);
        allEvents.push({
          id,
          ticker: fe.ticker,
          name: fund?.name || fe.ticker,
          date: reportDate.toISOString(),
          dateStr: `${MONTHS[reportDate.getMonth()]} ${reportDate.getDate()}, ${reportDate.getFullYear()}`,
          quarter: `Q${fiscalQ + 1}`,
          fiscalYear: reportDate.getFullYear(),
          estEPS: fe.epsEstimate || 0.01,
          actualEPS: fe.epsActual || 0,
          surprise: (fe.epsActual && fe.epsEstimate) ? +(((fe.epsActual - fe.epsEstimate) / Math.abs(fe.epsEstimate || 1)) * 100).toFixed(2) : 0,
          isBeat: (fe.epsActual || 0) >= (fe.epsEstimate || 0),
          market: 'global',
          sector: fund?.sector || 'Other',
          currency: 'USD',
          marketCap: fund?.marketCap || 0,
          revenue: fe.revenueEstimate || 0,
          source: 'finnhub',
        });
        existingIds.add(id);
      }
      console.log(`[Earnings] Finnhub added ${finnhubEvents.length} upcoming global events`);
    } catch (e) {
      console.error('[Earnings] Finnhub calendar failed:', e.message);
    }

    // 2. Historical earnings from per-ticker EARNINGS endpoint (cached once)
    const historicalTickers = [...trackedSet].filter(t => !signalService.NSE_SYMBOLS.includes(t));
    enqueueHistoricalFetch(historicalTickers);

    for (const [ticker, events] of Object.entries(historicalCache)) {
      allEvents.push(...events);
    }

    // 3. NSE events from KenyanStocks.com (real data)
    try {
      const [ksEvents, ksStocks] = await Promise.all([
        kenyanStocksScraper.scrapeEvents(),
        kenyanStocksScraper.getStocksData(),
      ]);
      const stocksMap = {};
      if (ksStocks) ksStocks.forEach(s => { stocksMap[s.symbol] = s; });
      const existingIds = new Set(allEvents.map(e => e.id));
      for (const ev of ksEvents) {
        const isNse = signalService.NSE_SYMBOLS.includes(ev.symbol);
        if (!isNse) continue;
        const fund = signalService.getFundamentals(ev.symbol);
        const ksStock = stocksMap[ev.symbol];
        const price = ksStock?.close || 0;
        const shares = ksStock?.shares_issued || 0;
        const liveMcap = price > 0 && shares > 0 ? Math.round(price * shares) : 0;
        const id = `ks-${ev.symbol}-${ev.date}`;
        if (existingIds.has(id)) continue;
        const reportDate = new Date(ev.date);
        if (isNaN(reportDate.getTime())) continue;
        const fiscalQ = Math.floor(reportDate.getMonth() / 3);
        allEvents.push({
          id,
          ticker: ev.symbol,
          name: ev.companyName || fund?.name || ev.symbol,
          date: reportDate.toISOString(),
          dateStr: `${MONTHS[reportDate.getMonth()]} ${reportDate.getDate()}, ${reportDate.getFullYear()}`,
          quarter: `Q${fiscalQ + 1}`,
          fiscalYear: reportDate.getFullYear(),
          estEPS: 0,
          actualEPS: 0,
          surprise: 0,
          isBeat: true,
          market: 'nse',
          sector: ksStock?.sector?.name || fund?.sector || 'Other',
          currency: 'KES',
          marketCap: liveMcap || fund?.marketCap || 0,
          revenue: 0,
          eventType: ev.eventType,
          eventMessage: ev.message,
          source: 'kenyanstocks',
        });
        existingIds.add(id);
      }
    } catch (e) {
      console.error('[Earnings] KenyanStocks scrape failed:', e.message);
    }

    allEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
    earningsCache = allEvents;
    lastSyncTime = Date.now();
    console.log(`[Earnings] Cache updated: ${allEvents.length} total events (${Object.keys(historicalCache).length} tickers with history)`);
  } catch (e) {
    console.error('[Earnings] Sync failed:', e.message);
  } finally {
    syncInProgress = false;
  }
}

function filterEarnings(events, options) {
  let filtered = [...events];
  if (options.market) filtered = filtered.filter(e => e.market === options.market);
  if (options.sector) filtered = filtered.filter(e => e.sector === options.sector);
  if (options.eventType) filtered = filtered.filter(e => e.eventType === options.eventType);
  if (options.search) {
    const q = options.search.toLowerCase();
    filtered = filtered.filter(e =>
      e.ticker.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }
  if (options.fromDate) {
    const fd = new Date(options.fromDate);
    fd.setHours(0, 0, 0, 0);
    filtered = filtered.filter(e => new Date(e.date) >= fd);
  }
  if (options.toDate) {
    const td = new Date(options.toDate);
    td.setHours(23, 59, 59, 999);
    filtered = filtered.filter(e => new Date(e.date) <= td);
  }
  filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  return filtered;
}

async function getUpcomingEarnings(options = {}) {
  const { limit = 100, offset = 0 } = options;

  if (earningsCache.length > 0 && (Date.now() - lastSyncTime) < CACHE_TTL) {
    const filtered = filterEarnings(earningsCache, options);
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    const sectors = [...new Set(earningsCache.map(e => e.sector).filter(Boolean))].sort();
    const dateRange = {
      from: paged.length > 0 ? paged[0].date : null,
      to: paged.length > 0 ? paged[paged.length - 1].date : null,
    };
    return { earnings: paged, total, offset, limit, sectors, dateRange };
  }

  syncEarnings();

  if (earningsCache.length > 0) {
    const filtered = filterEarnings(earningsCache, options);
    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    const sectors = [...new Set(earningsCache.map(e => e.sector).filter(Boolean))].sort();
    const dateRange = {
      from: paged.length > 0 ? paged[0].date : null,
      to: paged.length > 0 ? paged[paged.length - 1].date : null,
    };
    return { earnings: paged, total, offset, limit, sectors, dateRange };
  }

  return { earnings: [], total: 0, offset, limit, sectors: [], dateRange: { from: null, to: null } };
}

async function getEarningsCriteria() {
  if (earningsCache.length > 0) {
    const markets = [...new Set(earningsCache.map(e => e.market))].sort();
    const sectors = [...new Set(earningsCache.map(e => e.sector).filter(Boolean))].sort();
    return { sectors, markets: markets.length > 0 ? markets : ['nse', 'global'] };
  }
  const sectors = [...new Set(signalService.ALL_SYMBOLS.map(s =>
    signalService.getFundamentals(s)?.sector
  ).filter(Boolean))].sort();
  return { sectors: sectors.length > 0 ? sectors : ['Technology', 'Financial', 'Healthcare'], markets: ['nse', 'global'] };
}

loadHistoricalCache();
setTimeout(syncEarnings, 2000);

module.exports = { getUpcomingEarnings, getEarningsCriteria, fetchFinnhubEarningsCalendar, fetchFinnhubEarningsSurprises, fetchFinnhubEarningsBatch };