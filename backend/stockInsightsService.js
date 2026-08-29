// Stock Insights Newsletter Service
// Generates a semi-automated, Hisa-style daily stock insights email.
// Picks top stocks from BOTH NSE and global markets by sentiment swing + price moves,
// generates editorial analysis, and stores a draft in newsletter_drafts for admin review.

const axios = require('axios');
const { pool } = require('./db');
const { getAllNews, getNewsSummary } = require('./newsService');
const { getCompanyName } = require('./marketService');
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
async function pickHotStocks() {
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

  // Rotation: shortlist only non-repeats, unless the repeat cleared the
  // fresh-news bar (its story today is big enough to deserve airtime).
  const eligible = scored.filter(s => s.repeatCount <= 0 || s.score >= HARD_REPEAT_OVERRIDE_SCORE);
  // If diversity would starve the draft, relax back to the full ranked list.
  const forSelection = eligible.length >= 4 ? eligible : scored;

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
    const earningsRes = await fetchJson(`${BASE}/api/earnings/calendar?days=7`, []);
    if (Array.isArray(earningsRes)) {
      for (const e of earningsRes.slice(0, 5)) {
        events.push({
          date: e.date ? new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBA',
          event: `${e.symbol || e.ticker || ''} — Earnings Report`,
          impact: 'HIGH',
          market: 'Global',
        });
      }
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

WRITE TWO THINGS:

1. NARRATIVE THESIS (1 sentence, max 20 words): A compelling one-line hook that tells the reader WHY this stock matters right now. Format it as a contrarian or insight-driven statement. Examples:
   - "Why Marathon Digital isn't a crypto proxy, but an energy arbitrage play"
   - "The shipping bottleneck nobody is pricing in"
   - "Nigeria's banking sector just got a second wind — this stock leads the charge"

2. ANALYSIS (2-3 paragraphs, 150-220 words total): Write a flowing editorial analysis. Do NOT use numbered sections, headers, or bullet points. Write like a human analyst who has a clear opinion. Structure it as:
   - Opening: What happened and why it matters (reference specific headlines, numbers, dates)
   - Body: Where this could go, what to watch, how it connects to broader themes
   - Close: Key risks and what would invalidate the thesis

RULES:
- Be specific with numbers, not vague
- Sound like a senior analyst with a clear point of view
- Do NOT use markdown formatting, bullet points, or section headers
- Do NOT mention AI or that this is auto-generated
- Do NOT use generic phrases like "drawing investor attention" or "is among the stories"
- Do NOT start sentences with "The stock" — vary sentence structure
- Each sentence should convey new information
- Write with conviction — take a stance`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 500, temperature: 0.8 });
    // Parse thesis and analysis from LLM output
    const thesisMatch = text.match(/^([^.\n]+[.\n])/m);
    let thesis = '';
    let analysis = text;
    // Try to split thesis from analysis — thesis is the first line or sentence
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      thesis = lines[0].replace(/^["']|["']$/g, '').trim();
      analysis = lines.slice(1).join('\n\n').trim();
    } else {
      // Fallback: first sentence is thesis, rest is analysis
      const firstPeriod = text.indexOf('. ');
      if (firstPeriod > 0 && firstPeriod < 80) {
        thesis = text.slice(0, firstPeriod + 1).trim();
        analysis = text.slice(firstPeriod + 2).trim();
      }
    }
    return { thesis, analysis };
  } catch {
    return generateFallbackNarrative(ticker, sentiment, articles, market);
  }
}

function generateFallbackNarrative(ticker, sentiment, articles, market) {
  const name = getCompanyName(ticker) || ticker;
  const isGlobal = market === 'Global';
  const headlines = articles.filter(a => a.headline).map(a => a.headline);
  const primary = headlines[0] || '';
  const secondary = headlines[1] || '';
  const excerpt = articles[0]?.excerpt || '';

  // Build a unique thesis
  let thesis = pickFallbackThesis(name, sentiment);

  // Rotate opening patterns so different stocks sound different
  const openings = sentiment === 'positive' ? [
    `${name} (${ticker}) is waking up. "${primary}" is the catalyst, and the market is starting to price it in.`,
    `A shift is underway in ${name} (${ticker}). The lead story — "${primary}" — signals a turning point that the headline alone doesn't capture.`,
    `${name} (${ticker}) just served notice. "${primary}" has given the bulls a concrete reason to step in, and the follow-through is what matters now.`,
    `Don't overlook ${name} (${ticker}). "${primary}" is a bigger deal than the market consensus suggests, and the risk-reward is tilting in favor of the bulls.`,
  ] : sentiment === 'negative' ? [
    `${name} (${ticker}) is under pressure. "${primary}" has rattled confidence, and the selling pressure reflects deeper concerns than the headline suggests.`,
    `The story in ${name} (${ticker}) has shifted. "${primary}" has changed the narrative, and the market is repricing accordingly.`,
    `${name} (${ticker}) is facing headwinds. "${primary}" raises real questions about the near-term outlook, and the bears are making their case.`,
    `Sentiment has turned against ${name} (${ticker}). "${primary}" is driving the selloff, but the question is whether this is an overreaction or a correction to fair value.`,
  ] : [
    `${name} (${ticker}) is stuck in the middle. "${primary}" has the market divided, and until clarity emerges, this one stays range-bound.`,
    `${name} (${ticker}) is at a crossroads. "${primary}" is the kind of event that could tip the balance — the outcome determines the next 20% move.`,
    `Mixed signals in ${name} (${ticker}). "${primary}" has created uncertainty, and the market is waiting for more data before committing.`,
  ];

  const opening = openings[_thesisIdx % openings.length];
  _thesisIdx++;

  // Build the body with specific context
  let body = '';
  if (secondary) {
    body += `Secondary coverage on "${secondary}" adds context to the thesis. `;
  }
  if (excerpt && excerpt.length > 50) {
    // Extract a key detail from the excerpt
    const detail = excerpt.slice(0, 150).replace(/\s+/g, ' ').trim();
    body += `The details: ${detail}. `;
  }

  if (sentiment === 'positive') {
    const bullishPhrases = [
      `Momentum is building, and the risk-reward favors the long side here.`,
      `The setup is constructive — watch for volume confirmation on any push above recent highs.`,
      `The path of least resistance is higher, provided the broader market cooperates.`,
    ];
    body += bullishPhrases[_thesisIdx % bullishPhrases.length] + ' ';
  } else if (sentiment === 'negative') {
    const bearishPhrases = [
      `Support levels are being tested, and a break below would open up more downside.`,
      `The selling pressure suggests positioning ahead of something — watch for follow-through.`,
      `The bearish case is gaining credibility, but oversold conditions could trigger a technical bounce.`,
    ];
    body += bearishPhrases[_thesisIdx % bearishPhrases.length] + ' ';
  } else {
    const neutralPhrases = [
      `The market is waiting for a catalyst — the next earnings report or macro data point could tip the balance.`,
      `Positioning is balanced, and the next directional move will likely come from external catalysts rather than company-specific news.`,
      `The consolidation pattern suggests a bigger move is building — direction depends on how the macro backdrop evolves.`,
    ];
    body += neutralPhrases[_thesisIdx % neutralPhrases.length] + ' ';
  }

  const riskLine = isGlobal
    ? `Key risks: Fed policy shifts, sector rotation, and earnings season volatility.`
    : `Key risks: Kenyan macro factors, CBK policy direction, and NSE liquidity conditions.`;

  const analysis = opening + ' ' + body + riskLine;

  return { thesis, analysis };
}

