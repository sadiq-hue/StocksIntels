// Stock Insights Newsletter Service
// Generates a semi-automated, Hisa-style daily stock insights email.
// Picks top stocks from BOTH NSE and global markets by sentiment swing + price moves,
// generates editorial analysis, and stores a draft in newsletter_drafts for admin review.

const axios = require('axios');
const { pool } = require('./db');
const { getAllNews, getNewsSummary } = require('./newsService');
const { getCompanyName } = require('./marketService');
const { getFundamentals } = require('./signalService');
const llm = require('./llmService');
const periodReturnsService = require('./periodReturnsService');

// ── Newsletter diversity config ────────────────────────────────────
// Why the same 3-4 tickers kept repeating in every draft: the old picker
// ranked purely by raw news-mention count, so whatever tickers dominated
// the day's feed won every run — and repeated "Generate Draft" clicks wrote
// byte-identical drafts with no rotation or dedupe. These knobs add a
// diversity layer on top of the news score:
const RECENT_FEATURE_DAYS = 7;          // exclude tickers featured in drafts/issues within the last N days
const HARD_REPEAT_OVERRIDE_SCORE = 8;   // a news score this high means the story is real — eligible to repeat
const MAX_REPEATS_PER_DRAFT = 1;        // cap: at most ONE recently-featured name per issue, so drafts rotate
const SIGNAL_BOOST = 3;                 // points added when a candidate also has a recent high-confidence live signal
const SIGNAL_CONFIDENCE_MIN = 75;       // confidence threshold for the live-engine boost
const SIGNAL_LOOKBACK_DAYS = 3;         // how far back live high-conviction signals count for the boost
const MAX_DEDUPE_ATTEMPTS = 12;         // safety bound on the walk-down that guarantees a different set
const SECTOR_VARIETY_COUNT = 2;         // avoid two same-sector names leading the NSE line-up
const MIN_TAGGED_ARTICLES = 2;          // a name must be independently covered by this many articles to be a candidate

const PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${PORT}`;

// Cache of known NSE tickers from DB (refreshed periodically)
let nseTickerCache = new Set();
let nseTickerCacheTime = 0;
const NSE_CACHE_TTL = 3600000; // 1 hour

async function getNseTickers() {
  if (nseTickerCache.size > 0 && Date.now() - nseTickerCacheTime < NSE_CACHE_TTL) {
    return nseTickerCache;
  }
  try {
    const { rows } = await pool.query("SELECT DISTINCT UPPER(ticker) as ticker FROM stocks WHERE ticker IS NOT NULL AND market = 'NSE'");
    nseTickerCache = new Set(rows.map(r => r.ticker));
    nseTickerCacheTime = Date.now();
    console.log(`[INSIGHTS] Loaded ${nseTickerCache.size} NSE tickers from DB`);
  } catch (e) {
    console.error('[INSIGHTS] Failed to load NSE tickers:', e.message);
  }
  return nseTickerCache;
}

function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function fetchJson(url, fallback = null) {
  try {
    const r = await axios.get(url, { timeout: 10000 });
    return r.data;
  } catch { return fallback; }
}

// ── Classify ticker as NSE or Global ──────────────────────────────
// If ticker exists in the stocks table → NSE. Otherwise → Global.
async function isNseTicker(ticker) {
  const nseTickers = await getNseTickers();
  return nseTickers.has(ticker.toUpperCase());
}

async function getMarketLabel(ticker) {
  return (await isNseTicker(ticker)) ? 'NSE' : 'Global';
}

function getExchangeDisplay(market) {
  return market === 'Global' ? 'Global' : 'NSE';
}

function getGlobalExchange(ticker) {
  const t = ticker.toUpperCase();
  if (['TSM','ASML','NVO','AZN','SAP','UL'].includes(t)) return 'Global';
  if (['BABA','JD','PDD','NIO','XPEV','BYD'].includes(t)) return 'HK/US';
  return 'US';
}

// ── Recently-featured tickers (for rotation) ──────────────────────
// Pull tickers that already appeared in drafts/issues within the rotation
// window, so coverage spreads instead of re-runs the same 4 names.
async function getRecentFeaturedTickers() {
  const featured = {};
  try {
    const { rows } = await pool.query(
      `SELECT content FROM newsletter_drafts
       WHERE draft_date >= CURRENT_DATE - ($1 || ' days')::interval
       ORDER BY id DESC LIMIT 50`,
      [RECENT_FEATURE_DAYS]
    );
    for (const row of rows) {
      const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      const dives = content && content.stockDeepDives;
      for (const d of (Array.isArray(dives) ? dives : [])) {
        if (d && d.ticker) {
          const t = d.ticker.toUpperCase();
          featured[t] = (featured[t] || 0) + 1;
        }
      }
    }
  } catch (e) {
    console.error('[INSIGHTS/pick] Failed to load featured tickers:', e.message);
  }
  return featured;
}

// Ticker set of the most recent draft — used to guarantee consecutive
// drafts always differ by at least one name.
async function getLatestDraftTickerSet() {
  try {
    const { rows } = await pool.query(
      `SELECT content FROM newsletter_drafts ORDER BY id DESC LIMIT 1`
    );
    if (!rows.length) return new Set();
    const content = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
    const dives = content && content.stockDeepDives;
    const set = new Set();
    for (const d of (Array.isArray(dives) ? dives : [])) if (d && d.ticker) set.add(d.ticker.toUpperCase());
    return set;
  } catch { return new Set(); }
}

// Sector per ticker from latest signal_history rows (falls back to 'Other').
async function loadSectorMap() {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (UPPER(ticker)) UPPER(ticker) AS ticker, sector
       FROM signal_history
       WHERE sector IS NOT NULL AND sector != ''
       ORDER BY UPPER(ticker), generated_at DESC`
    );
    const m = {};
    for (const r of rows) m[r.ticker] = r.sector;
    return m;
  } catch { return {}; }
}

