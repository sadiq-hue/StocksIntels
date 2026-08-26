// Stock Insights Newsletter Service
// Generates a semi-automated, Hisa-style daily stock insights email.
// Picks top stocks by sentiment swing + price moves, generates editorial analysis,
// and stores a draft in newsletter_drafts for admin review before sending.

const axios = require('axios');
const { pool } = require('./db');
const { getAllNews, getNewsSummary } = require('./newsService');
const { getCompanyName } = require('./marketService');
const llm = require('./llmService');
const { generateSignals } = require('./signalService');
const periodReturnsService = require('./periodReturnsService');

const PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${PORT}`;

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

// ── Pick top stocks by news sentiment + price movement ───────────

async function pickHotStocks() {
  // 1. Get news with related stocks
  const allNews = await getAllNews(200).catch(() => []);

  // 2. Count sentiment occurrences per ticker
  const tickerSentiment = {};
  for (const article of allNews) {
    const stocks = article.relatedStocks || [];
    for (const ticker of stocks) {
      if (!tickerSentiment[ticker]) {
        tickerSentiment[ticker] = { positive: 0, negative: 0, neutral: 0, articles: [], total: 0 };
      }
      const sent = article.sentiment || 'neutral';
      tickerSentiment[ticker][sent] = (tickerSentiment[ticker][sent] || 0) + 1;
      tickerSentiment[ticker].total++;
      if (tickerSentiment[ticker].articles.length < 5) {
        tickerSentiment[ticker].articles.push({
          headline: article.headline || article.title || '',
          source: article.source || article.sourceName || '',
          sentiment: sent,
        });
      }
    }
  }

  // 3. Score each ticker: weighted by total articles, sentiment polarity, and recency
  const scored = Object.entries(tickerSentiment)
    .filter(([t]) => t && t.length >= 2 && t.length <= 6)
    .map(([ticker, data]) => {
      const polarity = Math.abs(data.positive - data.negative);
      const score = data.total * 2 + polarity * 3;
      const sentiment = data.positive > data.negative ? 'positive'
        : data.negative > data.positive ? 'negative' : 'neutral';
      return { ticker, score, sentiment, articles: data.articles, total: data.total };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return scored;
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

  return {
    nse: {
      nse20: nse20 ? { value: nse20.value, change: nse20.change, changeRaw: nse20.changeRaw } : null,
      nasi: nasi ? { value: nasi.value, change: nasi.change, changeRaw: nasi.changeRaw } : null,
      topGainer: movers?.nse?.gainers?.[0] || null,
      topLoser: movers?.nse?.losers?.[0] || null,
    },
    us: {
      sp500: sp500 ? { value: sp500.value, change: sp500.change, changeRaw: sp500.changeRaw } : null,
      nasdaq: nasdaq ? { value: nasdaq.value, change: nasdaq.change, changeRaw: nasdaq.changeRaw } : null,
    },
    sentiment: summary?.sentiment || 'Neutral',
    totalSignals: summary?.signals?.total || 0,
  };
}

// ── Build week-ahead events ──────────────────────────────────────

async function buildWeekAhead() {
  const events = [];

  // Get NSE corporate actions
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
      });
    }
  } catch {}

  // Get upcoming earnings if available
  try {
    const earningsRes = await fetchJson(`${BASE}/api/earnings/calendar?days=7`, []);
    if (Array.isArray(earningsRes)) {
      for (const e of earningsRes.slice(0, 5)) {
        events.push({
          date: e.date ? new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBA',
          event: `${e.symbol || e.ticker || ''} — Earnings Report`,
          impact: 'HIGH',
        });
      }
    }
  } catch {}

  return events.slice(0, 5);
}

// ── Generate LLM editorial analysis for a stock ──────────────────

async function generateStockAnalysis(ticker, sentiment, articles, priceData) {
  const articleList = articles.slice(0, 3).map(a => `- "${a.headline}" (${a.source}, sentiment: ${a.sentiment})`).join('\n');
  const priceContext = priceData
    ? `Current price: ${priceData.price || 'N/A'}, change: ${priceData.change || 'N/A'}, volume: ${priceData.volume || 'N/A'}`
    : 'Price data not available.';

  const prompt = `Write a 2-3 paragraph editorial analysis for ${ticker} (${getCompanyName(ticker) || ticker}) on the Nairobi Securities Exchange.

Recent news:
${articleList || 'No recent articles available.'}

${priceContext}

