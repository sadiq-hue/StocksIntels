const axios = require('axios');
const { getNewsSummary } = require('./newsService');
const { getSectorPerformance } = require('./indicesService');
const { generateSignals } = require('./signalService');
const fxService = require('./fxService');
const llm = require('./llmService');

const PORT = process.env.PORT || 3001;
const BASE = `http://localhost:${PORT}`;
const USE_LLM = process.env.USE_LLM === 'true';

async function fetchJson(url, fallback = null) {
  try { const r = await axios.get(url, { timeout: 8000 }); return r.data; }
  catch { return fallback; }
}

async function generateWeeklyDigestContent() {
  const [movers, summary, allIndices, sectors, news] = await Promise.all([
    fetchJson(`${BASE}/api/market/movers`, { nse: { gainers: [], losers: [] }, global: { gainers: [], losers: [] }, combined: { gainers: [], losers: [] }, active: [] }),
    fetchJson(`${BASE}/api/ai/market-summary`, { sentiment: 'Neutral', signals: { total: 0, strongBuys: 0, buys: 0, sells: 0 } }),
    fetchJson(`${BASE}/api/indices/all`, []),
    getSectorPerformance().catch(() => []),
    getNewsSummary().catch(() => ({ hotNews: [], trending: [] })),
  ]);

  const nseIndices = (Array.isArray(allIndices) ? allIndices : []).filter(i => i.market === 'NSE' || i.currency === 'KES');
  const globalIdx = (Array.isArray(allIndices) ? allIndices : []).filter(i => i.market === 'Global' || i.currency === 'USD');
  const nse20 = nseIndices.find(i => i.symbol?.includes('NSE20'));
  const nasi = nseIndices.find(i => i.symbol?.includes('NSEASI'));
  const sp500 = globalIdx.find(i => i.symbol?.includes('GSPC'));

  const nseGainers = movers?.nse?.gainers?.slice(0, 3) || [];
  const nseLosers = movers?.nse?.losers?.slice(0, 3) || [];
  const globalGainers = movers?.global?.gainers?.slice(0, 3) || [];
  const active = movers?.active?.slice(0, 3) || [];

  const nseSentiment = (nse20?.isPositive ? 'positive' : nse20?.changeRaw < -0.5 ? 'negative' : 'mixed');
  const globalSentiment = sp500?.isPositive ? 'positive' : sp500?.changeRaw < -0.5 ? 'negative' : 'mixed';

  const topSector = sectors.length > 0 ? sectors[0] : null;
  const worstSector = sectors.length > 1 ? sectors[sectors.length - 1] : null;

  const hotNews = news?.hotNews || [];
  const trending = news?.trending || [];
  const topStory = trending.length > 0 ? trending[0] : (hotNews.length > 0 ? hotNews[0] : null);

  let nseSummary, storyOfWeek, milestone, globalTheme, macroBackdrop, whatToWatch, nseGlobalConnection;
  if (USE_LLM) {
    const combined = await llm.generateAllWeeklySections({ nse20, nasi, nseGainers, nseLosers, globalGainers, topSector, worstSector, sp500, summary, topStory }).catch(() => null);
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
  macroBackdrop = macroBackdrop || '(Data refresh pending live macro feed.)';
  whatToWatch = whatToWatch || buildWhatToWatch(summary, nse20, sectors);
  nseGlobalConnection = nseGlobalConnection || buildNseGlobalConnection(nse20, sp500, nseSentiment, globalSentiment);

  return { nseSummary, storyOfWeek, milestone, globalTheme, macroBackdrop, whatToWatch, nseGlobalConnection };
}

function buildNseSummary(nse20, gainers, losers, active, sentiment, topSector, worstSector) {
  const nse20Chg = nse20?.change || '--';
  const nse20Val = nse20?.value || '--';
  let text = `The NSE wrapped the week on a ${sentiment} note, with the NSE 20 at ${nse20Val} (${nse20Chg}). `;

  if (gainers.length > 0) {
    const top = gainers[0];
    text += `${top.name || top.symbol} led the gainers, up ${top.change || top.changePercent || '--'}%. `;
  }
  if (losers.length > 0) {
    const bot = losers[0];
    text += `${bot.name || bot.symbol} declined ${(bot.change || bot.changePercent || '--')}%. `;
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
    let text = `**${topStory.headline}** — `;
    text += topStory.excerpt || 'This story dominated market conversation this week.';
    if (topStory.relatedStocks?.length) {
      text += ` Related stock${topStory.relatedStocks.length > 1 ? 's' : ''}: ${topStory.relatedStocks.join(', ')}.`;
    }
    return text;
  }
  if (gainers.length > 0) {
    return `**${gainers[0].name || gainers[0].symbol}** was the week's standout performer, gaining ${gainers[0].change || gainers[0].changePercent || '--'}% on strong volume. This move reflects growing investor confidence in the ${gainers[0].sector || 'sector'} space.`;
  }
  return 'Markets navigated a week of mixed signals with selective opportunities in blue-chip stocks.';
}

function buildMilestone(nse20, sp500, gainers, movers) {
  if (nse20?.value) {
    return `The NSE 20 traded at ${nse20.value} (${nse20.change}) this week. ${sp500 ? `Globally, the S&P 500 stood at ${sp500.value} (${sp500.change}).` : ''}`;
  }
  if (gainers.length > 0) {
    return `${gainers[0].name || gainers[0].symbol} recorded notable gains of ${gainers[0].change || gainers[0].changePercent || '--'}%, standing out as a top weekly performer.`;
  }
  return 'Markets continue to reflect cautious optimism as investors digest the latest economic signals.';
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
    text += `Top global stock: ${gainers[0].name || gainers[0].symbol} (${gainers[0].change || gainers[0].changePercent || '--'}%).`;
  }
  return text;
}