// Tickers the live engine is actively recommending with high conviction:
// a news-candidate that is also a fresh high-confidence Buy gets a boost,
// so the newsletter surfaces actionable engine picks, not just noise.
async function loadSignalBoostMap() {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (UPPER(ticker)) UPPER(ticker) AS ticker, confidence
       FROM signal_history
       WHERE generated_at >= NOW() - ($1 || ' days')::interval
         AND LOWER(signal) IN ('buy', 'strong buy', 'strongbuy')
         AND confidence >= $2
       ORDER BY UPPER(ticker), generated_at DESC`,
      [SIGNAL_LOOKBACK_DAYS, SIGNAL_CONFIDENCE_MIN]
    );
    const m = {};
    for (const r of rows) m[r.ticker] = m[r.ticker] === undefined ? SIGNAL_BOOST : m[r.ticker];
    return m;
  } catch { return {}; }
}

function logPickDecision(parts) {
  console.log('[INSIGHTS/pick] ' + parts.join(' | '));
}

// ── Pick top stocks from BOTH NSE and global ──────────────────────
// forceFresh = true (admin Regenerate): hard-block every recently-featured
// ticker, no override — the result is guaranteed brand-new names even on a
// quiet news day (the draft may be shorter if few fresh candidates exist).
async function pickHotStocks(forceFresh = false) {
  const allNews = await getAllNews(300).catch(() => []);

  const nseTickers = await getNseTickers();

  const now = Date.now();
  const assignAgeHours = a => {
    const t = a.publishedAt ? new Date(a.publishedAt).getTime() : now;
    return Number.isFinite(t) ? Math.max(0, (now - t) / 3600000) : 24;
  };

  // Count sentiment per ticker (weighted toward fresh news)
  const tickerSentiment = {};
  for (const article of allNews) {
    const stocks = article.relatedStocks || [];
    const isNseContext = article.category === 'nse';
    for (const ticker of stocks) {
      if (!ticker || ticker.length < 2 || ticker.length > 6) continue;
      // Skip global articles that tag a ticker which exists in NSE DB
      // (e.g. Benzinga tags US Hasbro as HAS, which also exists as Kenyan Housing Finance)
      if (!isNseContext && nseTickers.has(ticker.toUpperCase())) continue;
      if (!tickerSentiment[ticker]) {
        tickerSentiment[ticker] = { positive: 0, negative: 0, neutral: 0, articles: [], total: 0, recencySum: 0, hot: 0, urgent: 0 };
      }
      const sent = article.sentiment || 'neutral';
      const ageHours = assignAgeHours(article);
      const recency = Math.max(0, 1 - ageHours / 72); // 72h; fresh news outranks the tail
      tickerSentiment[ticker][sent]++;
      tickerSentiment[ticker].total++;
      tickerSentiment[ticker].recencySum += recency;
      if (article.hot) tickerSentiment[ticker].hot++;
      if (article.catalystStrength === 'high') tickerSentiment[ticker].urgent++;
      if (tickerSentiment[ticker].articles.length < 6) {
        tickerSentiment[ticker].articles.push({
          headline: article.headline || article.title || '',
          source: article.source || article.sourceName || '',
          sentiment: sent,
          excerpt: article.excerpt || '',
          url: article.url || '',
        });
      }
    }
  }

  // Diversity context for ranking: recently-featured map, sector map, and
  // high-conviction live-engine signals (actionable-name boost).
  const [recentFeatured, latestDraftSet, sectorMap, signalBoostMap] = await Promise.all([
    getRecentFeaturedTickers(),
    getLatestDraftTickerSet(),
    loadSectorMap(),
    loadSignalBoostMap(),
  ]);

  // Composite score: recency-weighted news volume + polarity draw + hot/urgent
  // boosts + a live-engine conviction boost, plus a tiny random nudge so ties
  // don't always resolve in cache/alphabetical order.
  const scored = [];
  for (const [ticker, data] of Object.entries(tickerSentiment)) {
    if (!ticker || ticker.length < 2 || ticker.length > 6) continue;
    // The exchange itself ("NSE") shows up as an all-caps word in headlines but
    // is not a pickable stock.
    if (ticker.toUpperCase() === 'NSE') continue;
    // Global tags can come from a coincidental symbol word-match, so require
    // >= 2 independent articles. NSE tags are minted from distinctive company
    // names ("Safaricom", "KCB Group") which never collide, so one solid
    // Kenyan story is enough — otherwise quiet days leave the NSE side empty.
    if (!nseTickers.has(ticker.toUpperCase()) && data.total < MIN_TAGGED_ARTICLES) continue;
    const polarity = Math.abs(data.positive - data.negative);
    const mentions = data.total;
    const recency = mentions ? data.recencySum / mentions : 0;
    const freshVolume = mentions * (0.4 + recency * 0.6); // stale mentions count ~40%
    const signalBoost = signalBoostMap[ticker.toUpperCase()] || 0;
    const score = freshVolume * 2 + polarity * 3 + data.hot * 3 + data.urgent * 4 + signalBoost + (Math.random() * 0.001);
    const sentiment = data.positive > data.negative ? 'positive'
      : data.negative > data.positive ? 'negative' : 'neutral';
    const market = await getMarketLabel(ticker);
    scored.push({
      ticker, score, sentiment, articles: data.articles, total: mentions, market,
      sector: sectorMap[ticker.toUpperCase()] || 'Other',
      repeatCount: recentFeatured[ticker.toUpperCase()] || 0,
      signalBoost,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Rotation: shortlist only non-repeats. In force-fresh mode global repeaters
  // are hard-blocked, but if the only Kenyan names with real news are recent
  // features, allow ONE repeat so the draft never degenerates into an
  // all-foreign issue (MAX_REPEATS_PER_DRAFT still caps total repeats at 1).
  const eligible = forceFresh
    ? scored.filter(s => (s.market === 'NSE' && s.repeatCount <= 1) || (s.market !== 'NSE' && s.repeatCount <= 0))
    : scored.filter(s => s.repeatCount <= 0 || s.score >= HARD_REPEAT_OVERRIDE_SCORE);
  // Force-fresh generally avoids repeaters, but NSE repeats may fill a couple
  // of seats so a quiet week still yields a local, market-balanced issue.
  const forSelection = forceFresh ? eligible : (eligible.length >= 4 ? eligible : scored);

  // Sequential selection: market-balanced (2 NSE + 2 global), sector-aware,
  // and capped so at most MAX_REPEATS_PER_DRAFT featured names make the issue.
  let picked = [];
  const marketCount = { NSE: 0, Global: 0 };
  const marketSectors = { NSE: new Set(), Global: new Set() };
  let repeatsUsed = 0;

  const tryAdd = s => {
    if (picked.length >= 4) return false;
    if (marketCount[s.market] >= SECTOR_VARIETY_COUNT) return false;
    if (s.repeatCount > 0 && repeatsUsed >= MAX_REPEATS_PER_DRAFT) return false;
    if (s.sector !== 'Other' && marketSectors[s.market].has(s.sector)) return false;
    picked.push(s);
    marketCount[s.market]++;
    marketSectors[s.market].add(s.sector);
    if (s.repeatCount > 0) repeatsUsed++;
    return true;
  };

  for (const s of forSelection) {
    if (picked.length >= 4) break;
    tryAdd(s);
  }

  // If a market is still under quota while the other is over, swap in a name
  // from the under-filled market (keeps the draft balanced NSE/global).
  const otherMarket = m => (m === 'NSE' ? 'Global' : 'NSE');
  for (const m of ['NSE', 'Global']) {
    while (marketCount[m] < SECTOR_VARIETY_COUNT && marketCount[otherMarket(m)] > SECTOR_VARIETY_COUNT && picked.length >= 4) {
      let idx = -1;
      for (let i = picked.length - 1; i >= 0; i--) { if (picked[i].market === otherMarket(m)) { idx = i; break; } }
      const sub = forSelection.find(s => s.market === m && !picked.find(p => p.ticker === s.ticker));
      if (idx < 0 || !sub) break;
      const removed = picked[idx];
      picked[idx] = sub;
      marketCount[otherMarket(m)]--;
      marketCount[m]++;
      marketSectors[m].add(sub.sector);
      if (removed.repeatCount > 0) repeatsUsed--;
      if (sub.repeatCount > 0) repeatsUsed++;
    }
  }

  // Fill any remaining slots if one market was genuinely short of candidates.
  if (picked.length < 4) {
    for (const s of forSelection) {
      if (picked.length >= 4) break;
      if (picked.find(p => p.ticker === s.ticker)) continue;
      picked.push(s);
      marketCount[s.market]++;
      if (s.repeatCount > 0) repeatsUsed++;
    }
  }
  // Last-resort cross-market fill.
  if (picked.length < 3) {
    const extra = forSelection.filter(s => !picked.find(p => p.ticker === s.ticker)).slice(0, 3 - picked.length);
    picked.push(...extra);
  }
  picked = picked.slice(0, 4);

  // No-boring-repeat guard: if the picked set is identical to the latest
  // draft, walk further down the ranked list for a ticker not in that draft.
  if (!latestDraftSet.size || picked.length < 4) {
    // nothing to compare against or too few candidates
  } else {
    let attempt = 0;
    while (picked.every(p => latestDraftSet.has(p.ticker.toUpperCase())) && attempt < MAX_DEDUPE_ATTEMPTS) {
      const substitute = forSelection.find(s => !picked.find(p => p.ticker === s.ticker) && !latestDraftSet.has(s.ticker.toUpperCase()));
      if (!substitute) break;
      picked[picked.length - 1] = substitute; // swap out the lowest-ranked pick
      attempt++;
    }
  }

  logPickDecision([
    `mode=${forceFresh ? 'force-fresh' : 'daily'}`,
    `candidates=${scored.length}`,
    `eligible=${eligible.length}`,
    `repeats=${scored.filter(s => s.repeatCount > 0).length}`,
    `repeats-used=${repeatsUsed}`,
    `signal-backed=${picked.filter(s => s.signalBoost > 0).map(s => s.ticker).join(',') || 'none'}`,
    `picked=${picked.map(s => `${s.ticker}(${s.market})`).join(', ')}`,
  ]);

  return picked.slice(0, 4);
}

// ── Build market overview ────────────────────────────────────────
async function buildMarketOverview() {
  const [movers, indices, activeCount] = await Promise.all([
    fetchJson(`${BASE}/api/market/movers`, { nse: { gainers: [], losers: [] }, global: { gainers: [], losers: [] } }),
    fetchJson(`${BASE}/api/indices/all`, {}),
    pool.query(`SELECT COUNT(*) FROM (SELECT DISTINCT ON (ticker) ticker FROM signal_history ORDER BY ticker, generated_at DESC) t`).then(r => parseInt(r.rows[0].count) || 0).catch(() => 0),
  ]);

  const indicesArr = indices && typeof indices === 'object' && !Array.isArray(indices)
    ? Object.values(indices) : (Array.isArray(indices) ? indices : []);

  const nse20 = indicesArr.find(i => i.symbol?.includes('NSE20'));
  const nasi = indicesArr.find(i => i.symbol?.includes('NSEASI'));
  const sp500 = indicesArr.find(i => i.symbol?.includes('GSPC'));
  const nasdaq = indicesArr.find(i => i.symbol?.includes('IXIC'));
  const dow = indicesArr.find(i => i.symbol?.includes('DJI'));

  const nseGainers = (movers?.nse?.gainers || []).slice(0, 3).map(g => ({
    ticker: g.symbol || g.ticker,
    name: g.name || g.symbol || g.ticker,
    change: g.changePercent || g.change || g.pct_change || '0',
    price: g.price || g.regularMarketPrice || null,
  }));

  const nseLosers = (movers?.nse?.losers || []).slice(0, 3).map(l => ({
    ticker: l.symbol || l.ticker,
    name: l.name || l.symbol || l.ticker,
    change: l.changePercent || l.change || l.pct_change || '0',
    price: l.price || l.regularMarketPrice || null,
  }));

  const globalGainers = (movers?.global?.gainers || []).slice(0, 3).map(g => ({
    ticker: g.symbol || g.ticker,
    name: g.name || g.symbol || g.ticker,
    change: g.changePercent || g.change || g.pct_change || '0',
    price: g.price || g.regularMarketPrice || null,
  }));

  const globalLosers = (movers?.global?.losers || []).slice(0, 3).map(l => ({
    ticker: l.symbol || l.ticker,
    name: l.name || l.symbol || l.ticker,
    change: l.changePercent || l.change || l.pct_change || '0',
    price: l.price || l.regularMarketPrice || null,
  }));

  return {
    nse: {
      nse20: nse20 ? { value: nse20.value, change: nse20.change, changeRaw: nse20.changeRaw } : null,
      nasi: nasi ? { value: nasi.value, change: nasi.change, changeRaw: nasi.changeRaw } : null,
      topGainer: nseGainers[0] || null,
      topLoser: nseLosers[0] || null,
      gainers: nseGainers,
      losers: nseLosers,
    },
    us: {
      sp500: sp500 ? { value: sp500.value, change: sp500.change, changeRaw: sp500.changeRaw } : null,
      nasdaq: nasdaq ? { value: nasdaq.value, change: nasdaq.change, changeRaw: nasdaq.changeRaw } : null,
      dow: dow ? { value: dow.value, change: dow.change, changeRaw: dow.changeRaw } : null,
      gainers: globalGainers,
      losers: globalLosers,
    },
    sentiment: 'Neutral',
    totalSignals: activeCount,
  };
}

// ── Build week-ahead events ──────────────────────────────────────
async function buildWeekAhead() {
  const events = [];

  // NSE corporate actions
  try {
    const corpActions = await pool.query(
      `SELECT ticker, action_type, title, event_date, status FROM nse_corporate_actions
       WHERE event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + INTERVAL '7 days'
       ORDER BY event_date LIMIT 5`
    );
    for (const row of corpActions.rows) {
      events.push({
        date: row.event_date ? new Date(row.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBA',
        event: `${row.ticker} — ${row.title}`,
        impact: 'MEDIUM',
        market: 'NSE',
      });
    }
  } catch {}

  // Upcoming earnings
  try {
    const fromDate = new Date().toISOString().slice(0, 10);
    const toDate = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
    const earningsRes = await fetchJson(`${BASE}/api/earnings/upcoming?from=${fromDate}&to=${toDate}&limit=10`, null);
    const list = earningsRes && Array.isArray(earningsRes.earnings) ? earningsRes.earnings : [];
    for (const e of list.slice(0, 6)) {
      const market = (e.market || '').toLowerCase() === 'nse' ? 'NSE' : 'Global';
      const event = e.eventType === 'filings' ? 'Filings' : e.eventType ? e.eventType : 'Earnings Report';
      events.push({
        date: e.dateStr || (e.date ? new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBA'),
        event: `${e.ticker || e.name || ''} — ${event}`,
        impact: 'HIGH',
        market,
      });
    }
  } catch {}

  return events.slice(0, 6);
}

// ── Generate unique narrative thesis for each stock ─────────────
// Phrases rotate so fallback never repeats across stocks in the same newsletter
const FALLBACK_THESES_POSITIVE = [
  (n) => `The bullish case for ${n} is stronger than the headline suggests`,
  (n) => `${n} is building momentum that most traders haven't noticed yet`,
  (n) => `Why ${n}'s recent move is the start of something bigger`,
  (n) => `${n} just gave patient investors a reason to stay long`,
  (n) => `The setup in ${n} is more compelling than the consensus view`,
];
const FALLBACK_THESES_NEGATIVE = [
  (n) => `${n}'s pullback is creating an entry point most investors are missing`,
  (n) => `The bearish case for ${n} is overdone — here's why`,
  (n) => `${n} is pricing in bad news that may never arrive`,
  (n) => `Why the sell-off in ${n} looks like an overreaction`,
  (n) => `${n} is wounded but not broken — the recovery play is forming`,
];
const FALLBACK_THESES_NEUTRAL = [
  (n) => `${n} is at an inflection point — here's what the market is getting wrong`,
  (n) => `The tug-of-war in ${n} is about to resolve — one way or the other`,
  (n) => `${n} is quietly setting up for a bigger move than the chart shows`,
  (n) => `Don't sleep on ${n} — the catalyst is closer than it appears`,
  (n) => `${n}'s consolidation is masking a shift in the underlying thesis`,
];
let _thesisIdx = 0;
function pickFallbackThesis(name, sentiment) {
  const pool = sentiment === 'positive' ? FALLBACK_THESES_POSITIVE
    : sentiment === 'negative' ? FALLBACK_THESES_NEGATIVE
    : FALLBACK_THESES_NEUTRAL;
  const fn = pool[_thesisIdx % pool.length];
  _thesisIdx++;
  return fn(name);
}
async function generateNarrativeThesis(ticker, sentiment, articles, priceData, market) {
  const name = getCompanyName(ticker) || ticker;
  const isGlobal = market === 'Global';

  const articleList = articles.slice(0, 4).map((a, i) =>
    `${i + 1}. "${a.headline}" (${a.source || 'Unknown'}, sentiment: ${a.sentiment})${a.excerpt ? '\n   Excerpt: ' + a.excerpt.slice(0, 200) : ''}`
  ).join('\n');

  const priceContext = priceData
    ? `Current price: ${priceData.price || 'N/A'}, daily change: ${priceData.change || 'N/A'} (${priceData.changePercent || 'N/A'}), volume: ${priceData.volume ? Number(priceData.volume).toLocaleString() : 'N/A'}`
    : 'Live price data not available at time of generation.';

  const marketContext = isGlobal
    ? `This is a US/global stock. Consider broader market context, sector rotation, Fed policy, and global macro trends.`
    : `This is a Nairobi Securities Exchange (NSE) stock. Consider local market dynamics, Kenyan macro context, NSE index performance, and sector-specific factors.`;

  const prompt = `You are a senior equity research analyst writing a daily market briefing for investors. Write a rich, data-driven editorial analysis for ${name} (${ticker}) — ${isGlobal ? 'Global/US market' : 'Nairobi Securities Exchange (NSE), Kenya'}.

RECENT NEWS COVERAGE:
${articleList || 'No recent articles.'}

MARKET DATA:
${priceContext}

CONTEXT:
${marketContext}

WRITE FOUR LABELED SECTIONS — copy the exact labels below:

THESIS: <one compelling one-line hook, max 20 words. A contrarian or insight-driven statement. Examples:
   - "Why Marathon Digital isn't a crypto proxy, but an energy arbitrage play"
   - "The shipping bottleneck nobody is pricing in"
   - "Nigeria's banking sector just got a second wind — this stock leads the charge">

ANALYSIS: <2-3 paragraphs, 150-220 words total. A flowing editorial analysis. Do NOT use numbered sections, headers, or bullet points. Write like a human analyst who has a clear opinion. Structure it as:
   - Opening: What happened and why it matters (reference specific headlines, numbers, dates)
   - Body: Where this could go, what to watch, how it connects to broader themes
   - Close: what would invalidate the thesis>

CATALYST: <one line, max 15 words. The single most concrete near-term catalyst to watch that would move this stock>

RISK: <one line, max 15 words. The single biggest risk / what would break the thesis>

RULES:
- Write in clear, plain English a smart non-specialist can follow; explain any jargon in a few words
- Be specific with numbers, not vague; lead with the most important fact
- Sound like a senior analyst with a clear point of view
- Do NOT use markdown formatting, bullet points, or section headers
- Do NOT mention AI or that this is auto-generated
- Do NOT use generic phrases like "drawing investor attention" or "is among the stories"
- Do NOT start sentences with "The stock" — vary sentence structure
- Each sentence should convey new information
- Write with conviction — take a stance`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 700, temperature: 0.8 });

    const getSection = (label) => {
      // The LLM sometimes wraps labels in markdown (e.g. "**THESIS:**", "THESIS :",
      // "- THESIS:"), so tolerate optional markers/whitespace around the label.
      const re = new RegExp(
        `[\\*\\s\\-]*${label}[\\*]*\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*[\\*\\s\\-]*(?:THESIS|ANALYSIS|CATALYST|RISK)[\\*]*\\s*:|$)`,
        'i'
      );
      const m = text.match(re);
      return m ? m[1].trim() : '';
    };

    let thesis = getSection('THESIS');
    let analysis = getSection('ANALYSIS');
    let catalyst = getSection('CATALYST');
    let risk = getSection('RISK');
    const clean = (s) => (s || '').replace(/\*\*/g, '').replace(/^[\s\-*]+|[\s\-*]+$/g, '').trim();
    thesis = clean(thesis);
    analysis = clean(analysis);
    catalyst = clean(catalyst);
    risk = clean(risk);

    // Fall back to the legacy one-line thesis split when labels are missing
    if (!thesis && !analysis) {
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        thesis = lines[0].replace(/^["']|["']$/g, '').trim();
        analysis = lines.slice(1).join('\n\n').trim();
      } else {
        const firstPeriod = text.indexOf('. ');
        if (firstPeriod > 0 && firstPeriod < 80) {
          thesis = text.slice(0, firstPeriod + 1).trim();
          analysis = text.slice(firstPeriod + 2).trim();
        }
      }
    }
    if (!thesis) thesis = pickFallbackThesis(name, sentiment);
    if (!analysis) analysis = text;
    if (!catalyst) catalyst = fallbackCatalystLine(ticker, isGlobal);
    if (!risk) risk = fallbackRiskLine(ticker, isGlobal);

    return { thesis, analysis, catalyst, risk };
  } catch (e) {
    console.warn(`[INSIGHTS] LLM narrative failed for ${ticker}: ${e.message} model=${process.env.MISTRAL_MODEL} body=${JSON.stringify(e.response?.data || '').slice(0,160)}`);
    return generateFallbackNarrative(ticker, sentiment, articles, market, priceData);
  }
}

