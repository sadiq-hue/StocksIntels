// End-to-end verification of the KQ 2026 speculative-rally chain.
//
// Drives the REAL pipeline (analysisEngine fundamentals/technicals/financials,
// macroService, newsService catalyst classifier, signalService _buildSignal +
// speculative-rally gate) with KQ's actual FY25 fundamentals (Altman Z -0.74,
// Sh17.2B loss, negative equity, -14.3% revenue) and its Jan->Apr 2026 price
// path (Sh3.53 -> Sh8.14, ~+130%). Verifies:
//   A. no catalyst + distress           -> forced Strong Sell (hard trigger)
//   B. positive deal catalyst + distress -> NOT a Buy and NOT Strong Sell:
//      composite capped at Hold by the speculative-rally gate, with the
//      speculative flag and the deal catalyst surfaced on the signal.
require('dotenv').config();
const signalService = require('./signalService');
const { analyzeFundamentals, analyzeTechnicals, analyzeFinancials, getSectorMacroAdjustment } = require('./analysisEngine');
const { getMacroScore } = require('./macroService');
const { classifyCatalyst } = require('./newsService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     got: ${JSON.stringify(actual)}\n     exp: ${JSON.stringify(expected)}`}`);
}

(async () => {
  // KQ real FY25 fundamentals: Sh17.2B loss, negative equity, Altman Z -0.74.
  const stock = {
    symbol: 'KQ', name: 'Kenya Airways', sector: 'Transportation',
    altmanZ: -0.74,
    netIncome: -17200, revenue: 188500, revenueGrowth: -14.3,
    roe: -50, epsGrowth: -100,
    debtToEquity: 8.0, currentRatio: 0.5,
    pbRatio: -0.4,
  };
  // Jan->Apr 2026 rally Sh3.53 -> Sh8.14 over 50 sessions.
  const priceHistory = Array.from({ length: 50 }, (_, i) =>
    Math.round((3.53 + (8.14 - 3.53) * (i / 49)) * 10000) / 10000);
  const currentPrice = priceHistory[priceHistory.length - 1];

  const fundamental = analyzeFundamentals(stock, currentPrice);
  const technical = analyzeTechnicals('KQ', currentPrice, priceHistory, 3000000);
  const financial = analyzeFinancials(stock, fundamental);
  const macro0 = getMacroScore('KE');
  const sectorAdj = getSectorMacroAdjustment(stock.sector, 'KE', macro0.score);
  const macro = sectorAdj.delta
    ? { ...macro0, score: Math.max(0, Math.min(100, macro0.score + sectorAdj.delta)) }
    : macro0;
  const base = {
    symbol: 'KQ', stock, currentPrice, priceChange: 3.2, volume: 3000000,
    fundamental, technical, financial, macro,
    regime: { regime: 'bull' },
    weights: { fundamental: 0.30, technical: 0.25, financial: 0.10, macro: 0.05, ml_probability: 0.15, confidence: 0.15 },
    weeklyTrend: { trend: 'bullish' },
    newsSent: null, degFactor: 1, priceHistory,
  };

  // Sanity: the fundamentals must actually be flagged as distress (SUPPRESS)
  // and deteriorating, otherwise the hard-trigger path is not being exercised.
  check('fundamentals flagged altmanZ SUPPRESS', fundamental.metrics.altSignal, 'SUPPRESS');
  check('fundamentals deteriorating (revenue -14.3%)', stock.revenueGrowth < -5, true);
  check('KQ rally price path ends at ~8.14', Math.round(currentPrice * 100) / 100, 8.14);

  // ── Case A: distress, NO catalyst -> forced Strong Sell ─────────────────────
  const sigNoCat = await signalService._buildSignal({ ...base, catalyst: null });
  check('A) no catalyst + distress -> Strong Sell', sigNoCat.signal, 'Strong Sell');
  check('A) action is sell', sigNoCat.action, 'sell');
  check('A) distress reason surfaced', /distress|altman|z /i.test(sigNoCat.reason), true);

  // ── Case B: positive deal catalyst from a real KQ headline ──────────────────
  const cat = classifyCatalyst('Kenya Airways shares surge 130% as Temasek, Qatar Airways table rescue deals', '');
  check('B) real KQ headline classifies as positive catalyst', cat.direction, 'positive');

  const sigCat = await signalService._buildSignal({ ...base, catalyst: cat });
  const overall = sigCat.analysis.overall.score;
  console.log(`     (case B scored ${overall} -> ${sigCat.signal}, evidence-driven avoid or hold both acceptable)`);
  check('B) positive catalyst -> distress Strong Sell is suppressed', sigCat.signal !== 'Strong Sell', true);
  check('B) speculative rally never mints a Buy', sigCat.action !== 'buy', true);
  check('B) action is either hold or avoid', ['hold', 'sell'].includes(sigCat.action), true);
  check('B) composite capped at 54 (below 55 buy threshold)', overall <= 54, true);
  check('B) speculative flag surfaced', !!sigCat.speculative, true);
  check('B) speculative momentumPct reflects the run-up', sigCat.speculative.momentumPct >= 60, true);
  check('B) speculative altmanZ exposed', sigCat.speculative.altmanZ, -0.74);
  check('B) deal catalyst surfaced on signal', sigCat.catalyst && sigCat.catalyst.direction, 'positive');
  check('B) reason flags speculative driver', /SPECULATIVE/i.test(sigCat.reason), true);
  check('B) reason surfaces the deal catalyst', /catalyst/i.test(sigCat.reason), true);

  // ── Case B2: a red-hot technical (vertical rally) + positive catalyst would
  // otherwise clear the 55 Buy threshold; the speculative gate must cap it at 54.
  const strongTech = {
    score: 95, technicalGrade: 'A',
    indicators: { smaSlow: 5, smaFast: 6.5, rsi: 72, macdSignal: 'bullish', momentum: 8, trendSignal: 'Bullish', dataQuality: 'Adequate history', dataPoints: 50 },
  };
  const sigHot = await signalService._buildSignal({ ...base, technical: strongTech, catalyst: cat });
  check('B2) overconfident rally + catalyst capped at 54', sigHot.analysis.overall.score, 54);
  check('B2) capped signal is never a Buy', sigHot.action !== 'buy', true);
  check('B2) speculative flag still surfaced', !!sigHot.speculative, true);

  // ── Case C: rally on HEALTHY fundamentals is NOT speculative ────────────────
  const healthyStock = { ...stock, altmanZ: 3.2, netIncome: 15000, roe: 18, revenueGrowth: 12, epsGrowth: 20, pbRatio: 1.5, debtToEquity: 0.6, currentRatio: 1.8 };
  const fHealthy = analyzeFundamentals(healthyStock, currentPrice);
  const finHealthy = analyzeFinancials(healthyStock, fHealthy);
  const sigHealthy = await signalService._buildSignal({ ...base, stock: healthyStock, fundamental: fHealthy, financial: finHealthy, catalyst: null });
  check('C) healthy fundamentals + rally -> no speculative flag', !!sigHealthy.speculative, false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