function buildWhatToWatch(summary, nse20, sectors) {
  const totalSignals = summary?.signals?.total || 0;
  const strongBuys = summary?.signals?.strongBuys || 0;
  const sells = summary?.signals?.sells || 0;
  let text = 'This week, monitor ';
  if (strongBuys > 0) {
    text += `${strongBuys} strong buy signal${strongBuys > 1 ? 's' : ''} for potential breakout opportunities. `;
  }
  if (sells > 0) {
    text += `${sells} sell signal${sells > 1 ? 's' : ''} suggest caution on overextended positions. `;
  }
  if (totalSignals > 0) {
    text += `StocksIntels AI tracks ${totalSignals} active signals. `;
  }
  if (nse20?.value) {
    text += `Watch the NSE 20 ${nse20.value} level as a key support/resistance zone.`;
  } else {
    text += 'Watch for key support and resistance levels as the new trading week opens.';
  }
  return text;
}

function buildNseGlobalConnection(nse20, sp500, nseSent, globalSent) {
  if (sp500 && nse20) {
    const direction = sp500.isPositive ? 'positive' : 'negative';
    return `Global markets closed ${direction} (S&P 500 ${sp500.change || '--'}). Historically, a ${direction} Wall Street session tends to set a ${globalSent === nseSent ? 'supportive' : 'mixed'} tone for the NSE open. The NSE 20 at ${nse20.value || '--'} will be tested against global sentiment early in the week.`;
  }
  return 'Global market movements overnight can set the tone for NSE open. Watch for significant gap-ups or gap-downs in the first 30 minutes of trading, especially in large-cap banking and telecom names.';
}

// ── Daily Brief Content ──