// Trim a news snippet to a clean sentence/word boundary so it never cuts mid-word
// ("…before selli."). An ellipsis is added only when text was actually truncated.
function cleanSnippet(text, maxLen = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s.replace(/[.,;:\s]+$/, '');
  const cut = s.slice(0, maxLen);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > maxLen * 0.5) return cut.slice(0, end + 1).trim();
  const sp = cut.lastIndexOf(' ');
  return ((sp > 0 ? cut.slice(0, sp) : cut).replace(/[.,;:\s]+$/, '')) + '…';
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// Sector-aware risk lines so every name in a newsletter doesn't repeat the same
// generic sentence.
function fallbackRiskLine(ticker, isGlobal) {
  const t = String(ticker || '').toUpperCase();
  const NSE_RISKS = {
    SCOM: 'M-Pesa regulation, mobile-data pricing and competitive pressure',
    EABL: 'excise-duty changes, input-cost inflation and consumer demand',
    NMG: 'advertising spend, print decline and digital-transition execution',
    SGL: 'advertising spend and the pace of the print-to-digital shift',
    BAMB: 'construction demand, energy costs and cement pricing',
    PORT: 'construction demand, energy costs and cement pricing',
    KPLC: 'fuel prices, tariff reviews and regulatory decisions',
    KEGN: 'hydrology, power-purchase agreements and tariff reviews',
    TOTL: 'fuel prices, demand and petroleum-sector regulation',
    EQTY: 'credit growth, CBK policy and loan-loss trends',
    KCB: 'credit growth, CBK policy and loan-loss trends',
    COOP: 'credit growth, CBK policy and loan-loss trends',
    ABSA: 'credit growth, CBK policy and loan-loss trends',
    NCBA: 'credit growth, CBK policy and loan-loss trends',
    SBIC: 'credit growth, CBK policy and loan-loss trends',
    SCBK: 'credit growth, CBK policy and loan-loss trends',
    DTK: 'credit growth, CBK policy and loan-loss trends',
    HFCK: 'credit growth, CBK policy and loan-loss trends',
    BAT: 'excise duty, illicit-trade volumes and consumer demand',
    JUB: 'claims inflation and investment returns',
    BRIT: 'claims inflation and investment returns',
  };
  if (!isGlobal && NSE_RISKS[t]) return NSE_RISKS[t];
  return isGlobal
    ? 'rate expectations, sector rotation and earnings revisions'
    : 'Kenyan macro conditions, CBK policy and NSE liquidity';
}

