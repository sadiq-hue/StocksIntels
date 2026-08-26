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
    const { rows } = await pool.query('SELECT DISTINCT UPPER(ticker) as ticker FROM stocks WHERE ticker IS NOT NULL');
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

// ── Pick top stocks from BOTH NSE and global ──────────────────────
async function pickHotStocks() {
  const allNews = await getAllNews(300).catch(() => []);

  // Count sentiment per ticker
  const tickerSentiment = {};
  for (const article of allNews) {
    const stocks = article.relatedStocks || [];
    for (const ticker of stocks) {
      if (!ticker || ticker.length < 2 || ticker.length > 6) continue;
      if (!tickerSentiment[ticker]) {
        tickerSentiment[ticker] = { positive: 0, negative: 0, neutral: 0, articles: [], total: 0 };
      }
      const sent = article.sentiment || 'neutral';
      tickerSentiment[ticker][sent] = (tickerSentiment[ticker][sent] || 0) + 1;
      tickerSentiment[ticker].total++;
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

  // Score each ticker
  const scored = [];
  for (const [ticker, data] of Object.entries(tickerSentiment)) {
    if (!ticker || ticker.length < 2 || ticker.length > 6) continue;
    const polarity = Math.abs(data.positive - data.negative);
    const score = data.total * 2 + polarity * 3;
    const sentiment = data.positive > data.negative ? 'positive'
      : data.negative > data.positive ? 'negative' : 'neutral';
    const market = await getMarketLabel(ticker);
    scored.push({ ticker, score, sentiment, articles: data.articles, total: data.total, market });
  }

  scored.sort((a, b) => b.score - a.score);

  // Pick top 2 NSE + top 2 global (with fallback)
  const nseStocks = scored.filter(s => s.market === 'NSE').slice(0, 2);
  const globalStocks = scored.filter(s => s.market === 'Global').slice(0, 2);

  // If one market is empty, fill from the other
  const all = [...nseStocks, ...globalStocks];
  if (all.length < 3) {
    const extra = scored.filter(s => !all.find(a => a.ticker === s.ticker)).slice(0, 3 - all.length);
    all.push(...extra);
  }

  return all.slice(0, 4);
}

// ── Build market overview ────────────────────────────────────────
async function buildMarketOverview() {
  const [movers, indices, summary] = await Promise.all([
    fetchJson(`${BASE}/api/market/movers`, { nse: { gainers: [], losers: [] }, global: { gainers: [], losers: [] } }),
    fetchJson(`${BASE}/api/indices/all`, {}),
    fetchJson(`${BASE}/api/ai/market-summary`, { sentiment: 'Neutral', signals: { total: 0 } }),
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
    sentiment: summary?.sentiment || 'Neutral',
    totalSignals: summary?.signals?.total || 0,
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

// ── Generate rich LLM editorial analysis ──────────────────────────
async function generateStockAnalysis(ticker, sentiment, articles, priceData, market) {
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

WRITE THE ANALYSIS IN THIS STRUCTURE (3 short paragraphs, 180-250 words total):

Paragraph 1 — THE MOVE: What happened, why it matters, and the catalyst. Be specific with numbers, percentages, and dates. Reference the actual news headlines.

Paragraph 2 — THE OUTLOOK: Where this stock could go. Include 2-3 specific metrics or levels to watch (support/resistance, earnings dates, analyst targets, moving averages, sector trends). Connect to broader market themes.

Paragraph 3 — THE RISK: Key downside risks and what could invalidate the thesis. Be honest about uncertainty. Mention specific risk factors (regulatory, competition, macro headwinds, earnings risk).

RULES:
- Be specific with numbers, not vague
- Sound like a professional analyst, not a bot
- Do NOT use markdown formatting, bullet points, or headers
- Do NOT mention AI or that this is auto-generated
- Do NOT use phrases like "drawing investor attention" or "is among the stories" — be direct
- Do NOT start sentences with "The stock" — vary sentence structure
- Each sentence should convey new information`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 400, temperature: 0.7 });
    return text;
  } catch {
    return generateFallbackAnalysis(ticker, sentiment, articles, market);
  }
}

function generateFallbackAnalysis(ticker, sentiment, articles, market) {
  const name = getCompanyName(ticker) || ticker;
  const isGlobal = market === 'Global';
  const headlines = articles.filter(a => a.headline).slice(0, 3);
  const primaryHeadline = headlines[0]?.headline || '';
  const secondaryHeadline = headlines[1]?.headline || '';

  let text = '';

  // Paragraph 1: What happened
  if (primaryHeadline) {
    text += `${name} (${ticker}) featured prominently in today's ${isGlobal ? 'global' : 'NSE'} news cycle. `;
    text += `The lead story: "${primaryHeadline}"`;
    if (secondaryHeadline) {
      text += `, with additional coverage from "${secondaryHeadline}"`;
    }
    text += `. `;
  } else {
    text += `${name} (${ticker}) saw notable attention in today's ${isGlobal ? 'global markets' : 'NSE trading session'}. `;
  }

  if (sentiment === 'positive') {
    text += `The bullish tone across coverage suggests improving fundamentals or a positive catalyst that could drive further upside. `;
  } else if (sentiment === 'negative') {
    text += `The bearish sentiment across multiple sources signals caution — investors should watch for support levels and any corporate announcements that could change the narrative. `;
  } else {
    text += `Mixed signals across coverage suggest the stock may consolidate before establishing a clearer direction. `;
  }

  // Paragraph 2: Outlook
  text += `\n\nFrom a technical perspective, ${isGlobal ? 'broader market conditions and sector rotation trends' : 'NSE market breadth and sector rotation'} will be key to ${ticker}'s near-term trajectory. `;
  if (sentiment === 'positive') {
    text += `Upside potential remains intact if the positive catalysts sustain. Key levels to watch include recent highs and the ${isGlobal ? '50-day moving average' : '20-day EMA'}. `;
  } else if (sentiment === 'negative') {
    text += `Downside risk persists until a reversal catalyst emerges. Watch for volume confirmation on any bounce and whether the stock holds key support zones. `;
  } else {
    text += `A breakout above recent resistance would confirm bullish momentum, while a breakdown below support would signal further weakness. `;
  }

  // Paragraph 3: Risk
  text += `\n\nKey risks include ${isGlobal ? 'macro headwinds from interest rate policy, sector rotation, and broader market volatility' : 'Kenya-specific macro factors including currency movements, interest rate environment, and NSE liquidity conditions'}. `;
  if (sentiment === 'positive') {
    text += `While the current setup is constructive, any deterioration in the fundamental thesis or a broader market selloff could quickly erase gains.`;
  } else if (sentiment === 'negative') {
    text += `The current bearish positioning requires patience — rushing in before a clear reversal signal could expose investors to further downside.`;
  } else {
    text += `The lack of a clear directional bias means position sizing should be conservative until the picture clarifies.`;
  }

  return text;
}

// ── Generate editorial summary ────────────────────────────────────
function generateEditorialSummary(stocks, marketOverview) {
  const nseStocks = stocks.filter(s => s.market === 'NSE');
  const globalStocks = stocks.filter(s => s.market === 'Global');
  const positiveStocks = stocks.filter(s => s.sentiment === 'positive');
  const negativeStocks = stocks.filter(s => s.sentiment === 'negative');

  let summary = '';

  // Opening hook
  if (marketOverview.sentiment === 'Bullish') {
    summary += `Markets are riding high today with a broadly bullish tone. `;
  } else if (marketOverview.sentiment === 'Bearish') {
    summary += `Risk-off sentiment dominates as markets pull back. `;
  } else {
    summary += `Markets are treading water with a neutral-to-cautious tone. `;
  }

  // NSE section
  if (nseStocks.length > 0) {
    const tickers = nseStocks.map(s => s.ticker).join(' & ');
    summary += `On the NSE, ${tickers} ${nseStocks.length > 1 ? 'are' : 'is'} in focus — `;
    if (positiveStocks.some(s => nseStocks.includes(s))) {
      summary += `bullish momentum is building `;
    }
    if (negativeStocks.some(s => nseStocks.includes(s))) {
      summary += `while caution flags are waving `;
    }
    summary += `across the local board. `;
  }

  // Global section
  if (globalStocks.length > 0) {
    const tickers = globalStocks.map(s => s.ticker).join(' & ');
    summary += `Globally, ${tickers} ${globalStocks.length > 1 ? 'are' : 'is'} the names to watch — `;
    const globalPos = globalStocks.filter(s => s.sentiment === 'positive').length;
    const globalNeg = globalStocks.filter(s => s.sentiment === 'negative').length;
    if (globalPos > globalNeg) {
      summary += `with positive sentiment outweighing the bearish undercurrents. `;
    } else if (globalNeg > globalPos) {
      summary += `as negative headlines pile up and traders take a defensive stance. `;
    } else {
      summary += `with competing narratives keeping traders on edge. `;
    }
  }

  // Key stats
  summary += `Across ${stocks.length} tracked names, ${positiveStocks.length} ${positiveStocks.length === 1 ? 'carries' : 'carry'} bullish signals while ${negativeStocks.length} ${negativeStocks.length === 1 ? 'faces' : 'face'} bearish headwinds.`;

  return summary;
}

// ── Main: generate daily newsletter draft ────────────────────────
async function generateDailyInsights() {
  console.log('[INSIGHTS] Starting daily stock insights generation...');

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

  // 4. Generate rich editorial analysis for each stock (parallel)
  const deepDives = await Promise.all(hotStocks.map(async (stock) => {
    const priceKey = stock.market === 'NSE' ? `NSE:${stock.ticker}` : stock.ticker;
    const priceData = priceDataMap[priceKey] || priceDataMap[stock.ticker] || null;
    const analysis = await withTimeout(
      generateStockAnalysis(stock.ticker, stock.sentiment, stock.articles, priceData, stock.market),
      30000,
      `LLM analysis for ${stock.ticker}`
    ).catch(() => generateFallbackAnalysis(stock.ticker, stock.sentiment, stock.articles, stock.market));

    const companyName = getCompanyName(stock.ticker) || stock.ticker;
    const signal = stock.sentiment === 'positive' ? 'BULLISH'
      : stock.sentiment === 'negative' ? 'BEARISH' : 'NEUTRAL';

    return {
      ticker: stock.ticker,
      companyName,
      exchange: getExchangeDisplay(stock.market),
      headline: stock.articles[0]?.headline || `${companyName} — ${stock.sentiment} sentiment`,
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
    };
  }));

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