// ── Generate thematic intro for the newsletter ───────────────────
async function generateThematicIntro(stocks, marketOverview) {
  const tickerList = stocks.map(s => `${getCompanyName(s.ticker) || s.ticker} (${s.ticker})`).join(', ');
  const sentiment = marketOverview.sentiment || 'Neutral';
  const nseCount = stocks.filter(s => s.market === 'NSE').length;
  const globalCount = stocks.filter(s => s.market === 'Global').length;
  const marketMood = sentiment === 'Bullish' ? 'risk-on' : sentiment === 'Bearish' ? 'risk-off' : 'cautious';

  const prompt = `Write a short editorial intro (2-3 sentences, max 60 words) for a daily stock insights newsletter. The newsletter covers these stocks today: ${tickerList}. Market mood is ${marketMood}. There are ${nseCount} Kenyan (NSE) stocks and ${globalCount} US/global stocks.

Write like a seasoned market commentator — not a bot. Set up why these stocks matter today. Be specific, not generic. Do NOT use markdown, bullets, or headers.`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 120, temperature: 0.8 });
    return text.trim();
  } catch {
    // Fallback: contextual intro based on market conditions
    if (sentiment === 'Bullish') {
      return `Markets are in risk-on mode today, and a handful of names are standing out from the noise. ${tickerList} — each carrying a distinct catalyst worth parsing before the next session opens.`;
    } else if (sentiment === 'Bearish') {
      return `Sellers have the upper hand today, but dislocation creates opportunity. ${tickerList} — each facing crosswinds, each worth watching for where the next buyers step in.`;
    } else {
      return `Markets are caught between competing narratives today. ${tickerList} — a mixed basket that tells you more about the current regime than any index reading.`;
    }
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
  const hotStocks = await pickHotStocks();
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
      const nseQuotes = await fetchJson(`${BASE}/api/market/quotes?symbols=${nseSymbols}`, {});
      if (nseQuotes && typeof nseQuotes === 'object') Object.assign(priceDataMap, nseQuotes);
    }
    // Fetch global stocks
    const globalStocks = hotStocks.filter(s => s.market === 'Global');
    if (globalStocks.length > 0) {
      const globalSymbols = globalStocks.map(s => s.ticker).join(',');
      const globalQuotes = await fetchJson(`${BASE}/api/market/quotes?symbols=${globalSymbols}`, {});
      if (globalQuotes && typeof globalQuotes === 'object') Object.assign(priceDataMap, globalQuotes);
    }
  } catch {}

  // 4. Generate thematic intro + rich editorial analysis for each stock
  // Run sequentially to avoid overwhelming the LLM API
  let thematicIntro = '';
  try {
    thematicIntro = await withTimeout(
      generateThematicIntro(hotStocks, marketOverview),
      45000,
      'LLM thematic intro'
    );
  } catch {
    // fallback handled inside generateThematicIntro
    thematicIntro = await generateThematicIntro(hotStocks, marketOverview).catch(() => '');
  }

  const deepDives = [];
  for (const stock of hotStocks) {
    const priceKey = stock.market === 'NSE' ? `NSE:${stock.ticker}` : stock.ticker;
    const priceData = priceDataMap[priceKey] || priceDataMap[stock.ticker] || null;
    const { thesis, analysis } = await withTimeout(
      generateNarrativeThesis(stock.ticker, stock.sentiment, stock.articles, priceData, stock.market),
      45000,
      `LLM analysis for ${stock.ticker}`
    ).catch(() => generateFallbackNarrative(stock.ticker, stock.sentiment, stock.articles, stock.market));

    const companyName = getCompanyName(stock.ticker) || stock.ticker;
    const signal = stock.sentiment === 'positive' ? 'BULLISH'
      : stock.sentiment === 'negative' ? 'BEARISH' : 'NEUTRAL';

    deepDives.push({
      ticker: stock.ticker,
      companyName,
      exchange: getExchangeDisplay(stock.market),
      headline: stock.articles[0]?.headline || `${companyName} — ${stock.sentiment} sentiment`,
      thesis,
      analysis,
      sentiment: stock.sentiment,
      signal,
      market: stock.market,
      priceData: priceData ? {
        price: priceData.price || priceData.regularMarketPrice || null,
        change: priceData.change || priceData.regularMarketChange || null,
        changePercent: priceData.changePercent || priceData.regularMarketChangePercent || null,
        volume: priceData.volume || priceData.regularMarketVolume || null,
      } : null,
      relatedNews: stock.articles.slice(0, 3),
    });
  }

  // 5. Build week-ahead events
  const weekAhead = await buildWeekAhead().catch(() => []);

  // 6. Generate editorial summary
  const summary = generateEditorialSummary(deepDives, marketOverview);

  // 7. Build content object
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const content = {
    dateStr,
    marketOverview,
    thematicIntro,
    stockDeepDives: deepDives,
    weekAhead,
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