// Near-term catalyst, varied by market/sector rather than one repeated line.
function fallbackCatalystLine(ticker, isGlobal) {
  const t = String(ticker || '').toUpperCase();
  if (!isGlobal) {
    if (['EQTY', 'KCB', 'COOP', 'ABSA', 'NCBA', 'SBIC', 'SCBK', 'DTK', 'HFCK', 'BKG', 'IMH'].includes(t)) return 'the next CBK rate decision and Q3 earnings';
    if (t === 'SCOM') return 'M-Pesa monetisation updates and the next results';
    if (t === 'EABL') return 'volume trends in the next trading update';
    if (['BAMB', 'PORT'].includes(t)) return 'construction-demand data and the next results';
    if (['NMG', 'SGL'].includes(t)) return 'digital-subscription growth in the next update';
    return 'the next corporate announcement or NSE trading update';
  }
  return 'the next earnings report and US macro data';
}

function generateFallbackNarrative(ticker, sentiment, articles, market, priceData) {
  const name = getCompanyName(ticker) || ticker;
  const isGlobal = market === 'Global';
  const heads = articles.filter(a => a.headline).map(a => a.headline);
  const primary = heads[0] || '';
  const secondary = heads[1] || '';
  // Ignore placeholder "excerpts" (RSS items whose body is just a link-out).
  const rawExcerpt = String(articles[0]?.excerpt || '');
  const isPlaceholder = /read the full story|read more|click here|continue reading|subscribe/i.test(rawExcerpt) && rawExcerpt.length < 90;
  const detail = isPlaceholder ? '' : cleanSnippet(rawExcerpt, 170);

  const thesis = pickFallbackThesis(name, sentiment);

  const px = priceData && priceData.price != null ? priceData.price : null;
  const pct = priceData && priceData.changePercent != null ? String(priceData.changePercent) : null;
  const vol = priceData && priceData.volume ? Number(priceData.volume).toLocaleString() : null;

  // 1) What happened — plain, factual.
  const opening = primary
    ? `${name} (${ticker}) is in focus after "${cleanSnippet(primary, 120)}".`
    : `${name} (${ticker}) is in focus today.`;

  // 2) The concrete detail behind the headline.
  const detailSentence = detail ? `The substance: ${detail}.` : '';

  // 3) A second thread, if there is one.
  const secondarySentence = secondary ? `A second thread worth noting: "${cleanSnippet(secondary, 110)}".` : '';

  // 4) The market's read, using the live move and volume.
  let marketRead;
  if (px != null) {
    const reaction = sentiment === 'positive'
      ? 'the market has not fully priced the news in yet'
      : sentiment === 'negative'
      ? 'the market is still absorbing it'
      : 'the market is waiting for confirmation';
    marketRead = `The shares are at ${px}${pct ? ` (${pct} on the day)` : ''}${vol ? `, on volume of ${vol}` : ''}, so ${reaction}.`;
  } else {
    marketRead = sentiment === 'positive'
      ? 'The news is constructive, but it only becomes convincing on follow-through volume.'
      : sentiment === 'negative'
      ? 'The news weighs on sentiment; the next session will show whether sellers follow through.'
      : 'The market is waiting for a clearer signal before committing either way.';
  }

  // 5) What to watch.
  const outlook = sentiment === 'positive'
    ? 'Watch for a close above recent highs on rising volume — that would confirm the bullish read.'
    : sentiment === 'negative'
    ? 'Watch whether the recent support holds; a decisive break below would open the next leg lower.'
    : 'Watch the next company update or macro print — it should break the current range.';

  // 6) A specific, sector-aware risk.
  const riskText = `Key risk: ${fallbackRiskLine(ticker, isGlobal)}.`;

  const analysis = [opening, detailSentence, secondarySentence, marketRead, outlook, riskText].filter(Boolean).join(' ');

  return {
    thesis,
    analysis,
    catalyst: fallbackCatalystLine(ticker, isGlobal),
    risk: fallbackRiskLine(ticker, isGlobal),
  };
}