Cover:
1. What moved the stock and why it matters for investors
2. The outlook and key metrics to watch
3. Risk factors to consider

Write as a professional financial analyst. Be specific with numbers where available. Keep it to 150-200 words total. Do not use markdown. Do not mention AI.`;

  try {
    const text = await llm.generate(prompt, { maxTokens: 300, temperature: 0.7 });
    return text;
  } catch {
    return generateFallbackAnalysis(ticker, sentiment, articles);
  }
}

function generateFallbackAnalysis(ticker, sentiment, articles) {
  const name = getCompanyName(ticker) || ticker;
  const headline = articles[0]?.headline || '';
  const sentLabel = sentiment === 'positive' ? 'positive sentiment' : sentiment === 'negative' ? 'negative sentiment' : 'mixed signals';
  let text = `${name} (${ticker}) is drawing investor attention with ${sentLabel} across recent news coverage.`;
  if (headline) {
    text += ` "${headline}" is among the stories driving market conversation around the stock.`;
  }
  if (sentiment === 'positive') {
    text += ` The positive momentum could reflect improving fundamentals or strategic developments. Investors should monitor volume trends and upcoming earnings for confirmation of the trend.`;
  } else if (sentiment === 'negative') {
    text += ` The bearish tone warrants caution — traders should watch for support levels and any corporate announcements that could shift the narrative.`;
  } else {
    text += ` With mixed signals, the stock may consolidate before establishing a clearer direction. Key levels to watch include recent support and resistance zones.`;
  }
  return text;
}

// ── Main: generate daily newsletter draft ────────────────────────

async function generateDailyInsights() {
  console.log('[INSIGHTS] Starting daily stock insights generation...');

  // 1. Pick hot stocks
  const hotStocks = await pickHotStocks();
  if (hotStocks.length === 0) {
    console.log('[INSIGHTS] No hot stocks found, skipping generation');
    return null;
  }
  console.log(`[INSIGHTS] Picked ${hotStocks.length} hot stocks: ${hotStocks.map(s => s.ticker).join(', ')}`);

  // 2. Build market overview
  const marketOverview = await buildMarketOverview().catch(() => ({
    nse: { nse20: null, nasi: null, topGainer: null, topLoser: null },
    us: { sp500: null, nasdaq: null },
    sentiment: 'Neutral',
    totalSignals: 0,
  }));

  // 3. Get price data for hot stocks (via batch quotes)
  const top3 = hotStocks.slice(0, 3);
  let priceDataMap = {};
  try {
    const symbols = top3.map(s => `NSE:${s.ticker}`).join(',');
    const quotes = await fetchJson(`${BASE}/api/market/quotes?symbols=${symbols}`, {});
    if (quotes && typeof quotes === 'object') {
      priceDataMap = quotes;
    }
  } catch {}

  // 4. Generate editorial analysis for each stock (parallel, with timeout)
  const deepDives = await Promise.all(top3.map(async (stock) => {
    const priceData = priceDataMap[`NSE:${stock.ticker}`] || priceDataMap[stock.ticker] || null;
    const analysis = await withTimeout(
      generateStockAnalysis(stock.ticker, stock.sentiment, stock.articles, priceData),
      30000,
      `LLM analysis for ${stock.ticker}`
    ).catch(() => generateFallbackAnalysis(stock.ticker, stock.sentiment, stock.articles));

    const companyName = getCompanyName(stock.ticker) || stock.ticker;
    const signal = stock.sentiment === 'positive' ? 'BULLISH'
      : stock.sentiment === 'negative' ? 'BEARISH' : 'NEUTRAL';

    return {
      ticker: stock.ticker,
      companyName,
      exchange: 'NSE',
      headline: stock.articles[0]?.headline || `${companyName} — ${stock.sentiment} sentiment`,
      analysis,
      sentiment: stock.sentiment,
      signal,
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

  // 6. Generate summary
  const positiveCount = top3.filter(s => s.sentiment === 'positive').length;
  const negativeCount = top3.filter(s => s.sentiment === 'negative').length;
  const summaryParts = [`Today we track ${top3.length} stocks making news.`];
  if (positiveCount > 0) summaryParts.push(`${positiveCount} with positive sentiment.`);
  if (negativeCount > 0) summaryParts.push(`${negativeCount} with bearish signals.`);
  summaryParts.push(`Market mood: ${marketOverview.sentiment}.`);
  const summary = summaryParts.join(' ');

  // 7. Build newsletter content object
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
