// Stock Insights Newsletter Service
// Generates a semi-automated, Hisa-style daily stock insights email.
// Picks top stocks from BOTH NSE and global markets by sentiment swing + price moves,
// generates editorial analysis, and stores a draft in newsletter_drafts for admin review.

const axios = require('axios');
const { pool } = require('./db');
const { getAllNews, getNewsSummary, getAfricaCompanyName } = require('./newsService');
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
const PICKS_PER_MARKET = 4;             // 4 African + 4 global — broad coverage, not a 3-name sampler
const PICKS_PER_ISSUE = PICKS_PER_MARKET * 2; // 8 deep-dives per issue
const MAX_PER_AFRICAN_EXCHANGE = 2;     // no single African exchange (NSE/NGX/JSE) dominates the African seats
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

// Pan-African editorial feed (MyStocks market-intel) that powers the public
// site's "#insights" section — JSE/NGX/NSE SENS & company reports. Fetched per
// exchange (the feed cache is keyed per exchange) and normalised so it can feed
// both the picker (via `symbols`) and the newsletter's African news section.
async function getAfricaNewsArticles() {
  const fetchList = async (ex) => {
    const res = await fetchJson(`${BASE}/api/market-intel?limit=20${ex ? `&exchange=${ex}` : ''}`, []);
    return Array.isArray(res) ? res : (res?.articles || res?.data || []);
  };
  const [all, ngx, jse] = await Promise.all([
    fetchList(null).catch(() => []),
    fetchList('NGX').catch(() => []),
    fetchList('JSE').catch(() => []),
  ]);
  const seen = new Set();
  const out = [];
  for (const arr of [ngx, jse, all]) {
    for (const a of arr) {
      if (!a) continue;
      const id = a.id || a.slug || a.title;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        title: a.title || '',
        summary: a.summary || '',
        source: a.source || 'MyStocks',
        exchange: String(a.exchange || '').toUpperCase() || null,
        url: a.url || a.sourceUrl || (a.slug ? `https://mystocks.africa/market-intel/${a.slug}` : ''),
        publishedAt: a.publishedAt || a.createdAt || null,
        symbols: Array.isArray(a.symbols) ? a.symbols : [],
      });
    }
  }
  return out;
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

// Exchange groups. "African" spans every African exchange we cover so the
// newsletter balances African vs Global picks (not Kenya vs everywhere else).
const AFRICAN_MARKETS = new Set(['NSE', 'NGX', 'JSE', 'GSE', 'BRVM']);
const isAfricanMarket = (m) => AFRICAN_MARKETS.has(String(m || '').toUpperCase());

function getExchangeDisplay(market) {
  const m = String(market || '').toUpperCase();
  return AFRICAN_MARKETS.has(m) ? m : 'Global';
}