// ── Generate thematic intro for the newsletter ───────────────────
// Templated (no-LLM) intro + editor's note. The daily flow uses these so the
// limited LLM quota is spent on the per-stock narratives and the big story,
// where it adds the most value, instead of on these short preambles.
function buildThematicIntro(stocks, marketOverview) {
  const tickerList = stocks.map(s => `${getCompanyName(s.ticker) || s.ticker} (${s.ticker})`).join(', ');
  const sentiment = marketOverview.sentiment || 'Neutral';
  if (sentiment === 'Bullish') {
    return `Risk appetite is improving today, so we're looking past the headline indices to the names actually moving: ${tickerList}. Below is what's driving each one.`;
  } else if (sentiment === 'Bearish') {
    return `Sellers are in control today. ${tickerList} are each under pressure — below is what is behind the move and what to watch next.`;
  }
  return `Markets are giving mixed signals today, so it helps to get specific. Today's focus: ${tickerList} — each with its own story worth understanding.`;
}

function buildEditorsNote(stocks, marketOverview) {
  const sentiment = marketOverview.sentiment || 'Neutral';
  const mood = String(sentiment).toLowerCase();
  const moodDesc = mood.includes('bull') ? `risk appetite is building`
    : mood.includes('bear') ? 'risk appetite is waning'
    : 'investors are waiting for direction';
  const tickers = stocks.slice(0, 3).map(s => s.ticker).join(', ');
  return `Before we dive in: ${moodDesc}, so today we're focusing on ${tickers} — the names with the clearest story to tell.`;
}

