const axios = require('axios');
const { getNewsSummary } = require('./newsService');
const { getSectorPerformance } = require('./indicesService');
const { generateSignals, getMonitoredSignals, NSE_SYMBOLS } = require('./signalService');
const { resolveStockName } = require('./stockData');
const { fetchFinnhubEarningsCalendar, fetchFinnhubEarningsSurprises } = require('./earningsService');
const fxService = require('./fxService');
const llm = require('./llmService');
const { pool } = require('./db');

const PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${PORT}`;
const USE_LLM = process.env.USE_LLM === 'true';

async function fetchJson(url, fallback = null) {
  try { const r = await axios.get(url, { timeout: 8000 }); return r.data; }
  catch { return fallback; }
}

async function generateWeeklyDigestContent() {
  const [movers, summary, allIndices, sectors, news, signals, fxRate] = await Promise.all([
    fetchJson(`${BASE}/api/market/movers`, { nse: { gainers: [], losers: [] }, global: { gainers: [], losers: [] }, combined: { gainers: [], losers: [] }, active: [] }),
    fetchJson(`${BASE}/api/ai/market-summary`, { sentiment: 'Neutral', signals: { total: 0, strongBuys: 0, buys: 0, sells: 0 } }),
    fetchJson(`${BASE}/api/indices/all`, {}),
    getSectorPerformance().catch(() => []),
    getNewsSummary().catch(() => ({ hotNews: [], trending: [] })),
    generateSignals(null, true).catch(() => []),
    fxService.getRate('USDKES').catch(() => null),
  ]);

  const signalArr = mergeMonitoredSignals(Array.isArray(signals) ? signals : []);

  // Fill company names from canonical sources (stockData curated maps, then the
  // stocks table) so mangled cache names like "Lulul" never reach the email.
  const stockNames = await getStockNameMap().catch(() => null);
  for (const s of signalArr) {
    if (!s) continue;
    const ticker = s.ticker || s.symbol;
    const curated = resolveStockName(ticker);
    if (curated && curated !== ticker) {
      s.name = curated;
    } else {
      const tableName = stockNames && stockNames.get(ticker);
      s.name = isJunkName(tableName, ticker) ? (isJunkName(s.name, ticker) ? ticker : String(s.name).trim()) : tableName;
    }
  }
  const derivedMovers = deriveMovers(signalArr);

  // Prefer the Market Intelligence page's numbers (/api/ai/market-summary) — the
  // same merge of live cache + monitored positions — so the email count and
  // sentiment always match what the app shows. Fall back to the locally merged
  // universe when the endpoint is unavailable.
  const totalSignals = summary?.signals?.total || signalArr.length;
  const strongBuys = summary?.signals?.strongBuys ?? signalArr.filter(s => s.signal === 'Strong Buy').length;
  const buys = summary?.signals?.buys ?? signalArr.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
  const sells = summary?.signals?.sells ?? signalArr.filter(s => s.signal === 'Sell' || s.signal === 'Strong Sell').length;
  const effectiveSentiment = (summary?.signals?.total ? summary.sentiment : null) || deriveSentimentFromRatings(buys, sells, totalSignals);
  const effectiveSummary = { ...summary, sentiment: effectiveSentiment, signals: { total: totalSignals, strongBuys, buys, sells } };

  // allIndices comes back as an object keyed by symbol — normalize to array
  const indicesArr = allIndices && typeof allIndices === 'object' && !Array.isArray(allIndices)
    ? Object.values(allIndices)
    : (Array.isArray(allIndices) ? allIndices : []);

  const nseIndices = indicesArr.filter(i => i.market === 'NSE' || i.currency === 'KES');
  const globalIdx = indicesArr.filter(i => i.market === 'Global' || i.currency === 'USD');
  const nse20 = nseIndices.find(i => i.symbol?.includes('NSE20'));
  const nasi = nseIndices.find(i => i.symbol?.includes('NSEASI'));
  const sp500 = globalIdx.find(i => i.symbol?.includes('GSPC'));

  // Prefer movers derived from the signal universe (guaranteed non-empty when
  // signals carry change data); fall back to the /api/market/movers snapshot.
  const nseGainers = derivedMovers.nseGainers.length ? derivedMovers.nseGainers : (movers?.nse?.gainers?.slice(0, 3) || []);
  const nseLosers = derivedMovers.nseLosers.length ? derivedMovers.nseLosers : (movers?.nse?.losers?.slice(0, 3) || []);
  const globalGainers = derivedMovers.globalGainers.length ? derivedMovers.globalGainers : (movers?.global?.gainers?.slice(0, 3) || []);
  const active = movers?.active?.slice(0, 3) || [];

  const nseSentiment = (nse20?.isPositive ? 'positive' : nse20?.changeRaw < -0.5 ? 'negative' : 'mixed');
  const globalSentiment = sp500?.isPositive ? 'positive' : sp500?.changeRaw < -0.5 ? 'negative' : 'mixed';

  const cleanSectors = meaningfulSectors(sectors);
  const topSector = cleanSectors.length > 0 ? cleanSectors[0] : null;
  const worstSector = cleanSectors.length > 1 ? cleanSectors[cleanSectors.length - 1] : null;

  const hotNews = news?.hotNews || [];
  const trending = news?.trending || [];
  const topStory = trending.length > 0 ? trending[0] : (hotNews.length > 0 ? hotNews[0] : null);

  let nseSummary, storyOfWeek, milestone, globalTheme, macroBackdrop, whatToWatch, nseGlobalConnection;
  if (USE_LLM) {
    const combined = await llm.generateAllWeeklySections({ nse20, nasi, nseGainers, nseLosers, globalGainers, topSector, worstSector, sp500, summary: effectiveSummary, topStory }).catch(() => null);
    if (combined) {
      nseSummary = combined.nseSummary; storyOfWeek = combined.storyOfWeek; milestone = combined.milestone;
      globalTheme = combined.globalTheme; macroBackdrop = combined.macroBackdrop;
      whatToWatch = combined.whatToWatch; nseGlobalConnection = combined.nseGlobalConnection;
    }
  }
  nseSummary = nseSummary || buildNseSummary(nse20, nseGainers, nseLosers, active, nseSentiment, topSector, worstSector);
  storyOfWeek = storyOfWeek || buildStoryOfWeek(topStory, nseGainers, nseLosers);
  milestone = milestone || buildMilestone(nse20, sp500, nseGainers, movers);
  globalTheme = globalTheme || buildGlobalTheme(globalIdx, globalGainers, globalSentiment, topSector, sectors);
  macroBackdrop = macroBackdrop || buildMacroBackdrop(sectors, effectiveSummary, sp500, fxRate);
  whatToWatch = whatToWatch || buildWhatToWatch(effectiveSummary, nse20, sectors);
  nseGlobalConnection = nseGlobalConnection || buildNseGlobalConnection(nse20, sp500, nseSentiment, globalSentiment);

  const newsForEmail = hotNews.slice(0, 8).map(a => ({
    headline: a.headline || a.title || '',
    source: a.source || a.sourceName || '',
  }));

  return {
    nseSummary, storyOfWeek, milestone, globalTheme, macroBackdrop, whatToWatch, nseGlobalConnection,
    totalSignals,
    nseGainers, nseLosers, globalGainers, globalLosers: derivedMovers.globalLosers,
    hotNews: newsForEmail,
  };
}

function buildNseSummary(nse20, gainers, losers, active, sentiment, topSector, worstSector) {
  const nse20Chg = nse20?.change || '--';
  const nse20Val = nse20?.value || '--';
  let text = `The NSE wrapped the week on a ${sentiment} note, with the NSE 20 at ${nse20Val} (${nse20Chg}). `;

  if (gainers.length > 0) {
    const top = gainers[0];
    text += `${top.name || top.symbol} led the gainers, up ${stripPct(top.change || top.changePercent || '--')}%. `;
  }
  if (losers.length > 0) {
    const bot = losers[0];
    const botPct = Math.abs(parseFloat(stripPct(bot.change || bot.changePercent || '--')) || 0);
    text += `${bot.name || bot.symbol} declined ${botPct}%. `;
  }
  if (active.length > 0) {
    text += `Most active: ${active.map(a => a.name || a.symbol).join(', ')}. `;
  }
  if (topSector) {
    text += `${topSector.sector} was the best-performing sector (${topSector.avgChange}% avg). `;
  }
  if (worstSector) {
    text += `${worstSector.sector} lagged (${worstSector.avgChange}%).`;
  }
  return text;
}

function buildStoryOfWeek(topStory, gainers, losers) {
  if (topStory?.headline) {
    let text = `${topStory.headline} — `;
    text += topStory.excerpt || 'This story dominated market conversation this week.';
    if (topStory.relatedStocks?.length) {
      text += ` Related stock${topStory.relatedStocks.length > 1 ? 's' : ''}: ${topStory.relatedStocks.join(', ')}.`;
    }
    return text;
  }
  if (gainers.length > 0) {
    return `${gainers[0].name || gainers[0].symbol} was the week's standout performer, gaining ${stripPct(gainers[0].change || gainers[0].changePercent || '--')}% on strong volume. This move reflects growing investor confidence in the ${gainers[0].sector || 'sector'} space.`;
  }
  return 'Markets navigated a week of mixed conditions with selective opportunities in blue-chip stocks.';
}