// Human company name for a scored stock: NSE/US canonical names first, then the
// reverse African symbol map (Dangote Cement, MTN Nigeria…), then the raw ticker.
function companyNameFor(stock) {
  const ticker = stock?.ticker || stock?.symbol || '';
  const generic = getCompanyName(ticker);
  if (generic && generic !== ticker) return generic;
  const qualified = stock?.symbol && String(stock.symbol).includes(':')
    ? stock.symbol
    : (stock?.market && isAfricanMarket(stock.market) ? `${stock.market}:${ticker}` : '');
  return (qualified && getAfricaCompanyName(qualified)) || generic || ticker;
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
    for (const rawTicker of stocks) {
      if (!rawTicker) continue;
      const up = String(rawTicker).toUpperCase();
      // Qualified symbols ("NGX:MTNN", "JSE:NPN") carry their exchange; bare
      // symbols are NSE/US and resolved later.
      const hasEx = up.includes(':');
      const market = hasEx ? up.split(':')[0] : null;
      const bare = hasEx ? up.split(':')[1] : up;
      if (bare.length < 2 || bare.length > 12) continue;
      // Skip global articles that tag a ticker which exists in NSE DB
      // (e.g. Benzinga tags US Hasbro as HAS, which also exists as Kenyan Housing Finance)
      if (!isNseContext && !hasEx && nseTickers.has(bare)) continue;
      if (!tickerSentiment[up]) {
        tickerSentiment[up] = { positive: 0, negative: 0, neutral: 0, articles: [], total: 0, recencySum: 0, hot: 0, urgent: 0, market };
      }
      const sent = article.sentiment || 'neutral';
      const ageHours = assignAgeHours(article);
      const recency = Math.max(0, 1 - ageHours / 72); // 72h; fresh news outranks the tail
      tickerSentiment[up][sent]++;
      tickerSentiment[up].total++;
      tickerSentiment[up].recencySum += recency;
      if (article.hot) tickerSentiment[up].hot++;
      if (article.catalystStrength === 'high') tickerSentiment[up].urgent++;
      if (tickerSentiment[up].articles.length < 6) {
        tickerSentiment[up].articles.push({
          headline: article.headline || article.title || '',
          source: article.source || article.sourceName || '',
          sentiment: sent,
          excerpt: article.excerpt || '',
          url: article.url || '',
        });
      }
    }
  }

  // Fold in Pan-African editorial (JSE/NGX/NSE SENS & company reports) so the
  // picker can surface NGX/JSE names the general feed never reaches. Their
  // exchange is authoritative, so record it per ticker.
  const africaMarketByTicker = {};
  try {
    const africaIntel = await getAfricaNewsArticles();
    for (const a of africaIntel) {
      const ex = String(a.exchange || '').toUpperCase();
      if (!AFRICAN_MARKETS.has(ex)) continue;
      const syms = Array.isArray(a.symbols) ? a.symbols : [];
      for (const rawSym of syms) {
        const ticker = String(rawSym || '').toUpperCase().trim().replace(/\.(NG|JO|KE)$/, '');
        if (ticker.length < 2 || ticker.length > 12) continue;
        if (!tickerSentiment[ticker]) {
          tickerSentiment[ticker] = { positive: 0, negative: 0, neutral: 0, articles: [], total: 0, recencySum: 0, hot: 0, urgent: 0 };
        }
        const d = tickerSentiment[ticker];
        d.neutral++;
        d.total++;
        d.recencySum += Math.max(0, 1 - assignAgeHours(a) / 72) * 0.9;
        if (d.articles.length < 6) {
          d.articles.push({
            headline: a.title || '',
            source: a.source || 'MyStocks',
            sentiment: 'neutral',
            excerpt: a.summary || '',
            url: a.sourceUrl || a.url || '',
          });
        }
        africaMarketByTicker[ticker] = ex;
      }
    }
  } catch (e) {
    console.warn('[INSIGHTS/pick] Africa intel fold failed:', e.message);
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
  for (const [symbol, data] of Object.entries(tickerSentiment)) {
    const hasEx = symbol.includes(':');
    const bare = hasEx ? symbol.split(':')[1] : symbol;
    if (!bare || bare.length < 2 || bare.length > 12) continue;
    // The exchange itself ("NSE") shows up as an all-caps word in headlines but
    // is not a pickable stock.
    if (bare === 'NSE') continue;
    const explicitMarket = data.market || africaMarketByTicker[bare];
    const isNse = nseTickers.has(bare);
    // Global tags can come from a coincidental symbol word-match, so require
    // >= 2 independent articles. African tags (NSE/NGX/JSE) are minted from
    // distinctive company names/JSE-NGX SENS records which never collide, so a
    // single solid story is enough — otherwise quiet days leave them empty.
    if (!explicitMarket && !isNse && data.total < MIN_TAGGED_ARTICLES) continue;
    const polarity = Math.abs(data.positive - data.negative);
    const mentions = data.total;
    const recency = mentions ? data.recencySum / mentions : 0;
    const freshVolume = mentions * (0.4 + recency * 0.6); // stale mentions count ~40%
    const signalBoost = signalBoostMap[bare] || 0;
    const score = freshVolume * 2 + polarity * 3 + data.hot * 3 + data.urgent * 4 + signalBoost + (Math.random() * 0.001);
    const sentiment = data.positive > data.negative ? 'positive'
      : data.negative > data.positive ? 'negative' : 'neutral';
    const market = explicitMarket || (isNse ? 'NSE' : 'Global');
    scored.push({
      ticker: bare, symbol, score, sentiment, articles: data.articles, total: mentions, market,
      sector: sectorMap[bare] || 'Other',
      repeatCount: recentFeatured[bare] || 0,
      signalBoost,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Rotation: shortlist only non-repeats. In force-fresh mode global repeaters
  // are hard-blocked, but if the only African names with real news are recent
  // features, allow ONE repeat so the draft never degenerates into an
  // all-foreign issue (MAX_REPEATS_PER_DRAFT still caps total repeats at 1).
  const eligible = forceFresh
    ? scored.filter(s => (isAfricanMarket(s.market) && s.repeatCount <= 1) || (!isAfricanMarket(s.market) && s.repeatCount <= 0))
    : scored.filter(s => s.repeatCount <= 0 || s.score >= HARD_REPEAT_OVERRIDE_SCORE);
  // Force-fresh generally avoids repeaters, but African repeats may fill a
  // couple of seats so a quiet week still yields a market-balanced issue.
  const forSelection = forceFresh ? eligible : (eligible.length >= PICKS_PER_ISSUE ? eligible : scored);

  // Sequential selection: group-balanced (3 African + 3 global), sector-aware,
  // and capped so at most MAX_REPEATS_PER_DRAFT featured names make the issue.
  const groupOf = (m) => (isAfricanMarket(m) ? 'African' : 'Global');
  let picked = [];
  const marketCount = { African: 0, Global: 0 };
  const marketSectors = { African: new Set(), Global: new Set() };
  const africaExCount = {}; // per African exchange so NSE can't take every African seat
  const africaEx = (m) => String(m || '').toUpperCase();
  let repeatsUsed = 0;

  const tryAdd = s => {
    const g = groupOf(s.market);
    if (picked.length >= PICKS_PER_ISSUE) return false;
    if (marketCount[g] >= PICKS_PER_MARKET) return false;
    if (g === 'African' && (africaExCount[africaEx(s.market)] || 0) >= MAX_PER_AFRICAN_EXCHANGE) return false;
    if (s.repeatCount > 0 && repeatsUsed >= MAX_REPEATS_PER_DRAFT) return false;
    if (s.sector !== 'Other' && marketSectors[g].has(s.sector)) return false;
    picked.push(s);
    marketCount[g]++;
    if (g === 'African') africaExCount[africaEx(s.market)] = (africaExCount[africaEx(s.market)] || 0) + 1;
    marketSectors[g].add(s.sector);
    if (s.repeatCount > 0) repeatsUsed++;
    return true;
  };

  for (const s of forSelection) {
    if (picked.length >= PICKS_PER_ISSUE) break;
    tryAdd(s);
  }

  // If a group is still under quota while the other is over, swap in a name
  // from the under-filled group (keeps the draft balanced African/global).
  const otherGroup = g => (g === 'African' ? 'Global' : 'African');
  for (const g of ['African', 'Global']) {
    while (marketCount[g] < PICKS_PER_MARKET && marketCount[otherGroup(g)] > PICKS_PER_MARKET) {
      let idx = -1;
      for (let i = picked.length - 1; i >= 0; i--) { if (groupOf(picked[i].market) === otherGroup(g)) { idx = i; break; } }
      const sub = forSelection.find(s => groupOf(s.market) === g && !picked.find(p => p.ticker === s.ticker));
      if (idx < 0 || !sub) break;
      const removed = picked[idx];
      picked[idx] = sub;
      marketCount[otherGroup(g)]--;
      marketCount[g]++;
      marketSectors[g].add(sub.sector);
      if (removed.repeatCount > 0) repeatsUsed--;
      if (sub.repeatCount > 0) repeatsUsed++;
    }
  }

  // Fill any remaining slots if one group was genuinely short of candidates.
  if (picked.length < PICKS_PER_ISSUE) {
    for (const s of forSelection) {
      if (picked.length >= PICKS_PER_ISSUE) break;
      const g = groupOf(s.market);
      if (marketCount[g] >= PICKS_PER_MARKET) continue;
      if (picked.find(p => p.ticker === s.ticker)) continue;
      picked.push(s);
      marketCount[g]++;
      if (s.repeatCount > 0) repeatsUsed++;
    }
  }
  // Last-resort cross-market fill.
  if (picked.length < 3) {
    const extra = forSelection.filter(s => !picked.find(p => p.ticker === s.ticker)).slice(0, 3 - picked.length);
    picked.push(...extra);
  }

  // Backfill so the issue always spans markets even on thin-news days: pull in
  // top movers (African NSE/NGX/JSE + global) as lightweight picks for any group
  // still under quota, so coverage isn't limited to the few names that happened
  // to carry two tagged articles.
  if (picked.length < PICKS_PER_ISSUE) {
    try {
      const mv = await fetchJson(`${BASE}/api/market/movers`, {});
      const pool = [
        ...(mv?.nse?.gainers || []), ...(mv?.nse?.losers || []),
        ...(mv?.ngx?.gainers || []), ...(mv?.ngx?.losers || []),
        ...(mv?.jse?.gainers || []), ...(mv?.jse?.losers || []),
        ...(mv?.global?.gainers || []), ...(mv?.global?.losers || []),
      ];
      for (const m of pool) {
        if (picked.length >= PICKS_PER_ISSUE) break;
        const ticker = String(m.ticker || m.symbol || '').replace(/^(NSE|NGX|JSE):/i, '').toUpperCase();
        if (!ticker || ticker.length < 2) continue;
        const mk = String(m.market || '').toUpperCase();
        const market = isAfricanMarket(mk) ? mk : 'Global';
        const g = groupOf(market);
        if (marketCount[g] >= PICKS_PER_MARKET) continue;
        if (picked.find(p => p.ticker === ticker)) continue;
        const chg = parseFloat(String(m.changePercent ?? m.change ?? 0).replace('%', '')) || 0;
        picked.push({
          ticker, symbol: m.symbol || ticker, score: 0,
          sentiment: chg >= 0 ? 'positive' : 'negative',
          articles: [], total: 0, market, sector: 'Other', repeatCount: 0, signalBoost: 0,
        });
        marketCount[g]++;
      }
    } catch (e) { /* backfill is best-effort */ }
  }

  picked = picked.slice(0, PICKS_PER_ISSUE);

  // No-boring-repeat guard: if the picked set is identical to the latest
  // draft, walk further down the ranked list for a ticker not in that draft.
  if (!latestDraftSet.size || picked.length < PICKS_PER_ISSUE) {
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

  return picked.slice(0, PICKS_PER_ISSUE);
}

// ── Build market overview ────────────────────────────────────────
async function buildMarketOverview() {
  const [movers, indices, turnover, activeCount] = await Promise.all([
    fetchJson(`${BASE}/api/market/movers`, { nse: { gainers: [], losers: [] }, global: { gainers: [], losers: [] }, combined: { gainers: [], losers: [] } }),
    fetchJson(`${BASE}/api/indices/all`, {}),
    fetchJson(`${BASE}/api/market/turnover`, {}),
    pool.query(`SELECT COUNT(*) FROM (SELECT DISTINCT ON (ticker) ticker FROM signal_history ORDER BY ticker, generated_at DESC) t`).then(r => parseInt(r.rows[0].count) || 0).catch(() => 0),
  ]);

  const indicesArr = indices && typeof indices === 'object' && !Array.isArray(indices)
    ? Object.values(indices) : (Array.isArray(indices) ? indices : []);

  const nse20 = indicesArr.find(i => i.symbol?.includes('NSE20'));
  const nasi = indicesArr.find(i => i.symbol?.includes('NSEASI'));
  const sp500 = indicesArr.find(i => i.symbol?.includes('GSPC'));
  const nasdaq = indicesArr.find(i => i.symbol?.includes('IXIC'));
  const dow = indicesArr.find(i => i.symbol?.includes('DJI'));

  const toMover = (t, defMarket) => ({
    ticker: String(t.ticker || t.symbol || '').replace(/^(NSE|NGX|JSE):/i, ''),
    name: t.name || t.ticker || t.symbol || '',
    change: t.changePercent ?? t.change ?? t.pct_change ?? '0',
    price: t.price || t.regularMarketPrice || null,
    market: t.market || defMarket || 'Global',
  });

  const nseGainers = (movers?.nse?.gainers || []).slice(0, 3).map(g => toMover(g, 'NSE'));
  const nseLosers = (movers?.nse?.losers || []).slice(0, 3).map(l => toMover(l, 'NSE'));
  const globalGainers = (movers?.global?.gainers || []).slice(0, 3).map(g => toMover(g, 'Global'));
  const globalLosers = (movers?.global?.losers || []).slice(0, 3).map(l => toMover(l, 'Global'));

  // Pan-African movers — merge the dedicated NSE / NGX / JSE buckets and rank,
  // so the section is never Kenya-only and isn't diluted by the combined feed.
  const numPct = (v) => { const n = parseFloat(String(v ?? '0').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const africaFrom = (side) => {
    const buckets = [...(movers?.nse?.[side] || []), ...(movers?.ngx?.[side] || []), ...(movers?.jse?.[side] || [])];
    const list = buckets.length ? buckets : (movers?.combined?.[side] || []).filter(m => String(m.market || '').toUpperCase() !== 'GLOBAL');
    const seen = new Set();
    const out = [];
    for (const m of list) {
      const mv = toMover(m);
      const key = `${String(mv.market || '').toUpperCase()}:${String(mv.ticker).toUpperCase()}`;
      if (!mv.ticker || seen.has(key)) continue;
      seen.add(key);
      out.push(mv);
    }
    return out;
  };
  const africaGainers = africaFrom('gainers').sort((a, b) => numPct(b.change) - numPct(a.change)).slice(0, 5);
  const africaLosers = africaFrom('losers').sort((a, b) => numPct(a.change) - numPct(b.change)).slice(0, 5);

  const africaTurnover = turnover && (turnover.nse || turnover.ngx || turnover.jse)
    ? { nse: turnover.nse || null, ngx: turnover.ngx || null, jse: turnover.jse || null }
    : null;

  return {
    nse: {
      nse20: nse20 ? { value: nse20.value, change: nse20.change, changeRaw: nse20.changeRaw } : null,
      nasi: nasi ? { value: nasi.value, change: nasi.change, changeRaw: nasi.changeRaw } : null,
      topGainer: nseGainers[0] || null,
      topLoser: nseLosers[0] || null,
      gainers: nseGainers,
      losers: nseLosers,
    },
    africa: {
      nse20: nse20 ? { value: nse20.value, change: nse20.change, changeRaw: nse20.changeRaw } : null,
      nasi: nasi ? { value: nasi.value, change: nasi.change, changeRaw: nasi.changeRaw } : null,
      gainers: africaGainers,
      losers: africaLosers,
      turnover: africaTurnover,
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
// Compact, real market context string fed into the per-stock analysis prompt so
// the editorial is grounded in the day's actual index levels and movers across
// African + global markets instead of the model's priors (fewer inaccuracies).
function formatMarketContext(marketOverview, stock) {
  const af = marketOverview?.africa || {};
  const nse = marketOverview?.nse || {};
  const us = marketOverview?.us || {};
  const mk = String(stock?.market || '').toUpperCase();
  const idx = [];
  if (mk === 'NSE') {
    if (nse.nse20?.value) idx.push(`NSE 20 ${nse.nse20.value} (${nse.nse20.change || '--'})`);
    if (nse.nasi?.value) idx.push(`NASI ${nse.nasi.value} (${nse.nasi.change || '--'})`);
  } else if (mk === 'GLOBAL') {
    if (us.sp500?.value) idx.push(`S&P 500 ${us.sp500.value} (${us.sp500.change || '--'})`);
    if (us.nasdaq?.value) idx.push(`Nasdaq ${us.nasdaq.value} (${us.nasdaq.change || '--'})`);
    if (us.dow?.value) idx.push(`Dow ${us.dow.value} (${us.dow.change || '--'})`);
  }
  const homeLabel = mk === 'NGX' ? 'NGX (Nigeria)' : mk === 'JSE' ? 'JSE (South Africa)' : mk === 'NSE' ? 'NSE (Kenya)' : 'US/global markets';
  const parts = [];
  if (stock?.sector && stock.sector !== 'Other') parts.push(`Sector: ${stock.sector}.`);
  parts.push(`This stock trades on ${homeLabel}.`);
  if (idx.length) parts.push(`Home indices: ${idx.join(', ')}.`);
  if (mk !== 'GLOBAL') {
    const afUp = (af.gainers || []).slice(0, 3).map(m => `${m.ticker}[${m.market}] ${m.change}`);
    if (afUp.length) parts.push(`African movers up: ${afUp.join(', ')}.`);
    const afDown = (af.losers || []).slice(0, 3).map(m => `${m.ticker}[${m.market}] ${m.change}`);
    if (afDown.length) parts.push(`African movers down: ${afDown.join(', ')}.`);
  } else {
    const gUp = (us.gainers || []).slice(0, 3).map(m => `${m.ticker} ${m.change}`);
    if (gUp.length) parts.push(`Global movers up: ${gUp.join(', ')}.`);
  }
  return parts.join(' ');
}

async function generateNarrativeThesis(ticker, sentiment, articles, priceData, market, extraContext = '') {
  const name = companyNameFor({ ticker, market });
  const isGlobal = market === 'Global';

  const articleList = articles.slice(0, 4).map((a, i) =>
    `${i + 1}. "${a.headline}" (${a.source || 'Unknown'}, sentiment: ${a.sentiment})${a.excerpt ? '\n   Excerpt: ' + a.excerpt.slice(0, 200) : ''}`
  ).join('\n');

  // Anchor the editorial to the stock's real exchange + currency so the model
  // never relocates an NGX/JSE name onto the NSE (or mislabels the currency).
  const EX = {
    NSE: { name: 'Nairobi Securities Exchange (NSE), Kenya', ccy: 'KES', macro: 'Kenyan macro, CBK policy and NSE liquidity' },
    NGX: { name: 'Nigerian Exchange (NGX), Nigeria', ccy: 'NGN', macro: 'Nigerian macro, CBN policy and NGX liquidity' },
    JSE: { name: 'Johannesburg Stock Exchange (JSE), South Africa', ccy: 'ZAR', macro: 'South African macro, SARB policy and JSE liquidity' },
    GLOBAL: { name: 'US/global markets', ccy: 'USD', macro: 'US macro, Fed policy and global sector rotation' },
  };
  const ex = EX[String(market || '').toUpperCase()] || EX.GLOBAL;

  const priceContext = priceData
    ? `Current price: ${priceData.price != null ? priceData.price : 'N/A'} ${ex.ccy}, daily change: ${priceData.change ?? 'N/A'} (${priceData.changePercent ?? 'N/A'}), volume: ${priceData.volume ? Number(priceData.volume).toLocaleString() : 'N/A'}`
    : 'Live price data not available at time of generation.';

  const marketContext = `This is a ${ex.name} stock. Quote any price in ${ex.ccy}. Consider ${ex.macro}. Do NOT reference other exchanges or currencies — never mention Nairobi, the NSE or KES unless this is an NSE stock, and never mention Lagos/NGX/CBN/NGN or Johannesburg/JSE/SARB/ZAR unless this is that exchange's stock.`;

  const prompt = `You are a senior equity research analyst writing a daily market briefing for investors. Write a rich, data-driven editorial analysis for ${name} (${ticker}) — listed on the ${ex.name}, quoted in ${ex.ccy}.

RECENT NEWS COVERAGE:
${articleList || 'No recent articles.'}

MARKET DATA:
${priceContext}

CONTEXT:
${marketContext}
${extraContext ? `
MARKET CONTEXT — REAL FIGURES (use these and ONLY these; never invent numbers):
${extraContext}
` : ''}
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
- Use ONLY the figures and facts provided above; never invent prices, ratios, dates or events. If a figure was not given, do not state one
- Quote prices in ${ex.ccy}; never place this stock on a different exchange or market
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
    if (!catalyst) catalyst = fallbackCatalystLine(ticker, market);
    if (!risk) risk = fallbackRiskLine(ticker, market);

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

// RSS descriptions often end with the publisher name appended to the sentence
// ("… earnings fall The Kenyan Wall Street."). Strip it so the prose reads clean.
function stripTrailingSource(text, source) {
  let s = String(text || '').trim();
  const src = String(source || '').trim();
  if (src && s.toLowerCase().endsWith(src.toLowerCase())) {
    s = s.slice(0, s.length - src.length).replace(/[\s\-–—|•·:,]+$/, '').trim();
  }
  // Also drop a trailing domain (e.g. "… says report. businessdailyafrica.com").
  s = s.replace(/\s+[a-z0-9-]+\.(?:co\.[a-z]{2}|com|net|org|africa|ke|ng|za)\b\.?$/i, '').trim();
  return s.replace(/[\s\-–—|•·:,]+$/, '').trim();
}

// Sector-aware risk lines so every name in a newsletter doesn't repeat the same
// generic sentence.
function fallbackRiskLine(ticker, market) {
  const t = String(ticker || '').toUpperCase();
  const m = String(market || '').toUpperCase();
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
  if (m === 'NSE' && NSE_RISKS[t]) return NSE_RISKS[t];
  if (m === 'NGX') return 'naira volatility, CBN policy and NGX liquidity';
  if (m === 'JSE') return 'rand volatility, SARB policy and JSE liquidity';
  if (m === 'NSE') return 'Kenyan macro conditions, CBK policy and NSE liquidity';
  return 'rate expectations, sector rotation and earnings revisions';
}

// Near-term catalyst, varied by market/sector rather than one repeated line.
function fallbackCatalystLine(ticker, market) {
  const t = String(ticker || '').toUpperCase();
  const m = String(market || '').toUpperCase();
  if (m === 'NGX') return 'the next NGX earnings release and CBN policy';
  if (m === 'JSE') return 'the next JSE results and the SARB rate decision';
  if (m === 'GLOBAL') return 'the next earnings report and US macro data';
  if (['EQTY', 'KCB', 'COOP', 'ABSA', 'NCBA', 'SBIC', 'SCBK', 'DTK', 'HFCK', 'BKG', 'IMH'].includes(t)) return 'the next CBK rate decision and Q3 earnings';
  if (t === 'SCOM') return 'M-Pesa monetisation updates and the next results';
  if (t === 'EABL') return 'volume trends in the next trading update';
  if (['BAMB', 'PORT'].includes(t)) return 'construction-demand data and the next results';
  if (['NMG', 'SGL'].includes(t)) return 'digital-subscription growth in the next update';
  return 'the next corporate announcement or NSE trading update';
}

function generateFallbackNarrative(ticker, sentiment, articles, market, priceData) {
  const name = companyNameFor({ ticker, market });
  const isGlobal = market === 'Global';
  const heads = articles.filter(a => a.headline).map(a => a.headline);
  const primary = heads[0] || '';
  const secondary = heads[1] || '';
  // Ignore placeholder "excerpts" (RSS items whose body is just a link-out).
  const rawExcerpt = String(articles[0]?.excerpt || '');
  const isPlaceholder = /read the full story|read more|click here|continue reading|subscribe/i.test(rawExcerpt) && rawExcerpt.length < 90;
  const detail = isPlaceholder ? '' : stripTrailingSource(cleanSnippet(rawExcerpt, 170), articles[0]?.source);

  const thesis = pickFallbackThesis(name, sentiment);

  const px = priceData && priceData.price != null ? Number(priceData.price) : null;
  const rawPct = priceData ? (priceData.changePercent ?? priceData.change) : null;
  const pctNum = rawPct != null ? Number(String(rawPct).replace('%', '')) : NaN;
  const pct = Number.isFinite(pctNum) && pctNum !== 0
    ? `${pctNum >= 0 ? '+' : ''}${pctNum.toFixed(2)}%`
    : null;
  const vol = priceData && priceData.volume ? Number(priceData.volume).toLocaleString() : null;
  const pxStr = px != null ? (Number.isInteger(px) ? px.toLocaleString() : px.toLocaleString(undefined, { maximumFractionDigits: 2 })) : null;

  // 1) What happened — plain, factual.
  const opening = primary
    ? `${name} (${ticker}) is in focus after the headline "${cleanSnippet(primary, 110)}".`
    : `${name} (${ticker}) is in focus today.`;

  // 2) The concrete detail behind the headline.
  const detailSentence = detail ? `In short: ${detail}.` : '';

  // 3) A second thread, if there is one.
  const secondarySentence = secondary ? `Also worth noting: "${cleanSnippet(secondary, 100)}".` : '';

  // 4) The market's read, using the live move and volume.
  let marketRead;
  if (pxStr != null) {
    const reaction = sentiment === 'positive'
      ? 'so the news may not be fully priced in yet'
      : sentiment === 'negative'
      ? 'so the market is still absorbing it'
      : 'so the market is waiting for confirmation';
    marketRead = `The shares trade at ${pxStr}${pct ? `, ${pct} on the day` : ''}${vol ? ` on volume of ${vol}` : ''}, ${reaction}.`;
  } else {
    marketRead = sentiment === 'positive'
      ? 'The news is constructive, but it only becomes convincing on follow-through volume.'
      : sentiment === 'negative'
      ? 'The news weighs on sentiment; the next session shows whether sellers follow through.'
      : 'The market is waiting for a clearer signal before committing either way.';
  }

  // 5) What to watch.
  const outlook = sentiment === 'positive'
    ? 'A close above recent highs on rising volume would confirm the bullish read.'
    : sentiment === 'negative'
    ? 'Watch whether recent support holds; a decisive break below opens the next leg lower.'
    : 'Watch the next company update or macro print — it should break the current range.';

  // 6) A specific, market-aware risk.
  const riskText = `Main risk: ${fallbackRiskLine(ticker, market)}.`;

  const analysis = [opening, detailSentence, secondarySentence, marketRead, outlook, riskText].filter(Boolean).join(' ');

  return {
    thesis,
    analysis,
    catalyst: fallbackCatalystLine(ticker, market),
    risk: fallbackRiskLine(ticker, market),
  };
}

// ── Generate thematic intro for the newsletter ───────────────────
// Templated (no-LLM) intro + editor's note. The daily flow uses these so the
// limited LLM quota is spent on the per-stock narratives and the big story,
// where it adds the most value, instead of on these short preambles.
function buildThematicIntro(stocks, marketOverview) {
  const tickerList = stocks.map(s => `${companyNameFor(s)} (${s.ticker})`).join(', ');
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
  const tickerList = stocks.map(s => `${companyNameFor(s)} (${s.ticker})`).join(', ');
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
  const names = stocks.map(s => `${companyNameFor(s)} (${s.ticker})`).join(', ');
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
  const lines = stocks.map((s, i) => {
    const name = companyNameFor(s);
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
    const nseT = nseStocks.map(s => companyNameFor(s)).join(' & ');
    const globT = globalStocks.map(s => companyNameFor(s)).join(' & ');
    summary += `${nseT} ${nseStocks.length > 1 ? 'lead' : 'leads'} the NSE conversation today, while ${globT} ${globalStocks.length > 1 ? 'carry' : 'carries'} the global narrative. `;
  } else if (nseStocks.length > 0) {
    const names = nseStocks.map(s => companyNameFor(s)).join(' & ');
    summary += `On the NSE, ${names} ${nseStocks.length > 1 ? 'are' : 'is'} the names that matter today. `;
  } else {
    const names = globalStocks.map(s => companyNameFor(s)).join(' & ');
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
    africa: { gainers: [], losers: [], turnover: null },
    us: { sp500: null, nasdaq: null, dow: null, gainers: [], losers: [] },
    sentiment: 'Neutral',
    totalSignals: 0,
  }));

  // 3. Fetch price data for hot stocks (African exchanges are exchange-prefixed)
  let priceDataMap = {};
  try {
    const africaStocks = hotStocks.filter(s => isAfricanMarket(s.market));
    if (africaStocks.length > 0) {
      const africaSymbols = africaStocks.map(s => `${s.market}:${s.ticker}`).join(',');
      const africaQuotes = await fetchJson(`${BASE}/api/quotes?symbols=${africaSymbols}`, []);
      if (Array.isArray(africaQuotes)) {
        for (const q of africaQuotes) {
          if (q && q.symbol) priceDataMap[q.symbol] = q;
        }
      }
    }
    // Fetch global stocks
    const globalStocks = hotStocks.filter(s => !isAfricanMarket(s.market));
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
    const priceKey = isAfricanMarket(stock.market) ? `${stock.market}:${stock.ticker}` : stock.ticker;
    const priceData = priceDataMap[priceKey] || priceDataMap[stock.ticker] || null;
    const marketCtx = formatMarketContext(marketOverview, stock);
    const { thesis, analysis, catalyst, risk } = await generateNarrativeThesis(stock.ticker, stock.sentiment, stock.articles, priceData, stock.market, marketCtx)
    .catch(e => { console.warn(`[INSIGHTS] narrative fallback for ${stock.ticker}: ${e.message}`); return generateFallbackNarrative(stock.ticker, stock.sentiment, stock.articles, stock.market, priceData); });

    const companyName = companyNameFor(stock);
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

  // 6c. Pan-African editorial headlines (JSE/NGX/NSE SENS & company reports),
  // mirroring the public site's "#insights" section so the newsletter carries
  // African-market coverage even when no NGX/JSE name makes the deep-dive list.
  const africaNews = await getAfricaNewsArticles()
    .then(list => list.filter(n => n.title).slice(0, 6))
    .catch(() => []);

  // 7. Build content object
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const content = {
    dateStr,
    marketOverview,
    africaNews,
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