// Optional LLM versions (kept for explicit callers); they fall back to the
// templated builders above on any error.
async function generateThematicIntro(stocks, marketOverview) {
  const tickerList = stocks.map(s => `${getCompanyName(s.ticker) || s.ticker} (${s.ticker})`).join(', ');
  const sentiment = marketOverview.sentiment || 'Neutral';
  const nseCount = stocks.filter(s => s.market === 'NSE').length;
  const globalCount = stocks.filter(s => s.market === 'Global').length;
  const marketMood = sentiment === 'Bullish' ? 'risk-on' : sentiment === 'Bearish' ? 'risk-off' : 'cautious';
  const prompt = `Write a short editorial intro (2-3 sentences, max 60 words) for a daily stock insights newsletter. The newsletter covers these stocks today: ${tickerList}. Market mood is ${marketMood}. There are ${nseCount} Kenyan (NSE) stocks and ${globalCount} US/global stocks.\n\nWrite like a seasoned market commentator — not a bot. Set up why these stocks matter today. Be specific, not generic. Do NOT use markdown, bullets, or headers.`;
  try {
    const text = await llm.generate(prompt, { maxTokens: 120, temperature: 0.8 });
    return text.trim();
  } catch {
    return buildThematicIntro(stocks, marketOverview);
  }
}

// ── Generate a short editor's preamble note ──
async function generateEditorsNote(stocks, marketOverview) {
  const tickers = stocks.slice(0, 3).map(s => s.ticker).join(', ');
  const prompt = `Write a one-sentence editor's preamble note for a daily stock newsletter. It should feel like a human editor setting the agenda for the day, not a market recap. Mention that the markets above give the context, and that ${tickers} is the focus today. Max 25 words, no markdown, no bullets.`;
  try {
    const text = await llm.generate(prompt, { maxTokens: 80, temperature: 0.8 });
    return text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return buildEditorsNote(stocks, marketOverview);
  }
}

// ── Generate the featured "Big Story" editorial deep-dive ─────────
async function generateBigStory(stocks, marketOverview) {
  if (!stocks.length) return null;
  const names = stocks.slice(0, 4).map(s => `${getCompanyName(s.ticker) || s.ticker} (${s.ticker})`).join(', ');
  const bulls = stocks.filter(s => s.sentiment === 'positive').map(s => s.ticker);
  const bears = stocks.filter(s => s.sentiment === 'negative').map(s => s.ticker);
  const nseCount = stocks.filter(s => s.market === 'NSE').length;
  const globalCount = stocks.filter(s => s.market === 'Global').length;
  const sentiment = marketOverview.sentiment || 'Neutral';

  const prompt = `You are the lead editor at an African-focused stock newsletter. Write a rich, original flagship editorial for today (roughly 130-180 words) that reads like a premium market commentary — the kind of piece a reader prints out.

SETUP:
- Today's focus names: ${names}
- Split: ${nseCount} NSE (Kenya) / ${globalCount} global
- Bullish tickers: ${bulls.join(', ') || 'none'} / Bearish tickers: ${bears.join(', ') || 'none'}
- Overall market mood: ${sentiment}

REQUIREMENTS:
1. Pick ONE honest, specific thesis that ties the day's names together (a real market idea, not a list).
2. Give it a short headline (max 9 words).
3. Make a concrete argument with numbers or referenced events where possible.
4. End with a clear "what to watch" line.
5. Do NOT use markdown, headers, bullets, or numbered lists. Plain flowing paragraphs (2-3).
6. Do NOT mention AI or automation. Write as the StocksIntels editorial team.
7. Never use generic filler like "drawing investor attention".

Return ONLY the story, formatted as:
TITLE: <headline>
BODY: <2-3 paragraphs>`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 500, temperature: 0.85 });
    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    const bodyMatch = text.match(/BODY:\s*([\s\S]+)/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const body = bodyMatch ? bodyMatch[1].trim() : text.replace(/^TITLE:\s*.+\n?/i, '').trim();
    if (!title || !body) return null;
    return { title, body };
  } catch {
    return null;
  }
}

// ── Generate "The Bottom Line" takeaways ──────────────────────────
async function generateBottomLine(stocks) {
  if (!stocks.length) return [];
  const lines = stocks.slice(0, 4).map((s, i) => {
    const name = getCompanyName(s.ticker) || s.ticker;
    return `${i + 1}. ${name} (${s.ticker})`;
  });
  const prompt = `Below is the day's focus list for a stock newsletter. Write exactly 3 crisp "bottom line" takeaways (max 18 words each, plain text, one per line, no numbers, no markdown). Each must be a specific, actionable insight that combines the names with today's market backdrop — NOT a generic platitude and NOT a per-stock recap.

Focus list:
${lines.join('\n')}

Sentiment mix: ${stocks.map(s => `${s.ticker}=${s.sentiment}`).join(', ')}`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 200, temperature: 0.7 });
    const items = text.split('\n').map(l => l.trim()).filter(l => l && !/^\d+\./.test(l)).slice(0, 3);
    if (items.length >= 1) return items;
  } catch {}
  // Fallback: derive a takeaway per sentiment grouping
  const bullCount = stocks.filter(s => s.sentiment === 'positive').length;
  const bearCount = stocks.filter(s => s.sentiment === 'negative').length;
  const fallback = [];
  if (bullCount >= 2) fallback.push('Breadth skews bullish today — the highest-conviction long setups are worth the most attention.');
  else if (bearCount >= 2) fallback.push('Defensive posture is warranted — the focus names carry more downside skew than usual.');
  else fallback.push('Today is a selectivity market — the edge is in the catalysts, not the index trend.');
  if (stocks.length >= 2) fallback.push('Position sizing should reflect that the top ideas are only as good as the volume behind them.');
  fallback.push('Watch the week-ahead calendar — the next macro print is the cleanest risk catalyst.');
  return fallback.slice(0, 3);
}