async function generateDailyBriefContent() {
  const [movers, summary, allIndices, sectors, signals] = await Promise.all([
    fetchJson(`${BASE}/api/market/movers`, { nse: { gainers: [], losers: [] }, global: { gainers: [], losers: [] }, combined: { gainers: [], losers: [] }, active: [] }),
    fetchJson(`${BASE}/api/ai/market-summary`, { sentiment: 'Neutral', signals: { total: 0, strongBuys: 0, buys: 0, sells: 0 } }),
    fetchJson(`${BASE}/api/indices/all`, []),
    getSectorPerformance().catch(() => []),
    generateSignals(null, true).catch(() => []),
  ]);

  const nseIndices = (Array.isArray(allIndices) ? allIndices : []).filter(i => i.market === 'NSE' || i.currency === 'KES');
  const globalIdx = (Array.isArray(allIndices) ? allIndices : []).filter(i => i.market === 'Global' || i.currency === 'USD');

  const usdToKes = await fxService.getRate('USDKES').catch(() => '--');

  const nse20 = nseIndices.find(i => i.symbol?.includes('NSE20'));
  const nasi = nseIndices.find(i => i.symbol?.includes('NSEASI'));
  const ngx = nseIndices.find(i => i.symbol?.includes('NGX'));
  const sp500 = globalIdx.find(i => i.symbol?.includes('GSPC'));
  const ndx = globalIdx.find(i => i.symbol?.includes('IXIC'));
  const dji = globalIdx.find(i => i.symbol?.includes('DJI'));

  const indices = [
    { label: 'NSE 20', value: nse20?.value || '--', change: nse20?.change || '--', signal: summary?.sentiment === 'Bullish' ? 'BULLISH' : summary?.sentiment === 'Bearish' ? 'BEARISH' : 'NEUTRAL' },
    { label: 'NASI', value: nasi?.value || '--', change: nasi?.change || '--', signal: '--' },
    { label: 'NGX ASI', value: ngx?.value || '--', change: ngx?.change || '--', signal: '--' },
    { label: 'S&P 500', value: sp500?.value || '--', change: sp500?.change || '--', signal: '--' },
    { label: 'USD/KES', value: usdToKes || '--', change: '--', signal: '--' },
  ];

  const combinedMovers = [...(movers?.combined?.gainers || []), ...(movers?.combined?.losers || [])].slice(0, 6);
  const yesterdayTopMovers = combinedMovers.map(m => ({
    symbol: m.symbol || '--',
    company: m.company_name || m.name || '',
    change: m.changePercent ? (m.isPositive ? '+' : '') + m.changePercent.toFixed(2) + '%' : (m.change || '--'),
    volume: m.volume?.toLocaleString() || '--',
  }));

  const signalOfDay = Array.isArray(signals) ? signals.sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 3) : [];

  const aiSignal = `StocksIntels AI indicates ${summary?.sentiment || 'neutral'} market conditions — ${summary?.signals?.total || 0} active signals across exchanges.`;

  let aiSignalContext, globalToNseConnection, analystTake;
  if (USE_LLM) {
    const combined = await llm.generateAllBriefSections({ sentiment: summary?.sentiment, signals: summary?.signals, topSignals: signalOfDay, sp500, ndx, nse20, sectors }).catch(() => null);
    if (combined) {
      aiSignalContext = combined.aiSignalContext;
      globalToNseConnection = combined.globalToNseConnection;
      analystTake = combined.analystTake;
    }
  }
  aiSignalContext = aiSignalContext || buildAiSignalContext(summary, signalOfDay, sp500);
  globalToNseConnection = globalToNseConnection || buildDailyGlobalConnection(sp500, ndx, nse20, summary);
  analystTake = analystTake || buildAnalystTake(signalOfDay, sectors, summary);

  const globalIndices = [
    { label: 'S&P 500', value: sp500?.value || '--', change: sp500?.change || '--', keyDriver: sp500 ? `Prev close ${sp500.previousClose}` : 'Overnight data pending' },
    { label: 'Nasdaq', value: ndx?.value || '--', change: ndx?.change || '--', keyDriver: ndx ? `Prev close ${ndx.previousClose}` : 'Overnight data pending' },
    { label: 'Dow Jones', value: dji?.value || '--', change: dji?.change || '--', keyDriver: dji ? `Prev close ${dji.previousClose}` : 'Overnight data pending' },
    { label: 'Russell 2000', value: '--', change: '--', keyDriver: 'Overnight data pending' },
  ];

  return { indices, yesterdayTopMovers, aiSignal, aiSignalContext, globalIndices, globalToNseConnection, calendar: buildDailyCalendar(), analystTake };
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
    parts.push(`Top signal: ${top.name || top.ticker} (${top.signal}, ${top.confidence}% confidence)${top.reason ? ` — ${top.reason}` : ''}.`);
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
  let text = `Markets open with a ${sent.toLowerCase()} bias today. `;
  if (topSignals.length > 0) {
    const s = topSignals[0];
    text += `${s.name || s.ticker} carries a ${s.signal} rating (${s.confidence}% confidence)${s.entry ? ` with entry at ${s.entry}` : ''}. ${s.reason || ''} `;
  }
  if (sectors.length > 0) {
    const leading = sectors.filter(s => s.avgChange > 0).slice(0, 2);
    if (leading.length > 0) {
      text += `Leading sectors: ${leading.map(s => `${s.sector} (${s.avgChange}%)`).join(', ')}. `;
    }
  }
  if (summary?.signals?.sells > 0) {
    text += `${summary.signals.sells} sell signal${summary.signals.sells > 1 ? 's' : ''} flagged — monitor for downside risk.`;
  }
  return text;
}