function buildMilestone(nse20, sp500, gainers, movers) {
  if (nse20?.value) {
    return `The NSE 20 traded at ${nse20.value} (${nse20.change}) this week. ${sp500 ? `Globally, the S&P 500 stood at ${sp500.value} (${sp500.change}).` : ''}`;
  }
  if (gainers.length > 0) {
    return `${gainers[0].name || gainers[0].symbol} recorded notable gains of ${stripPct(gainers[0].change || gainers[0].changePercent || '--')}%, standing out as a top weekly performer.`;
  }
  return 'Markets continue to reflect cautious optimism as investors digest the latest economic data.';
}

function buildGlobalTheme(indices, gainers, sentiment, topSector, sectors) {
  const sp = indices.find(i => i.symbol?.includes('GSPC'));
  const ndx = indices.find(i => i.symbol?.includes('IXIC'));
  const dji = indices.find(i => i.symbol?.includes('DJI'));
  const parts = [];
  if (sp) parts.push(`S&P 500 ${sp.change || '--'}`);
  if (ndx) parts.push(`Nasdaq ${ndx.change || '--'}`);
  if (dji) parts.push(`Dow ${dji.change || '--'}`);
  let text = `Global markets trended ${sentiment} this week. `;
  if (parts.length) text += `${parts.join('; ')}. `;
  if (topSector) {
    text += `${topSector.sector} led global sector performance (${topSector.avgChange}%), with ${topSector.upCount} of ${topSector.count} stocks positive. `;
  }
  if (gainers.length > 0) {
    text += `Top global stock: ${gainers[0].name || gainers[0].symbol} (${stripPct(gainers[0].change || gainers[0].changePercent || '--')}%).`;
  }
  return text;
}