// ── Generate the closing "Your Take" engagement prompt ────────────
async function generateYourTake(stocks) {
  const tickers = stocks.slice(0, 3).map(s => s.ticker).join(', ');
  const prompt = `Write ONE short reader-engagement question (max 25 words, no markdown) for the end of a stock newsletter whose focus today was: ${tickers}. It should invite readers to share their own take in the replies — opinionated, specific, and about a real decision, not a poll cliché. Examples of tone: "Are these names cheap enough to add, or is the market wrong?"`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 60, temperature: 0.8 });
    const q = text.trim().replace(/^["']|["']$/g, '').replace(/[?!]+$/, '');
    return q ? `${q}?` : `Which of today's focus names are you adding to — and which are you waiting on?`;
  } catch {
    return `Which of today's focus names hold up under your own numbers — and which are you waiting on?`;
  }
}

// ── Generate editorial summary ────────────────────────────────────
function generateEditorialSummary(stocks, marketOverview) {
  const nseStocks = stocks.filter(s => s.market === 'NSE');
  const globalStocks = stocks.filter(s => s.market === 'Global');
  const positiveStocks = stocks.filter(s => s.sentiment === 'positive');
  const negativeStocks = stocks.filter(s => s.sentiment === 'negative');
  const tickers = stocks.map(s => s.ticker).join(', ');

  let summary = '';

  // Opening — varied by actual market conditions and stock mix
  if (marketOverview.sentiment === 'Bullish') {
    summary += `Risk-on today. `;
  } else if (marketOverview.sentiment === 'Bearish') {
    summary += `Sellers are in control. `;
  } else if (marketOverview.sentiment === 'Slightly Bullish') {
    summary += `Cautious optimism across the board. `;
  } else if (marketOverview.sentiment === 'Slightly Bearish') {
    summary += `A defensive tone settling in. `;
  } else {
    summary += `Neither side is willing to blink. `;
  }

  // Connect to the specific stocks — not just list tickers
  if (nseStocks.length > 0 && globalStocks.length > 0) {
    const nseT = nseStocks.map(s => getCompanyName(s.ticker) || s.ticker).join(' & ');
    const globT = globalStocks.map(s => getCompanyName(s.ticker) || s.ticker).join(' & ');
    summary += `${nseT} ${nseStocks.length > 1 ? 'lead' : 'leads'} the NSE conversation today, while ${globT} ${globalStocks.length > 1 ? 'carry' : 'carries'} the global narrative. `;
  } else if (nseStocks.length > 0) {
    const names = nseStocks.map(s => getCompanyName(s.ticker) || s.ticker).join(' & ');
    summary += `On the NSE, ${names} ${nseStocks.length > 1 ? 'are' : 'is'} the names that matter today. `;
  } else {
    const names = globalStocks.map(s => getCompanyName(s.ticker) || s.ticker).join(' & ');
    summary += `Globally, ${names} ${globalStocks.length > 1 ? 'are' : 'is'} driving the conversation. `;
  }

  // Take a stance on the overall picture
  if (positiveStocks.length === stocks.length) {
    summary += `All ${stocks.length} names carry bullish signals — rare conviction across the board.`;
  } else if (negativeStocks.length === stocks.length) {
    summary += `All ${stocks.length} names face bearish headwinds — defensive positioning is warranted.`;
  } else if (positiveStocks.length > negativeStocks.length) {
    summary += `Bulls outnumber bears ${positiveStocks.length}-${negativeStocks.length} — the bias leans constructive, but the split means selectivity matters.`;
  } else if (negativeStocks.length > positiveStocks.length) {
    summary += `Bears outnumber bulls ${negativeStocks.length}-${positiveStocks.length} — caution is warranted, though dislocation creates entry points for the patient.`;
  } else {
    summary += `An even split between bulls and bears — conviction is thin, and the next catalyst will tip the balance.`;
  }

  return summary;
}