// ── Earnings Report Content ──

async function generateEarningsContent() {
  const [signals, news] = await Promise.all([
    generateSignals(null, true).catch(() => []),
    getNewsSummary().catch(() => ({ hotNews: [], trending: [] })),
  ]);

  const trending = news?.trending || [];
  const hotNews = news?.hotNews || [];

  const earningsCalendar = buildEarningsCalendar(hotNews, trending, signals);
  const corporateActions = buildCorporateActions(hotNews, trending, signals);
  const earningsResults = buildEarningsResults(signals);
  const globalEarnings = buildGlobalEarnings(signals);

  return { earningsCalendar, earningsResults, corporateActions, globalEarnings };
}

function buildEarningsCalendar(hotNews, trending, signals) {
  const entries = [];
  if (hotNews.length > 0) {
    hotNews.slice(0, 4).forEach(article => {
      if (article.hotType === 'Earnings') {
        entries.push({
          date: 'This period',
          company: article.relatedStocks?.join(', ') || 'Company',
          exchange: 'NSE',
          period: article.headline?.includes('Q') ? article.headline.match(/Q[1-4]/)?.[0] || 'FY' : 'FY',
          aiExpectation: article.sentiment === 'positive' ? 'BEAT' : article.sentiment === 'negative' ? 'MISS' : 'IN-LINE',
        });
      }
    });
  }
  const tkrEntries = Array.isArray(signals) ? signals.filter(s => s.sector === 'Banking' || s.sector === 'Insurance').slice(0, 4).map(s => ({
    date: 'Next 30 days',
    company: s.name || s.ticker,
    exchange: s.market === 'NSE' ? 'NSE' : 'NYSE',
    period: 'FY',
    aiExpectation: s.signal === 'Strong Buy' ? 'BEAT' : s.signal === 'Strong Sell' ? 'MISS' : 'IN-LINE',
  })) : [];
  return [...entries, ...tkrEntries].slice(0, 8);
}