function buildWhatToWatch(summary, nse20, sectors) {
  const totalSignals = summary?.signals?.total || 0;
  const strongBuys = summary?.signals?.strongBuys || 0;
  const buys = summary?.signals?.buys || 0;
  const sells = summary?.signals?.sells || 0;
  const parts = [];
  if (totalSignals > 0) {
    parts.push(`StocksIntels AI is tracking ${totalSignals} stocks across NSE and NYSE.`);
  }
  if (buys > 0) {
    parts.push(`${buys} buy-rated stock${buys > 1 ? 's' : ''}${strongBuys > 0 ? ` (${strongBuys} strong buy)` : ''} — potential breakout candidates.`);
  }
  if (sells > 0) {
    parts.push(`${sells} sell rating${sells > 1 ? 's' : ''} warrant${sells === 1 ? 's' : ''} caution on overextended positions.`);
  }
  if (nse20?.value) {
    parts.push(`Watch the NSE 20 at ${nse20.value} (${nse20.change || '--'}) as a key support/resistance zone for the week ahead.`);
  }
  const cleanSectors = meaningfulSectors(sectors);
  if (cleanSectors.length > 0) {
    const top = cleanSectors[0];
    const bottom = cleanSectors[cleanSectors.length - 1];
    if (top) parts.push(`${top.sector} leads sector performance at ${top.avgChange}% — keep on your radar.`);
    if (bottom && bottom.avgChange < 0) parts.push(`${bottom.sector} is lagging at ${bottom.avgChange}% — watch for further weakness.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Watch for key support and resistance levels as the new trading week opens.';
}

function buildMacroBackdrop(sectors, summary, sp500, fxRate) {
  const parts = [];
  const totalSignals = summary?.signals?.total || 0;
  const sentiment = summary?.sentiment || 'Neutral';
  parts.push(`AI market sentiment is ${sentiment} across ${totalSignals} tracked stocks on NSE and NYSE.`);
  const cleanSectors = meaningfulSectors(sectors);
  if (cleanSectors.length > 0) {
    const upSectors = cleanSectors.filter(s => parseFloat(s.avgChange) > 0);
    const downSectors = cleanSectors.filter(s => parseFloat(s.avgChange) < 0);
    if (upSectors.length > 0) {
      parts.push(`${upSectors.length} sector${upSectors.length > 1 ? 's' : ''} positive (${upSectors.slice(0, 2).map(s => `${s.sector} ${s.avgChange}%`).join(', ')}).`);
    }
    if (downSectors.length > 0) {
      parts.push(`${downSectors.length} sector${downSectors.length > 1 ? 's' : ''} negative (${downSectors.slice(-2).map(s => `${s.sector} ${s.avgChange}%`).join(', ')}).`);
    }
  }
  if (sp500) {
    parts.push(`S&P 500 at ${sp500.value || '--'} (${sp500.change || '--'}).`);
  }
  if (fxRate) {
    parts.push(`USD/KES at ${typeof fxRate === 'number' ? fxRate.toFixed(2) : fxRate}.`);
  }
  return parts.join(' ');
}

function buildNseGlobalConnection(nse20, sp500, nseSent, globalSent) {
  if (sp500 && nse20) {
    const raw = sp500.changeRaw || 0;
    const direction = raw > 0.1 ? 'higher' : (raw < -0.1 ? 'lower' : 'mixed');
    const tone = raw > 0.1 ? 'supportive' : (raw < -0.1 ? 'cautious' : 'neutral');
    return `Global markets closed ${direction} (S&P 500 ${sp500.change || '--'}). Historically, a ${direction} Wall Street session tends to set a ${tone} tone for the NSE open. The NSE 20 at ${nse20.value || '--'} will be tested against global sentiment early in the week.`;
  }
  return 'Global market movements overnight can set the tone for NSE open. Watch for significant gap-ups or gap-downs in the first 30 minutes of trading, especially in large-cap banking and telecom names.';
}

// ── Daily Brief Content ──

// Junk / ticker-only company names are noise in reader-facing copy — never
// surface "LULU", "lulu", "Unknown" or placeholder-y names in mover tables.
function isJunkName(name, ticker) {
  if (!name) return true;
  const n = String(name).trim();
  if (!n || n.length <= 4) return true;
  if (ticker && n.toUpperCase() === String(ticker).toUpperCase()) return true;
  return /^(unknown|unavailable|n\/a|none|-+|\.+)$/i.test(n);
}

// Canonical display name: curated maps (stockData) first, then a non-junk
// stocks-table name, else the bare ticker.
function resolveDisplayName(ticker, tableName) {
  if (!ticker) return tableName || '';
  const curated = resolveStockName(ticker);
  if (curated && curated !== ticker) return curated;
  return isJunkName(tableName, ticker) ? ticker : String(tableName).trim();
}

// Canonical company-name lookup from the stocks table. Signals coming from the
// live cache sometimes only carry the ticker as `name` (or no name at all, e.g.
// DDOG, COHR, CGEN), which made the movers table render "DDOG DDOG". Load the
// map once and reuse it across brief generations.
let stockNameCache = null;
async function getStockNameMap() {
  if (!stockNameCache) {
    try {
      const { rows } = await pool.query('SELECT ticker, name FROM stocks');
      stockNameCache = new Map();
      for (const r of rows) {
        if (!isJunkName(r.name, r.ticker)) stockNameCache.set(r.ticker, String(r.name).trim());
      }
    } catch { stockNameCache = new Map(); }
  }
  return stockNameCache;
}

// Sectors like "Other" (the catch-all bucket for names outside the static
// ticker maps) are noise in reader-facing copy — never headline them.
const JUNK_SECTORS = new Set(['Other', 'General', 'Unknown', 'Miscellaneous', '', 'N/A']);
function meaningfulSectors(sectors) {
  return (Array.isArray(sectors) ? sectors : [])
    .filter(s => s && s.sector && !JUNK_SECTORS.has(String(s.sector).trim()));
}

// Truncate long signal reasons at a word boundary so we never render "hig..."
// or clip mid-phrase. Only falls back to a hard cut when the boundary is too
// far back, and strips trailing punctuation before the ellipsis.
function truncateReason(text, limit) {
  if (!text) return '';
  const str = String(text).trim();
  if (str.length <= limit) return str;
  let cut = str.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > limit * 0.6) cut = cut.slice(0, lastSpace);
  return cut.replace(/[,\s;:.]+$/, '') + '...';
}

// Build a daily mover row from a signal, matching the shape the email mover
// tables expect (symbol / name / change as a signed, rounded percentage).
function toMoverRow(s) {
  const change = Math.round((s.change || 0) * 100) / 100;
  return {
    symbol: s.ticker || s.symbol || '--',
    name: s.name || '',
    change: (change > 0 ? '+' : '') + change + '%',
  };
}

// Strip a trailing '%' from a change string so prose can re-append it without
// producing "8.11%%".
function stripPct(v) {
  if (v == null) return '';
  return String(v).replace('%', '');
}

// Mirror the /api/ai/market-summary sentiment buckets exactly, so the email
// never disagrees with the Market Intelligence page.
function deriveSentimentFromRatings(buys, sells, total) {
  const bullishPct = total > 0 ? (buys / total) * 100 : 0;
  if (bullishPct >= 65) return 'Bullish';
  if (bullishPct >= 50) return 'Slightly Bullish';
  if (bullishPct >= 36) return 'Slightly Bearish';
  return 'Bearish';
}

// Merge the live engine cache with open monitored positions so the digest's
// numbers match the Market Intelligence page (/api/ai/market-summary).
function mergeMonitoredSignals(signals) {
  const arr = Array.isArray(signals) ? signals : [];
  const byTicker = new Map(arr.map(s => [s.ticker, s]));
  const merged = [...arr];
  for (const m of getMonitoredSignals()) {
    if (m && m.ticker && !byTicker.has(m.ticker)) merged.push({ ...m });
  }
  return merged;
}

// Split the signal universe into per-market gainers/losers so the weekly
// digest's four mover tables never render empty even when the /api/market/movers
// snapshot has no fresh quotes.
function deriveMovers(signals) {
  const withMove = (signals || []).filter(s => s && s.change != null && s.change !== 0);
  const nse = withMove.filter(s => s.currency === 'KES' || isNseTicker(s.ticker));
  const global = withMove.filter(s => s.currency !== 'KES' && !isNseTicker(s.ticker));
  return {
    nseGainers: nse.filter(s => s.change > 0).sort((a, b) => b.change - a.change).slice(0, 6).map(toMoverRow),
    nseLosers: nse.filter(s => s.change < 0).sort((a, b) => a.change - b.change).slice(0, 6).map(toMoverRow),
    globalGainers: global.filter(s => s.change > 0).sort((a, b) => b.change - a.change).slice(0, 6).map(toMoverRow),
    globalLosers: global.filter(s => s.change < 0).sort((a, b) => a.change - b.change).slice(0, 6).map(toMoverRow),
  };
}

async function generateDailyBriefContent() {
  const [summary, allIndices, sectors, signals] = await Promise.all([
    fetchJson(`${BASE}/api/ai/market-summary`, { sentiment: 'Neutral', signals: { total: 0, strongBuys: 0, buys: 0, sells: 0 } }),
    fetchJson(`${BASE}/api/indices/all`, {}),
    getSectorPerformance().catch(() => []),
    generateSignals(null, true).catch(() => []),
  ]);

  const byTicker = new Map();
  (Array.isArray(signals) ? signals : []).forEach(s => byTicker.set(s.ticker, s));
  for (const m of getMonitoredSignals()) {
    if (byTicker.has(m.ticker)) {
      const existing = byTicker.get(m.ticker);
      existing.signal = m.signal;
      existing.action = 'buy';
      existing.confidence = m.confidence ?? existing.confidence ?? 50;
      if (existing.change == null) existing.change = m.change ?? 0;
    } else {
      byTicker.set(m.ticker, {
        ticker: m.ticker, name: m.name || m.ticker,
        signal: m.signal, action: 'buy',
        confidence: m.confidence ?? 50,
        entry: m.entryPrice, sector: m.sector || 'General',
        reason: m.reason || '', type: m.type,
        change: m.change ?? 0,
      });
    }
  }
  const enrichedSignals = [...byTicker.values()];

  // Fill company names from canonical sources so mangled cache names never leak
  // into the email mover tables.
  const stockNames = await getStockNameMap().catch(() => null);
  for (const s of enrichedSignals) {
    if (!s) continue;
    const ticker = s.ticker || s.symbol;
    const curated = resolveStockName(ticker);
    if (curated && curated !== ticker) {
      s.name = curated;
    } else {
      const tableName = stockNames && stockNames.get(ticker);
      s.name = isJunkName(tableName, ticker) ? (isJunkName(s.name, ticker) ? ticker : String(s.name).trim()) : tableName;
    }
  }

  // allIndices comes back as an object keyed by symbol — normalize to array
  const indicesArr = allIndices && typeof allIndices === 'object' && !Array.isArray(allIndices)
    ? Object.values(allIndices)
    : (Array.isArray(allIndices) ? allIndices : []);

  const nseIndices = indicesArr.filter(i => i.market === 'NSE' || i.currency === 'KES');
  const globalIdx = indicesArr.filter(i => i.market === 'Global' || i.currency === 'USD');

  const usdToKes = await fxService.getRate('USDKES').catch(() => '--');

  const nse20 = nseIndices.find(i => i.symbol?.includes('NSE20'));
  const nasi = nseIndices.find(i => i.symbol?.includes('NSEASI'));
  const sp500 = globalIdx.find(i => i.symbol?.includes('GSPC'));
  const ndx = globalIdx.find(i => i.symbol?.includes('IXIC'));
  const dji = globalIdx.find(i => i.symbol?.includes('DJI'));

  const usdKesStr = typeof usdToKes === 'number' ? usdToKes.toFixed(2) : (usdToKes || '--');

  const indices = [
    { label: 'NSE 20', value: nse20?.value || '--', change: nse20?.change || '--' },
    { label: 'NASI', value: nasi?.value || '--', change: nasi?.change || '--' },
    { label: 'S&P 500', value: sp500?.value || '--', change: sp500?.change || '--' },
    { label: 'USD/KES', value: usdKesStr, change: '--' },
  ];

  const combinedMovers = enrichedSignals
    .filter(s => s.change != null && s.change !== 0)
    .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
    .slice(0, 6);
  const yesterdayTopMovers = combinedMovers.map(m => ({
    symbol: m.ticker || '--',
    company: m.name || '',
    change: (m.change > 0 ? '+' : '') + (Math.round((m.change || 0) * 100) / 100) + '%',
    volume: m.volume && m.volume !== '0' && m.volume !== '--' ? m.volume : '--',
  }));

  const signalOfDay = enrichedSignals
    .filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 3);

  // Prefer the Market Intelligence page's numbers (/api/ai/market-summary) so the
  // brief always matches the app; fall back to the locally merged universe.
  const totalSignals = summary?.signals?.total || enrichedSignals.length;
  const strongBuys = summary?.signals?.strongBuys || enrichedSignals.filter(s => s.signal === 'Strong Buy').length;
  const buys = summary?.signals?.buys || enrichedSignals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
  const sells = summary?.signals?.sells || enrichedSignals.filter(s => s.signal === 'Sell' || s.signal === 'Strong Sell').length;
  const effectiveSentiment = (summary?.signals?.total ? summary.sentiment : null)
    || (totalSignals > 0
      ? (buys > sells * 2 ? 'Bullish' : buys > sells ? 'Slightly Bullish' : sells > buys * 2 ? 'Bearish' : sells > buys ? 'Slightly Bearish' : 'Neutral')
      : 'Neutral');

  const aiSignal = `StocksIntels AI indicates ${effectiveSentiment} market conditions — ${totalSignals} tracked stocks across NSE and NYSE.`;

  let aiSignalContext, globalToNseConnection, analystTake;
  if (USE_LLM) {
    const combined = await llm.generateAllBriefSections({ sentiment: effectiveSentiment, signals: { total: totalSignals, strongBuys, buys, sells }, topSignals: signalOfDay, sp500, ndx, nse20, sectors }).catch(() => null);
    if (combined) {
      aiSignalContext = combined.aiSignalContext;
      globalToNseConnection = combined.globalToNseConnection;
      analystTake = combined.analystTake;
    }
  }
  const effectiveSummary = { ...summary, sentiment: effectiveSentiment, signals: { total: totalSignals, strongBuys, buys, sells } };
  aiSignalContext = aiSignalContext || buildAiSignalContext(effectiveSummary, signalOfDay, sp500);
  globalToNseConnection = globalToNseConnection || buildDailyGlobalConnection(sp500, ndx, nse20, effectiveSummary);
  analystTake = analystTake || buildAnalystTake(signalOfDay, sectors, effectiveSummary);

  const spChgRaw = sp500?.changeRaw || 0;
  const ndxChgRaw = ndx?.changeRaw || 0;
  const djiChgRaw = dji?.changeRaw || 0;

  const spDriver = sp500 ? (spChgRaw > 0.5 ? 'Risk-on sentiment' : spChgRaw < -0.5 ? 'Risk-off pressure' : 'Flat close') : 'Overnight data pending';
  const ndxDriver = ndx ? (ndxChgRaw > 0.8 ? 'Tech rally' : ndxChgRaw < -0.8 ? 'Tech selloff' : 'Mixed tech session') : 'Overnight data pending';
  const djiDriver = dji ? (djiChgRaw > 0.3 ? 'Industrial strength' : djiChgRaw < -0.3 ? 'Industrial weakness' : 'Sideways trade') : 'Overnight data pending';

  const globalIndices = [
    { label: 'S&P 500', value: sp500?.value || '--', change: sp500?.change || '--', keyDriver: spDriver },
    { label: 'Nasdaq', value: ndx?.value || '--', change: ndx?.change || '--', keyDriver: ndxDriver },
    { label: 'Dow Jones', value: dji?.value || '--', change: dji?.change || '--', keyDriver: djiDriver },
  ];

  return { indices, yesterdayTopMovers, aiSignal, aiSignalContext, globalIndices, globalToNseConnection, calendar: [], analystTake };
}

function buildAiSignalContext(summary, topSignals, sp500) {
  const sent = summary?.sentiment || 'Neutral';
  const parts = [];
  if (sent === 'Bullish') {
    parts.push('Bullish sentiment signals broad market strength. Watch for follow-through buying in large-cap names at open.');
  } else if (sent === 'Bearish') {
    parts.push('Bearish sentiment suggests caution at the open. Consider defensive positioning in early trade.');
  } else {
    parts.push('Neutral sentiment suggests range-bound trading. Watch for a breakout catalyst in the first hour.');
  }
  if (topSignals.length > 0) {
    const top = topSignals[0];
    const shortReason = truncateReason(top.reason, 140);
    const reasonEnd = shortReason && /[.!?]$/.test(shortReason) ? '' : '.';
    parts.push(`Top pick: ${top.name || top.ticker} (${top.signal}, ${top.confidence}% confidence)${shortReason ? ` — ${shortReason}${reasonEnd}` : '.'}`);
  }
  if (sp500?.changeRaw) {
    parts.push(`S&P 500 futures ${sp500.changeRaw > 0 ? 'pointing higher' : 'under pressure'} (${sp500.change}).`);
  }
  return parts.join(' ');
}

function buildDailyGlobalConnection(sp500, ndx, nse20, summary) {
  const spChange = sp500?.changeRaw || 0;
  const sent = summary?.sentiment || 'neutral';
  if (Math.abs(spChange) > 0.5) {
    return `Global markets closed ${spChange > 0 ? 'higher' : 'lower'} with the S&P 500 ${sp500?.change || '--'}. This sets a ${spChange > 0 ? 'supportive' : 'challenging'} backdrop for the NSE open. Key NSE levels: NSE 20 at ${nse20?.value || '--'}. Banking and telecom stocks typically lead any gap reaction.`;
  }
  return 'Global market movements overnight can set the tone for NSE open. Watch for any significant gap-ups or gap-downs in the first 30 minutes of trading, especially in large-cap banking and telecom names.';
}

function buildDailyCalendar() {
  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  if (dayName === 'Friday') {
    return [
      { time: '10:00', event: 'CBK Foreign Exchange Reserves', impact: 'MEDIUM' },
      { time: '15:00', event: 'Earnings reports (ongoing season)', impact: 'HIGH' },
    ];
  }
  if (dayName === 'Monday') {
    return [
      { time: '09:30', event: 'NSE Opens — Early trade watch', impact: 'HIGH' },
      { time: '15:00', event: 'Global manufacturing PMI data', impact: 'MEDIUM' },
    ];
  }
  if (dayName === 'Wednesday') {
    return [
      { time: 'All Day', event: 'Mid-week position adjustments', impact: 'MEDIUM' },
      { time: '15:30', event: 'US oil inventories', impact: 'MEDIUM' },
    ];
  }
  return [
    { time: '09:30', event: 'NSE Market Open', impact: 'HIGH' },
    { time: '15:00', event: 'Global market updates', impact: 'MEDIUM' },
  ];
}

function buildAnalystTake(topSignals, sectors, summary) {
  const sent = summary?.sentiment || 'neutral';
  const total = summary?.signals?.total || 0;
  const buys = summary?.signals?.buys || 0;
  const sells = summary?.signals?.sells || 0;
  const strongBuys = summary?.signals?.strongBuys || 0;
  let text = `Across ${total} rated stocks, ${buys} buy${buys !== 1 ? 's' : ''} (${strongBuys} strong) vs ${sells} sell${sells !== 1 ? 's' : ''} — ${sent.toLowerCase()} bias. `;
  if (topSignals.length > 0) {
    const s = topSignals[0];
    const shortReason = truncateReason(s.reason, 120);
    text += `${s.name || s.ticker} leads with a ${s.signal} pick (${s.confidence}% confidence)${s.entry ? ` at ${s.entry}` : ''}. ${shortReason} `;
  }
  const cleanSectors = meaningfulSectors(sectors);
  if (cleanSectors.length > 0) {
    const leading = cleanSectors.filter(s => parseFloat(s.avgChange) > 0).slice(0, 2);
    if (leading.length > 0) {
      text += `Leading sectors: ${leading.map(s => `${s.sector} (${s.avgChange}%)`).join(', ')}. `;
    }
  }
  if (sells > 0) {
    text += `${sells} sell rating${sells > 1 ? 's' : ''} flagged — monitor for downside risk.`;
  }
  return text;
}

// ── Earnings Report Content ──

const AFRICA_IMPACT = {
  'AAPL': 'Apple supply chain affects tech imports and assembly operations across East and West Africa.',
  'JPM': 'JPMorgan results inform emerging-market capital flows — directly relevant for Kenyan bond and equity markets.',
  'XOM': 'Exxon Mobil outlook impacts oil-dependent African economies (Nigeria, Angola, Ghana).',
  'META': 'Meta investments drive African digital connectivity and content creation economies.',
  'MSFT': 'Microsoft cloud expansion underpins fintech and enterprise growth across African markets.',
  'GOOGL': 'Google/Alphabet advertising and Android ecosystem reach hundreds of millions of African mobile users.',
  'AMZN': 'AWS cloud services power growing African startup and enterprise infrastructure.',
  'TSLA': 'Tesla EV strategy influences energy transition sentiment in resource-rich African nations.',
  'NVDA': 'Nvidia AI demand signals global tech spending that trickles into African tech ecosystem.',
  'V': 'Visa transaction volumes in Africa reflect consumer spending and financial inclusion trends.',
  'BRK.B': 'Berkshire portfolio signals institutional confidence in global markets including African exposure.',
  'UNH': 'UnitedHealth results inform global healthcare spending trends relevant to African health insurers.',
  'JNJ': 'Johnson & Johnson pharmaceutical pipeline impacts African healthcare delivery.',
  'WMT': 'Walmart supply chain and retail trends reflect global consumer health relevant to African trade.',
  'PG': 'Procter & Gamble Africa operations directly affected by consumer demand shifts.',
};

const MAJOR_GLOBAL_TICKERS = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','JPM','V','JNJ','UNH','XOM','TSLA','BRK.B','WMT','PG'];

async function generateEarningsContent() {
  const today = new Date();
  const fromDate = today.toISOString().slice(0, 10);
  const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const toDate = nextMonth.toISOString().slice(0, 10);

  const [signals, calendarData] = await Promise.all([
    generateSignals(null, true).catch(() => []),
    fetchFinnhubEarningsCalendar(fromDate, toDate).catch(() => []),
  ]);

  const signalArr = Array.isArray(signals) ? signals : [];

  const earningsCalendar = buildEarningsCalendar(calendarData, signalArr);
  const earningsResults = await buildEarningsResults(calendarData, signalArr);
  const corporateActions = buildCorporateActions(signalArr);
  const globalEarnings = await buildGlobalEarnings(calendarData, signalArr);

  return { earningsCalendar, earningsResults, corporateActions, globalEarnings };
}

function buildEarningsCalendar(calendarData, signals) {
  const entries = [];
  const seen = new Set();

  const upcoming = (calendarData || []).filter(e => e.epsEstimate != null || e.revenueEstimate != null);
  for (const e of upcoming.slice(0, 10)) {
    if (seen.has(e.ticker)) continue;
    seen.add(e.ticker);
    const fund = getSignalFundamentals(e.ticker, signals);
    const quarterLabel = e.quarter ? `Q${e.quarter}` : 'FY';
    const yearLabel = e.year || new Date(e.date).getFullYear();
    const dateObj = new Date(e.date + 'T12:00:00Z');
    const dateStr = `${dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${yearLabel}`;
    const hourLabel = e.hour === 'amc' ? ' (After Close)' : e.hour === 'bmo' ? ' (Before Open)' : '';
    entries.push({
      date: dateStr + hourLabel,
      company: fund?.name || e.ticker,
      ticker: e.ticker,
      exchange: isNseTicker(e.ticker) ? 'NSE' : 'NASDAQ/NYSE',
      period: `${quarterLabel} ${yearLabel}`,
      epsEstimate: e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : '--',
      revenueEstimate: e.revenueEstimate != null ? formatRevenue(e.revenueEstimate) : '--',
    });
  }

  const nseSignals = signals.filter(s => isNseTicker(s.ticker) && !seen.has(s.ticker));
  for (const s of nseSignals.slice(0, 3)) {
    seen.add(s.ticker);
    entries.push({
      date: 'Upcoming',
      company: s.name || s.ticker,
      ticker: s.ticker,
      exchange: 'NSE',
      period: 'Quarterly',
      epsEstimate: '--',
      revenueEstimate: '--',
    });
  }

  return entries.slice(0, 12);
}

async function buildEarningsResults(calendarData, signals) {
  const results = [];
  const seen = new Set();

  const reported = (calendarData || []).filter(e => e.epsActual != null);
  for (const e of reported.slice(0, 5)) {
    if (seen.has(e.ticker)) continue;
    seen.add(e.ticker);
    const surprises = await fetchFinnhubEarningsSurprises(e.ticker).catch(() => []);
    const latest = surprises.length > 0 ? surprises[0] : null;
    const fund = getSignalFundamentals(e.ticker, signals);
    const quarterLabel = e.quarter ? `Q${e.quarter}` : 'FY';
    const yearLabel = e.year || new Date(e.date).getFullYear();
    const surprisePct = latest?.surprisePercent || 0;
    const isBeat = surprisePct > 0;
    const isMiss = surprisePct < -2;
    results.push({
      ticker: e.ticker,
      company: fund?.name || e.ticker,
      exchange: isNseTicker(e.ticker) ? 'NSE' : 'NASDAQ/NYSE',
      period: `${quarterLabel} ${yearLabel}`,
      verdict: isBeat ? 'BEAT' : isMiss ? 'MISS' : 'IN-LINE',
      revenue: e.revenueActual != null ? formatRevenue(e.revenueActual) : (e.revenueEstimate != null ? `Est. ${formatRevenue(e.revenueEstimate)}` : '--'),
      eps: e.epsActual != null ? `$${e.epsActual.toFixed(2)}` : '--',
      epsEstimate: e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : '--',
      vsEstimate: latest ? (latest.surprisePercent > 0 ? '+' : '') + latest.surprisePercent.toFixed(1) + '%' : '--',
      aiAnalysis: buildEarningsAnalysis(e.ticker, e, latest, fund),
      shortTermSignal: isBeat ? 'BULLISH' : isMiss ? 'BEARISH' : 'NEUTRAL',
      dividend: fund?.dividendYield ? `${fund.dividendYield}%` : undefined,
      watchPrice: fund?.targetPrice || undefined,
    });
  }

  if (results.length < 5) {
    const sigsWithFinancials = signals.filter(s => s.analysis?.financial?.metrics && !seen.has(s.ticker));
    for (const s of sigsWithFinancials.slice(0, 5 - results.length)) {
      seen.add(s.ticker);
      const m = s.analysis.financial.metrics || {};
      const rev = m.revenue || m.Revenue || null;
      const eps = m.eps || m.EPS || null;
      const est = m.estimatedEarnings || m.estimates?.eps || null;
      results.push({
        ticker: s.ticker,
        company: s.name,
        exchange: isNseTicker(s.ticker) ? 'NSE' : 'NASDAQ/NYSE',
        period: 'Latest FY',
        verdict: s.signal === 'Strong Buy' || s.signal === 'Buy' ? 'BEAT' : s.signal === 'Sell' || s.signal === 'Strong Sell' ? 'MISS' : 'IN-LINE',
        revenue: rev != null ? (typeof rev === 'number' ? '$' + rev.toLocaleString() : rev) : '--',
        eps: eps != null ? (typeof eps === 'number' ? '$' + eps.toFixed(2) : eps) : '--',
        epsEstimate: est != null ? `$${est.toFixed(2)}` : '--',
        vsEstimate: est && typeof eps === 'number' ? (eps > est ? '+' : '') + ((eps - est) / est * 100).toFixed(1) + '%' : '--',
        aiAnalysis: s.reason || `${s.name} carries a ${s.signal} signal with ${s.confidence}% confidence based on fundamental and technical analysis.`,
        shortTermSignal: s.signal === 'Strong Buy' ? 'BULLISH' : s.signal === 'Strong Sell' ? 'BEARISH' : 'NEUTRAL',
        dividend: m.dividendYield ? `${m.dividendYield}%` : undefined,
        watchPrice: s.target1 || undefined,
      });
    }
  }

  return results.slice(0, 5);
}

async function buildGlobalEarnings(calendarData, signals) {
  const results = [];
  const seen = new Set();

  const majorReported = (calendarData || []).filter(e => MAJOR_GLOBAL_TICKERS.includes(e.ticker) && e.epsActual != null);
  for (const e of majorReported.slice(0, 5)) {
    if (seen.has(e.ticker)) continue;
    seen.add(e.ticker);
    const surprises = await fetchFinnhubEarningsSurprises(e.ticker).catch(() => []);
    const latest = surprises.length > 0 ? surprises[0] : null;
    const surprisePct = latest?.surprisePercent || 0;
    const isBeat = surprisePct > 0;
    const isMiss = surprisePct < -2;
    results.push({
      ticker: e.ticker,
      company: getSignalFundamentals(e.ticker, signals)?.name || e.ticker,
      result: isBeat ? 'BEAT' : isMiss ? 'MISS' : 'IN-LINE',
      epsActual: e.epsActual != null ? `$${e.epsActual.toFixed(2)}` : '--',
      epsEstimate: e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : '--',
      surprise: latest ? (latest.surprisePercent > 0 ? '+' : '') + latest.surprisePercent.toFixed(1) + '%' : '--',
      africaImpact: AFRICA_IMPACT[e.ticker] || `${e.ticker} performance provides macro read-through for African markets.`,
    });
  }

  if (results.length < 3) {
    const majorUpcoming = (calendarData || []).filter(e => MAJOR_GLOBAL_TICKERS.includes(e.ticker) && !seen.has(e.ticker));
    for (const e of majorUpcoming.slice(0, 3 - results.length)) {
      seen.add(e.ticker);
      results.push({
        ticker: e.ticker,
        company: getSignalFundamentals(e.ticker, signals)?.name || e.ticker,
        result: 'UPCOMING',
        epsActual: '--',
        epsEstimate: e.epsEstimate != null ? `$${e.epsEstimate.toFixed(2)}` : '--',
        surprise: '--',
        africaImpact: AFRICA_IMPACT[e.ticker] || `${e.ticker} results will provide macro read-through for African markets.`,
      });
    }
  }

  return results.slice(0, 5);
}

function buildCorporateActions(signals) {
  const entries = [];
  const valueSignals = signals.filter(s => s.type === 'Long Term Value' || s.type === 'Dividend');
  for (const s of valueSignals.slice(0, 6)) {
    const m = s.analysis?.financial?.metrics || {};
    entries.push({
      date: 'Ongoing',
      company: s.name || s.ticker,
      ticker: s.ticker,
      exchange: isNseTicker(s.ticker) ? 'NSE' : 'NASDAQ/NYSE',
      actionType: s.type === 'Dividend' ? 'DIVIDEND' : 'VALUE OPPORTUNITY',
      details: s.type === 'Dividend'
        ? `Yield: ${m.dividendYield || '--'}%. ${s.reason || ''}`
        : `Undervalued: ${s.analysis?.fundamental?.grade || 'N/A'} grade. Entry: ${s.entry || '--'}. Target: ${s.target1 || '--'}.`,
    });
  }
  return entries.slice(0, 8);
}

function buildEarningsAnalysis(ticker, earningsEvent, latest, fund) {
  const parts = [];
  if (latest) {
    if (latest.surprisePercent > 0) {
      parts.push(`${ticker} beat estimates by ${latest.surprisePercent.toFixed(1)}%`);
    } else if (latest.surprisePercent < -2) {
      parts.push(`${ticker} missed estimates by ${Math.abs(latest.surprisePercent).toFixed(1)}%`);
    } else {
      parts.push(`${ticker} reported in-line with expectations`);
    }
  }
  if (fund?.sector) parts.push(`Sector: ${fund.sector}.`);
  if (fund?.marketCap) parts.push(`Market cap: ${formatMarketCap(fund.marketCap)}.`);
  return parts.length > 0 ? parts.join(' ') : `${ticker} reported earnings for the period.`;
}

function getSignalFundamentals(ticker, signals) {
  const sig = (signals || []).find(s => s.ticker === ticker);
  if (!sig) return null;
  return {
    name: sig.name,
    sector: sig.sector,
    marketCap: sig.marketCap || sig.analysis?.fundamental?.marketCap,
    dividendYield: sig.analysis?.financial?.metrics?.dividendYield,
    targetPrice: sig.target1,
  };
}

function isNseTicker(ticker) {
  try {
    return NSE_SYMBOLS && NSE_SYMBOLS.includes(ticker);
  } catch { return false; }
}

function formatRevenue(val) {
  if (typeof val !== 'number') return '--';
  if (val >= 1e12) return '$' + (val / 1e12).toFixed(1) + 'T';
  if (val >= 1e9) return '$' + (val / 1e9).toFixed(1) + 'B';
  if (val >= 1e6) return '$' + (val / 1e6).toFixed(0) + 'M';
  return '$' + val.toLocaleString();
}

function formatMarketCap(val) {
  if (!val) return '--';
  if (val >= 1e12) return '$' + (val / 1e12).toFixed(1) + 'T';
  if (val >= 1e9) return '$' + (val / 1e9).toFixed(1) + 'B';
  if (val >= 1e6) return '$' + (val / 1e6).toFixed(0) + 'M';
  return '$' + val.toLocaleString();
}

module.exports = { generateWeeklyDigestContent, generateDailyBriefContent, generateEarningsContent };