// ── Main: generate daily newsletter draft ────────────────────────
// Idempotent unless forced: with force=false, an unsent draft already created
// today is returned instead of writing a duplicate newsletter_drafts row.
// With force=true (admin regenerate), a fresh draft is produced — the
// diversity layer already guarantees its picks differ from prior drafts.
async function generateDailyInsights(force = false) {
  console.log('[INSIGHTS] Starting daily stock insights generation...');

  if (!force) {
    const { rows } = await pool.query(
      `SELECT id, draft_date, subject, status, created_at
       FROM newsletter_drafts
       WHERE draft_date = CURRENT_DATE AND status IN ('draft', 'approved')
       ORDER BY id DESC LIMIT 1`
    );
    if (rows.length > 0) {
      console.log(`[INSIGHTS] Draft ${rows[0].id} already exists for today (status=${rows[0].status}), reusing it`);
      return rows[0];
    }
  }

  // 1. Pick hot stocks from NSE + global
  const hotStocks = await pickHotStocks(force);
  if (hotStocks.length === 0) {
    console.log('[INSIGHTS] No hot stocks found, skipping generation');
    return null;
  }
  console.log(`[INSIGHTS] Picked ${hotStocks.length} stocks: ${hotStocks.map(s => `${s.ticker}(${s.market})`).join(', ')}`);

  // 2. Build market overview
  const marketOverview = await buildMarketOverview().catch(() => ({
    nse: { nse20: null, nasi: null, topGainer: null, topLoser: null, gainers: [], losers: [] },
    us: { sp500: null, nasdaq: null, dow: null, gainers: [], losers: [] },
    sentiment: 'Neutral',
    totalSignals: 0,
  }));

  // 3. Fetch price data for hot stocks
  let priceDataMap = {};
  try {
    // Fetch NSE stocks
    const nseStocks = hotStocks.filter(s => s.market === 'NSE');
    if (nseStocks.length > 0) {
      const nseSymbols = nseStocks.map(s => `NSE:${s.ticker}`).join(',');
      const nseQuotes = await fetchJson(`${BASE}/api/quotes?symbols=${nseSymbols}`, []);
      if (Array.isArray(nseQuotes)) {
        for (const q of nseQuotes) {
          if (q && q.symbol) priceDataMap[q.symbol] = q;
        }
      }
    }
    // Fetch global stocks
    const globalStocks = hotStocks.filter(s => s.market === 'Global');
    if (globalStocks.length > 0) {
      const globalSymbols = globalStocks.map(s => s.ticker).join(',');
      const globalQuotes = await fetchJson(`${BASE}/api/quotes?symbols=${globalSymbols}`, []);
      if (Array.isArray(globalQuotes)) {
        for (const q of globalQuotes) {
          if (q && q.symbol) priceDataMap[q.symbol] = q;
        }
      }
    }
  } catch {}

  // 4. Thematic intro is templated (no LLM) so the limited LLM quota is reserved
  // for the per-stock narratives + big story, which carry far more value.
  const thematicIntro = buildThematicIntro(hotStocks, marketOverview);

  const deepDives = [];
  for (const stock of hotStocks) {
    const priceKey = stock.market === 'NSE' ? `NSE:${stock.ticker}` : stock.ticker;
    const priceData = priceDataMap[priceKey] || priceDataMap[stock.ticker] || null;
    const { thesis, analysis, catalyst, risk } = await generateNarrativeThesis(stock.ticker, stock.sentiment, stock.articles, priceData, stock.market)
    .catch(e => { console.warn(`[INSIGHTS] narrative fallback for ${stock.ticker}: ${e.message}`); return generateFallbackNarrative(stock.ticker, stock.sentiment, stock.articles, stock.market, priceData); });

    const companyName = getCompanyName(stock.ticker) || stock.ticker;
    const signal = stock.sentiment === 'positive' ? 'BULLISH'
      : stock.sentiment === 'negative' ? 'BEARISH' : 'NEUTRAL';

    // Pull fundamentals (P/E, dividend yield, market cap, growth) from the live
    // financial-reports cache or curated fallback. Never blocks the draft.
    let fundamentals = null;
    try {
      const f = getFundamentals(stock.ticker);
      fundamentals = {
        peRatio: f.peRatio != null ? Number(f.peRatio) : null,
        pbRatio: f.pbRatio != null ? Number(f.pbRatio) : null,
        dividendYield: f.dividendYield != null ? Number(f.dividendYield) : null,
        marketCap: f.marketCap != null ? Number(f.marketCap) : null,
        epsGrowth: f.epsGrowth != null ? Number(f.epsGrowth) : null,
        revenueGrowth: f.revenueGrowth != null ? Number(f.revenueGrowth) : null,
        sector: f.sector || null,
        dataSource: f.dataSource || null,
      };
    } catch {}

    deepDives.push({
      ticker: stock.ticker,
      companyName,
      exchange: getExchangeDisplay(stock.market),
      headline: stock.articles[0]?.headline || `${companyName} — ${stock.sentiment} sentiment`,
      thesis,
      analysis,
      catalyst,
      risk,
      sentiment: stock.sentiment,
      signal,
      market: stock.market,
      fundamentals,
      priceData: priceData ? {
        price: priceData.price || priceData.regularMarketPrice || null,
        change: priceData.change || priceData.regularMarketChange || null,
        changePercent: priceData.changePercent || priceData.regularMarketChangePercent || null,
        volume: priceData.volume || priceData.regularMarketVolume || null,
        dayHigh: priceData.dayHigh || priceData.regularMarketDayHigh || null,
        dayLow: priceData.dayLow || priceData.regularMarketDayLow || null,
        marketCap: priceData.marketCap || null,
      } : null,
      relatedNews: stock.articles.slice(0, 3),
    });
  }

  // 5. Build week-ahead events
  const weekAhead = await buildWeekAhead().catch(() => []);

  // 6. Editor's note is templated (no LLM), like the thematic intro.
  const editorsNote = buildEditorsNote(hotStocks, marketOverview);

  let bigStory = null;
  try {
    bigStory = await generateBigStory(hotStocks, marketOverview).catch(() => null);
  } catch {}

  let bottomLine = [];
  try {
    bottomLine = await generateBottomLine(hotStocks).catch(() => []);
  } catch {}

  let yourTake = '';
  try {
    yourTake = await generateYourTake(hotStocks).catch(() => '');
  } catch {}

  // 6b. Generate editorial summary
  const summary = generateEditorialSummary(deepDives, marketOverview);

  // 7. Build content object
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const content = {
    dateStr,
    marketOverview,
    editorsNote,
    thematicIntro,
    bigStory,
    stockDeepDives: deepDives,
    weekAhead,
    bottomLine,
    yourTake,
    summary,
  };

  const subject = `Stock Insights: ${deepDives.map(d => d.ticker).join(', ')} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  // 8. Store draft
  const result = await pool.query(
    `INSERT INTO newsletter_drafts (draft_date, subject, content, status)
     VALUES (CURRENT_DATE, $1, $2, 'draft')
     RETURNING id, draft_date, subject, status, created_at`,
    [subject, JSON.stringify(content)]
  );

  const draft = result.rows[0];
  console.log(`[INSIGHTS] Draft ${draft.id} created: ${subject}`);
  return draft;
}

// ── Send approved draft to all opted-in users ────────────────────
async function sendApprovedDraft() {
  const { rows: drafts } = await pool.query(
    `SELECT id, subject, content FROM newsletter_drafts WHERE status = 'approved' ORDER BY draft_date DESC, id DESC LIMIT 1`
  );
  if (drafts.length === 0) {
    console.log('[INSIGHTS] No approved drafts to send');
    return { sent: 0 };
  }

  const draft = drafts[0];
  const content = draft.content;

  const { rows: users } = await pool.query(
    `SELECT id, full_name, email FROM users WHERE stock_insights_opt_in = true AND email IS NOT NULL AND email != ''`
  );
  if (users.length === 0) {
    console.log('[INSIGHTS] No opted-in users');
    return { sent: 0 };
  }

  console.log(`[INSIGHTS] Sending "${draft.subject}" to ${users.length} users...`);

  const { sendStockInsightsEmail } = require('./mailer');
  let sent = 0;
  for (const user of users) {
    try {
      await withTimeout(
        sendStockInsightsEmail(user.email, {
          ...content,
          userName: user.full_name || 'Trader',
        }),
        30000,
        `insights email to ${user.email}`
      );
      sent++;
    } catch (e) {
      console.error(`[INSIGHTS] Failed to send to ${user.email}:`, e.message);
    }
  }

  await pool.query(
    `UPDATE newsletter_drafts SET status = 'sent', sent_at = NOW(), sent_count = $1, updated_at = NOW() WHERE id = $2`,
    [sent, draft.id]
  );

  console.log(`[INSIGHTS] Sent to ${sent}/${users.length} users`);
  return { sent, total: users.length, draftId: draft.id };
}

module.exports = {
  generateDailyInsights,
  sendApprovedDraft,
  pickHotStocks,
  buildMarketOverview,
};