function buildCorporateActions(hotNews, trending, signals) {
  const entries = [];
  [...(hotNews || []), ...(trending || [])].slice(0, 6).forEach(article => {
    if (article.hotType === 'IPO' || article.hotType === 'Merger' || article.hotType === 'Partnership' || article.hotType === 'Regulatory') {
      entries.push({
        date: article.timestamp || 'Recent',
        company: article.relatedStocks?.join(', ') || '--',
        exchange: 'NSE',
        actionType: article.hotType.toUpperCase(),
        details: article.headline || '',
      });
    }
  });
  if (entries.length === 0 && Array.isArray(signals)) {
    signals.filter(s => s.type === 'Long Term Value').slice(0, 3).forEach(s => {
      entries.push({
        date: 'Ongoing',
        company: s.name || s.ticker,
        exchange: s.market === 'NSE' ? 'NSE' : 'NYSE',
        actionType: 'VALUE_OPPORTUNITY',
        details: `Undervalued: ${s.analysis?.fundamental?.grade || 'N/A'} fundamental grade. Entry at ${s.entry || '--'}`,
      });
    });
  }
  return entries.slice(0, 8);
}

function buildEarningsResults(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(s => s.analysis?.financial?.metrics).slice(0, 5).map(s => {
    const m = s.analysis.financial.metrics || {};
    const rev = m.revenue || m.Revenue || '--';
    const np = m.netProfit || m['Net Profit'] || m['Net Income'] || m.netIncome || '--';
    const eps = m.eps || m.EPS || '--';
    const est = m.estimatedEarnings || m.estimates?.eps || '--';
    const isBeat = s.signal === 'Strong Buy' || s.signal === 'Buy';
    const isMiss = s.signal === 'Strong Sell' || s.signal === 'Sell';
    return {
      ticker: s.ticker,
      company: s.name,
      exchange: s.market === 'NSE' ? 'NSE' : 'NYSE',
      period: 'FY',
      verdict: isBeat ? 'BEAT' : isMiss ? 'MISS' : 'IN-LINE',
      revenue: typeof rev === 'number' ? rev.toLocaleString() : rev,
      netProfit: typeof np === 'number' ? np.toLocaleString() : np,
      eps: typeof eps === 'number' ? eps.toFixed(2) : eps,
      vsEstimate: est && typeof eps === 'number' ? (eps > est ? '+' : '') + (eps - (est || 0)).toFixed(2) : '--',
      aiAnalysis: s.reason || `AI analysis: ${s.name} shows ${s.signal} signal with ${s.confidence}% confidence. ${s.analysis?.fundamental?.grade ? `Fundamental grade: ${s.analysis.fundamental.grade}.` : ''} ${s.analysis?.technical?.grade ? `Technical grade: ${s.analysis.technical.grade}.` : ''}`,
      shortTermSignal: s.signal === 'Strong Buy' ? 'BULLISH' : s.signal === 'Strong Sell' ? 'BEARISH' : 'NEUTRAL',
      dividend: m.dividendYield ? `${m.dividendYield}%` : undefined,
      watchPrice: s.target1 || undefined,
    };
  });
}

function buildGlobalEarnings(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(s => s.market !== 'NSE').slice(0, 5).map(s => {
    const isBeat = s.signal === 'Strong Buy' || s.signal === 'Buy';
    const isMiss = s.signal === 'Strong Sell' || s.signal === 'Sell';
    let africaImpact = '';
    if (s.ticker === 'AAPL') africaImpact = 'Apple supply chain affects tech imports into Kenya and Nigeria.';
    else if (s.ticker === 'JPM') africaImpact = 'JPM results inform EM capital flows — relevant for Kenyan bond market.';
    else if (s.ticker === 'XOM') africaImpact = 'Exxon outlook impacts oil-dependent African markets (Nigeria, Angola).';
    else if (s.ticker === 'META') africaImpact = 'Meta investments in African content creation and connectivity.';
    else africaImpact = `${s.name || s.ticker} performance provides macro read-through for African markets.`;
    return {
      ticker: s.ticker,
      company: s.name,
      result: isBeat ? 'BEAT' : isMiss ? 'MISS' : 'IN-LINE',
      africaImpact,
    };
  });
}

module.exports = { generateWeeklyDigestContent, generateDailyBriefContent, generateEarningsContent };
