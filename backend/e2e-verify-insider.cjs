// End-to-end verification harness for the insider dimension (NSE + US).
// Run: node e2e-verify-insider.cjs
const signalService = require('./signalService');
const { getStockQuote } = require('./marketService');
const { classifyInsider, getInsiderNewsSignals, initNewsHistory } = require('./newsService');
const sentimentHistory = require('./sentimentHistoryService');
const { pool } = require('./db');

const NSE_SYMS = ['SCOM', 'EQTY', 'KQ', 'KCB'];
const US_SYMS = ['AAPL', 'MSFT', 'META'];
const TEST_ARTICLE_ID = 'e2e-verify-insider-scom';

(async () => {
  // 1) DB plumbing: ensure the insider columns/table exist + read persisted insider rows
  await initNewsHistory();
  try {
    const hist = await sentimentHistory.getInsiderHistorical(14);
    const entries = Object.entries(hist);
    console.log(`E2E-DB insider history rows: ${entries.length} symbols` + (entries.length ? ` -> ${entries.map(([s, h]) => `${s}(buy:${h.buys}/sell:${h.sells})`).join(', ')}` : ''));
  } catch (e) {
    console.log(`E2E-DB ERROR: ${e.message}`);
  }

  // 2) Seed a temporary director-dealing article (must precede the news-map
  //    check so getInsiderNewsSignals' 5-min cache observes it). Cleaned up at the end.
  try {
    await sentimentHistory.persist([{
      id: TEST_ARTICLE_ID,
      headline: 'Safaricom director buys 50,000 shares in open market, raising stake',
      source: 'E2E-HARNESS',
      sentiment: 'positive',
      sentimentScore: 0.6,
      relatedStocks: ['SCOM'],
      publishedAt: new Date().toISOString(),
      insiderDirection: 'buy',
      insiderType: 'director',
    }]);
    console.log('E2E-SEED inserted temporary SCOM director-dealing article');
    const { rows } = await pool.query(
      `SELECT article_id, symbol, insider_direction, insider_type FROM news_sentiment_history WHERE article_id=$1`,
      [TEST_ARTICLE_ID]
    );
    console.log(`E2E-SEED db row(s): ${JSON.stringify(rows)}`);
  } catch (e) {
    console.log(`E2E-SEED ERROR: ${e.message}`);
  }

  // 3) News-derived insider signals map (what the engine feeds NSE symbols)
  try {
    const ins = await getInsiderNewsSignals();
    const keys = Object.keys(ins);
    console.log(`E2E-NEWS insider symbols: ${keys.length ? keys.join(', ') : 'none right now'}`);
    for (const k of keys) console.log(`E2E-NEWS ${k}: ${JSON.stringify(ins[k])}`);
    // Direct scoring of the seeded event through the shared NSE scorer.
    if (ins.SCOM) {
      const scored = signalService.scoreNewsInsider(ins.SCOM);
      console.log(`E2E-NEWS SCOM scoreNewsInsider: ${JSON.stringify(scored)}`);
    }
  } catch (e) {
    console.log(`E2E-NEWS ERROR: ${e.message}`);
  }

  // 4) Classifier spot-check on the live feed
  try {
    const { getAllNews } = require('./newsService');
    const news = await Promise.race([getAllNews(), new Promise(r => setTimeout(() => r([]), 20000))]);
    const hits = news.filter(a => !a.isMock && classifyInsider(a.headline, a.excerpt).direction);
    console.log(`E2E-NEWS-CLASSIFIED today: ${hits.length} article(s)`);
    for (const h of hits.slice(0, 10)) {
      const c = classifyInsider(h.headline, h.excerpt);
      console.log(`   [${c.direction}] ${h.source} | ${(h.headline || '').slice(0, 90)} | stocks=${(h.relatedStocks || []).join(',')}`);
    }
  } catch (e) {
    console.log(`E2E-NEWS-CLASSIFIED ERROR: ${e.message}`);
  }

  // 5) Real end-to-end signal generation for the target symbols
  const all = [...NSE_SYMS, ...US_SYMS];
  const marketData = {};
  for (const sym of all) {
    const marketSym = NSE_SYMS.includes(sym) ? `NSE:${sym}` : sym;
    try {
      const q = await getStockQuote(marketSym);
      if (q && q.price > 0) {
        marketData[sym] = { price: q.price, changePercent: q.changePercent || 0, volume: q.volume || 0 };
        console.log(`E2E-QUOTE ${sym}: price=${q.price}`);
      } else {
        console.log(`E2E-QUOTE ${sym}: no quote`);
      }
    } catch (e) {
      console.log(`E2E-QUOTE ${sym} ERROR: ${e.message}`);
    }
  }

  console.log(`E2E-BATCH starting for ${Object.keys(marketData).length} symbols...`);
  const t0 = Date.now();
  let signals;
  try {
    signals = await Promise.race([
      signalService.generateSignals(marketData, false, false),
      new Promise(r => setTimeout(() => r('TIMEOUT'), 240000)),
    ]);
    console.log(`E2E-BATCH done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`E2E-BATCH ERROR: ${e.message}`);
    signals = [];
  }
  if (signals === 'TIMEOUT') {
    console.log('E2E-BATCH TIMEOUT (240s)');
    process.exit(0);
  }
  for (const sym of all) {
    const s = Array.isArray(signals) ? signals.find(x => x && x.ticker === sym) : null;
    if (!s) { console.log(`E2E-SIGNAL ${sym}: NONE (gated/failed)`); continue; }
    console.log(`E2E-SIGNAL ${sym}: ${s.signal} (${s.action}) composite=${s.analysis?.overall?.score} conf=${s.confidence}`);
    console.log(`   insider=${JSON.stringify(s.insider)}`);
    console.log(`   catalyst=${JSON.stringify(s.catalyst)} speculative=${JSON.stringify(s.speculative)}`);
    console.log(`   reason=${s.reason}`);
  }

  // 6) Cleanup the temporary seed row.
  try {
    await pool.query(`DELETE FROM news_sentiment_history WHERE article_id = $1`, [TEST_ARTICLE_ID]);
    console.log('E2E-CLEANUP removed temporary article rows');
  } catch (e) {
    console.log(`E2E-CLEANUP ERROR: ${e.message}`);
  }
  process.exit(0);
})().catch(e => { console.log('E2E-FATAL', e); process.exit(1); });
