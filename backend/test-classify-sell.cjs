// Verifies the sell classifier's Altman-Z distress gating against the real
// production data shapes that produced the 08:41Z Strong Sell flood.
process.env.NODE_ENV = 'test';
require('dotenv').config();
const signalService = require('./signalService');

const TH = { strong_buy: 68, buy: 55, hold: 30, sell: 18, strong_sell: 0 };

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}: got ${actual}, expected ${expected}`); }
}

// 1. NSE bank (KCB-like): SUPPRESS + healthy profitability => NOT Strong Sell.
//    Real shape: overall=45, fund=50, tech=38, fin=40, sector=Banking, rsi=undefined.
check('bank suppress -> Hold',
  signalService.classifySignalBucket(45, TH, {
    subScores: { fundamental: 50, technical: 38, financial: 40 },
    newsSent: 'negative',
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Banking',
    fundProfile: { roe: 19.8, epsGrowth: 12.1, revenueGrowth: 14.2 },
    regime: 'bull', price: 86, priorScore: null,
  }).signal, 'Hold');

// 2. US bank (JPM-like): SUPPRESS + bullish tech => NOT Strong Sell.
//    Real shape: overall=49, fund=26, tech=75, fin=28, rsi=64.7, macd Bullish, mom +12.6%.
check('US bank suppress + bullish -> Hold',
  signalService.classifySignalBucket(49, TH, {
    subScores: { fundamental: 26, technical: 75, financial: 28 },
    newsSent: null,
    indicators: { rsi: 64.7, macdSignal: 'Bullish', momentum: '12.6%', smaSlow: 327.69 },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Financial',
    fundProfile: { roe: 15, epsGrowth: 15.8, revenueGrowth: 12.2 },
    regime: 'bull', price: 300, priorScore: null,
  }).signal, 'Hold');

// 3. Insurer (BRIT-like): SUPPRESS => excluded from hard trigger => Hold at this profile.
check('insurer suppress -> Hold',
  signalService.classifySignalBucket(46, TH, {
    subScores: { fundamental: 48, technical: 38, financial: 40 },
    newsSent: null,
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Insurance',
    fundProfile: { roe: 12, epsGrowth: 5, revenueGrowth: 8 },
    regime: 'bull', price: 17.4, priorScore: null,
  }).signal, 'Hold');

// 4. Non-financial genuinely distressed (KPLC-like): SUPPRESS + negative roe/eps => Strong Sell.
check('distressed utility suppress -> Strong Sell',
  signalService.classifySignalBucket(30, TH, {
    subScores: { fundamental: 30, technical: 38, financial: 38 },
    newsSent: 'negative',
    indicators: { rsi: 40, macdSignal: 'Bearish', momentum: '-2.0%', smaSlow: 25 },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Utilities',
    fundProfile: { roe: -5.2, epsGrowth: -25.5, revenueGrowth: -2.1 },
    regime: 'bull', price: 20, priorScore: null,
  }).signal, 'Strong Sell');

// 5. Non-financial loss-maker (KQ-like): SUPPRESS + negative roe => Strong Sell.
check('distressed airline suppress -> Strong Sell',
  signalService.classifySignalBucket(42, TH, {
    subScores: { fundamental: 39, technical: 38, financial: 30 },
    newsSent: null,
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Transport',
    fundProfile: { roe: -35, epsGrowth: -40, revenueGrowth: -5 },
    regime: 'bull', price: 5.56, priorScore: null,
  }).signal, 'Strong Sell');

// 5b. SAME distressed non-financial, but a positive deal catalyst (strategic
//     investor / M&A talk) is present: the forced Strong Sell is suppressed and
//     the catalyst-boosted composite decides (overall 42+10=52 -> Hold band,
//     evidence 1.27 < 2 -> Hold). KQ 2026: market priced a $2B strategic-investor
//     deal while financials showed distress.
check('distressed airline + positive catalyst -> Hold (not Strong Sell)',
  signalService.classifySignalBucket(42, TH, {
    subScores: { fundamental: 39, technical: 38, financial: 30 },
    newsSent: null,
    catalyst: { direction: 'positive', type: 'M&A', strength: 2, headline: 'Kenya Airways in strategic investor talks' },
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Transport',
    fundProfile: { roe: -35, epsGrowth: -40, revenueGrowth: -5 },
    regime: 'bull', price: 5.56, priorScore: null,
  }).signal, 'Hold');

// 5c. Distressed non-financial + NEGATIVE catalyst stays Strong Sell (crisis
//     reinforcement doesn't rescue the hard trigger).
check('distressed airline + crisis catalyst -> Strong Sell',
  signalService.classifySignalBucket(42, TH, {
    subScores: { fundamental: 39, technical: 38, financial: 30 },
    newsSent: null,
    catalyst: { direction: 'negative', type: 'Crisis', strength: 2, headline: 'KQ probe widens' },
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Transport',
    fundProfile: { roe: -35, epsGrowth: -40, revenueGrowth: -5 },
    regime: 'bull', price: 5.56, priorScore: null,
  }).signal, 'Strong Sell');

// 5d. Sub-hold composite in the sell band with no catalyst stays Hold (bar 1.2);
//     a negative catalyst tips it to Sell (evidence 0.36 + 1 >= 1.2).
check('sell-band no catalyst -> Hold',
  signalService.classifySignalBucket(20, TH, {
    subScores: { fundamental: 35, technical: 36, financial: 40 },
    newsSent: null,
    indicators: { rsi: 45, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'NEUTRAL' },
    sector: 'Industrials', price: 20, priorScore: null,
  }).signal, 'Hold');
check('sell-band + negative catalyst -> Sell',
  signalService.classifySignalBucket(20, TH, {
    subScores: { fundamental: 35, technical: 36, financial: 40 },
    newsSent: null,
    catalyst: { direction: 'negative', type: 'Crisis', strength: 2, headline: 'fraud probe' },
    indicators: { rsi: 45, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'NEUTRAL' },
    sector: 'Industrials', price: 20, priorScore: null,
  }).signal, 'Sell');

// 6. Non-financial suppressed but PROFITABLE (CAG-like): no hard trigger; evidence < 2 in hold band => Hold.
check('profitable suppressed consumer -> Hold',
  signalService.classifySignalBucket(49, TH, {
    subScores: { fundamental: 22, technical: 75, financial: 38 },
    newsSent: null,
    indicators: { rsi: 52.3, macdSignal: 'Bullish', momentum: '3.2%', smaSlow: 13.83 },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Consumer',
    fundProfile: { roe: 18, epsGrowth: 8, revenueGrowth: 4 },
    regime: 'bull', price: 13, priorScore: null,
  }).signal, 'Hold');

// 6b. Capital-intensive utility (KEGN-like): SUPPRESS + hairline revenue dip
//     (-0.4%), no roe/eps data => NOT corroborated => Hold, NOT Strong Sell.
check('utility suppress with -0.4% revenue -> Hold',
  signalService.classifySignalBucket(46, TH, {
    subScores: { fundamental: 50, technical: 38, financial: 40 },
    newsSent: null,
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Energy',
    fundProfile: { roe: undefined, epsGrowth: undefined, revenueGrowth: -0.4 },
    regime: 'bull', price: 10.75, priorScore: null,
  }).signal, 'Hold');

// 6c. Suppressed consumer with REAL revenue collapse (CAG-like -23.2%) => Strong Sell.
check('suppressed consumer with revenue collapse -> Strong Sell',
  signalService.classifySignalBucket(49, TH, {
    subScores: { fundamental: 22, technical: 75, financial: 38 },
    newsSent: null,
    indicators: { rsi: 52.3, macdSignal: 'Bullish', momentum: '3.2%', smaSlow: 13.83 },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Consumer',
    fundProfile: { roe: undefined, epsGrowth: undefined, revenueGrowth: -23.2 },
    regime: 'bull', price: 13, priorScore: null,
  }).signal, 'Strong Sell');

// 6d. Suppressed media with -69% revenue collapse (SCAN-like) => Strong Sell.
check('suppressed media with -69% revenue -> Strong Sell',
  signalService.classifySignalBucket(44, TH, {
    subScores: { fundamental: 42, technical: 38, financial: 38 },
    newsSent: null,
    indicators: { rsi: undefined, macdSignal: 'No Data', momentum: '0.0%', smaSlow: undefined },
    fundamentals: { altSignal: 'SUPPRESS' },
    sector: 'Media',
    fundProfile: { roe: undefined, epsGrowth: undefined, revenueGrowth: -69.1 },
    regime: 'bull', price: 2.1, priorScore: null,
  }).signal, 'Strong Sell');

// 7. Genuine deep-value Strong Sell via score band still works (no SUPPRESS).
check('deep score Strong Sell',
  signalService.classifySignalBucket(10, TH, {
    subScores: { fundamental: 10, technical: 10, financial: 10 },
    newsSent: null,
    indicators: { rsi: 45, macdSignal: 'Bearish', momentum: '-10%', smaSlow: 100 },
    fundamentals: { altSignal: 'NEUTRAL' },
    sector: 'Technology', price: 80, regime: 'bull', priorScore: 55,
  }).signal, 'Strong Sell');

// 8. Oversold bounce guard still caps Strong Sell at the bottom.
check('oversold Strong Sell downgraded to Sell',
  signalService.classifySignalBucket(10, TH, {
    subScores: { fundamental: 15, technical: 15, financial: 15 },
    newsSent: null,
    indicators: { rsi: 25, macdSignal: 'Bearish', momentum: '-15%', smaSlow: 100 },
    fundamentals: { altSignal: 'NEUTRAL' },
    sector: 'Technology', price: 80, regime: 'bull', priorScore: null,
  }).signal, 'Sell');

// 9. No SUPPRESS, healthy: Hold.
check('healthy stock -> Hold',
  signalService.classifySignalBucket(45, TH, {
    subScores: { fundamental: 60, technical: 55, financial: 50 },
    newsSent: null,
    indicators: { rsi: 55, macdSignal: 'Bullish', momentum: '5%', smaSlow: 100 },
    fundamentals: { altSignal: 'NEUTRAL' },
    sector: 'Technology', price: 100, regime: 'bull', priorScore: null,
  }).signal, 'Hold');

// 10. Country attribution: every NSE symbol (incl. previously-omitted KQ, SCAN,
//     KEGN, BRIT, ...) must resolve to Kenya macro context, never fall through
//     to US. US symbols must stay on US macro.
const { getCountryForSymbol, getMacroScore } = require('./macroService');
const keChecks = ['KQ','SCAN','KEGN','KCB','ABSA','BRIT','DTK','PORT','BKG','NCBA','LBTY','SLAM','OCH','SCOM','KUKZ','KPLC'];
for (const s of keChecks) check(`macro country ${s} -> KE`, getCountryForSymbol(s), 'KE');
for (const s of ['AAPL','BAC','NOC','CAG','MSFT','GS']) check(`macro country ${s} -> US`, getCountryForSymbol(s), 'US');
check('KE macro country label', getMacroScore('KE').country, 'Kenya');
check('US macro country label', getMacroScore('US').country, 'United States');

// 11. NSE price-history service: durable daily bars must unlock technical
//     analysis instead of the fixed "skipped / Insufficient history" 38 score.
const { analyzeTechnicals } = require('./analysisEngine');
const nseHistory = require('./nseHistoryService');

// 11a. toPriceArray with a single bar stays null -> skip path preserved (no fake technicals).
check('toPriceArray 1 bar -> null', nseHistory.toPriceArray([{ close: 5.56 }]), null);

// 11b. toPriceArray with 2+ real bars returns closes + volume/high/low arrays.
const twoBars = nseHistory.toPriceArray([
  { date: '2026-07-31', open: 5.52, high: 5.94, low: 5.44, close: 5.56, volume: 826765 },
  { date: '2026-08-03', open: 5.56, high: 5.62, low: 5.50, close: 5.60, volume: 500000 },
]);
check('toPriceArray 2 bars -> not null', twoBars !== null, true);
check('toPriceArray closes length', twoBars ? twoBars.length : -1, 2);
check('toPriceArray last close', twoBars ? twoBars[twoBars.length - 1] : -1, 5.6);
check('toPriceArray volumes', twoBars ? twoBars.volumes.length : -1, 2);

// 11c. analyzeTechnicals with a real 2-bar NSE series computes (no 'skipped' note),
//     and the insufficient-history penalty is data-driven, not a fixed ignore.
const tech2 = analyzeTechnicals('KQ', 5.6, [5.56, 5.6]);
check('2-bar technicals: not skipped', tech2.indicators.note ? tech2.indicators.note.includes('skipped') : false, false);
check('2-bar technicals: dataPoints', tech2.indicators.dataPoints, 2);
check('2-bar technicals: grade computed', ['A','B','C','D','E','F'].includes(tech2.technicalGrade), true);

// 11d. analyzeTechnicals with null history keeps the skip path (unchanged).
const techNull = analyzeTechnicals('KQ', 5.6, null);
check('null history: still skipped', techNull.indicators.note ? techNull.indicators.note.includes('skipped') : false, true);

// 12. News company-name aliases: headlines that name a company (not its ticker)
//     must still tag the right symbol so sentiment reaches the classifier.
const { extractRelatedStocks } = require('./newsService');
const aliasCases = [
  ['Kenya Airways posts record passenger numbers in Q1', ['KQ']],
  ['Safaricom unveils new M-Pesa lending features', ['SCOM']],
  ['East African Breweries launches new premium brand', ['EABL']],
  ['KCB Group reports strong half-year profit growth', ['KCB']],
  ['Standard Chartered Kenya cuts lending rates', ['SCBK']],
  ['Absa Bank Kenya completes capital raise', ['ABSA']],
  ['Apple suppliers face production cuts as demand weakens', ['AAPL']],
  ['Microsoft Azure growth accelerates after AI push', ['MSFT']],
  ['Tesla deliveries miss estimates amid price cuts', ['TSLA']],
  ['KQ share price falls after profit warning', ['KQ']],
];
for (const [headline, expected] of aliasCases) {
  const actual = extractRelatedStocks(headline).slice().sort();
  const exp = expected.slice().sort();
  check(`alias "${headline.slice(0, 30)}..." -> ${expected.join(',')}`, JSON.stringify(actual) === JSON.stringify(exp), true);
}

// 13. Sentiment history: recency decay and live-wins merge must let quiet days
//     fall back to previous sentiments without letting stale data override fresh.
const sh = require('./sentimentHistoryService');
check('ageWeight age 0', Math.round(sh.ageWeight(0) * 100), 100);
check('ageWeight age 7 (half window)', Math.round(sh.ageWeight(7) * 100), 50);
check('ageWeight floor 0.15 at window', sh.ageWeight(14), 0.15);
check('merge: live wins over history',
  JSON.stringify(sh.mergeSentimentMaps({ KQ: 'positive' }, { KQ: 'negative', SCOM: 'neutral' })),
  JSON.stringify({ KQ: 'positive', SCOM: 'neutral' }));
check('merge: history fills gaps',
  JSON.stringify(sh.mergeSentimentMaps({}, { KQ: 'positive' })),
  JSON.stringify({ KQ: 'positive' }));

// 14. Directed deal-catalyst classification: M&A/strategic-investor/capital
//     news is a positive catalyst; crisis/profit-warning/deal-collapse is a
//     negative catalyst; routine headlines have no catalyst.
const { classifyCatalyst } = require('./newsService');
const catalystCases = [
  ['Kenya Airways in strategic investor talks', 'M&A', 'positive'],
  ['NCBA receives takeover bid from South African firm', 'M&A', 'positive'],
  ['Equity Group in talks to acquire a regional bank', 'M&A', 'positive'],
  ['KCB launches rights issue to raise fresh capital', 'Capital', 'positive'],
  ['Kenya Power secures CBK approval for tariff hike', 'Regulatory', 'positive'],
  ['MP Ndindi Nyoro buys 10.4M Kenya Airways shares', 'Capital', 'positive'],
  ['Kenya Airways load factors near 100% as passenger volumes surge', 'Operational', 'positive'],
  ['Kenya Airways revamped board pushes turnaround narrative', 'Operational', 'positive'],
  ['KQ Lenders Company sells 104.4M shares', null, null],
  ['KQ share price falls after profit warning', 'Crisis', 'negative'],
  ['Safaricom board expands M-Pesa services', null, null],
  ['East African Breweries launches new premium brand', null, null],
];
for (const [headline, type, direction] of catalystCases) {
  const c = classifyCatalyst(headline, '');
  check(`catalyst "${headline.slice(0, 30)}..." -> ${type}/${direction}`,
    `${c.catalyst}/${c.direction}`, `${type}/${direction}`);
}
// NCBA headline must also tag NCBA via company-name alias.
check('catalyst headline tags NCBA',
  extractRelatedStocks('NCBA receives takeover bid from South African firm').includes('NCBA'), true);
check('catalyst headline tags KQ',
  extractRelatedStocks('Kenya Airways in strategic investor talks').includes('KQ'), true);

// ─── Speculative-rally detection ─────────────────────────────────────────────
// KQ 2026: ~Sh3.53 Jan -> ~Sh8.14 Apr (+~130%) on strategic-investor deal talk,
// insider buying (Nyoro filing), lender liquidity and load-factor headlines,
// while FY25 booked a Sh17.2B loss / negative equity. A run-up of that size on
// weak fundamentals must be flagged as speculative (capped at Hold), and must
// NOT fire for a healthy stock with real earnings support.
const { detectSpeculativeRally } = signalService;
const kqRally = Array.from({ length: 50 }, (_, i) => {
  const t = i / 49;
  return 3.53 + (8.14 - 3.53) * t; // linear 3.53 -> 8.14
});
const distressedFundamentals = { score: 25 };  // Weak fundamental score (Altman Z distress suppresses Buy)
const healthyFundamentals = { score: 72 };     // Solid fundamentals - momentum is earnings-backed
const flatSeries = Array.from({ length: 50 }, () => 40);   // No momentum

const spec1 = detectSpeculativeRally(kqRally, distressedFundamentals);
check('speculative rally fires on KQ-style momentum + weak fundamentals',
  !!spec1 && spec1.momentum >= 60, true);
check('speculative rally exposes momentum % and lookback',
  !!spec1 && spec1.lookback === 40 && spec1.momentum > 0, true);

check('no speculative flag when fundamentals are healthy',
  detectSpeculativeRally(kqRally, healthyFundamentals), null);

check('no speculative flag on flat price history',
  detectSpeculativeRally(flatSeries, distressedFundamentals), null);

check('no speculative flag on too-short history',
  detectSpeculativeRally([10, 11, 12, 13], distressedFundamentals), null);

// ─── Sell resolution horizon (evaluateSellAtHorizon) ───
// Bounded-resolution fallback: sells that never crossed a decisive move or
// benchmark lag must resolve by total relative performance after the horizon
// instead of pending forever. Within tolerance on both legs → neutral.
const { evaluateSellAtHorizon } = signalService;
const horiz = (entry, px, bench, benchPrice = 100) =>
  evaluateSellAtHorizon({ price: entry, benchPrice }, px, bench);

check('horizon: flat stock / flat bench -> neutral',
  JSON.stringify(horiz(100, 100, 0)), JSON.stringify({ resolved: true, correct: null, actualReturn: 0 }));

check('horizon: stock -3% -> correct (exit gate)',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 97, 0).correct, true);

check('horizon: stock -1.5% vs flat bench -> correct (underperformed)',
  horiz(100, 98.5, 0).correct, true);

check('horizon: stock +1.5% vs flat bench -> incorrect (outperformed)',
  horiz(100, 101.5, 0).correct, false);

check('horizon: flat stock vs bench -2% -> incorrect (outperformed falling market)',
  horiz(100, 100, -0.02).correct, false);

check('horizon: flat stock vs bench +2% -> correct (underperformed rising market)',
  horiz(100, 100, 0.02).correct, true);

check('horizon: stock +3% vs bench +1% -> incorrect (beat market by 2%)',
  horiz(100, 103, 0.01).correct, false);

check('horizon: stock +4% vs bench +8% -> correct (rose but lagged by >3%)',
  horiz(100, 104, 0.08).correct, true);

check('horizon: no bench, stock -4% -> correct',
  evaluateSellAtHorizon({ price: 100, benchPrice: null }, 96, null).correct, true);

check('horizon: no bench, stock +4% -> incorrect',
  evaluateSellAtHorizon({ price: 100, benchPrice: null }, 104, null).correct, false);

check('horizon: no bench, stock -0.5% -> neutral',
  evaluateSellAtHorizon({ price: 100, benchPrice: null }, 99.5, null).correct, null);

// ─── Benchmark-relative decisive-move refinement (evaluateSellRelative) ───
// The absolute evaluator must NOT short-circuit a decisive up-move when a
// benchmark was captured: a stock that rose but lagged its market validates
// the exit/avoid call. evaluateSellRelative owns that decision.
const { evaluateSellRelative } = signalService;
const rel = (entry, px, bench, benchPrice = 100) =>
  evaluateSellRelative({ price: entry, benchPrice }, px, bench);

check('relative: stock -4% vs bench -1% -> correct (fell, exit gate)',
  rel(100, 96, -0.01).correct, true);

check('relative: stock +4% vs bench +8% -> correct (rose but lagged by >3%)',
  rel(100, 104, 0.08).correct, true);

check('relative: stock +4% vs bench +2% -> deferred (beat by 2% < relMove 3%, no day-one verdict)',
  rel(100, 104, 0.02).resolved, false);

check('relative: stock +4% with no bench -> incorrect (absolute fallback)',
  evaluateSellRelative({ price: 100, benchPrice: null }, 104, null).correct, false);

check('relative: knife-edge +2.1% vs bench +0.5% -> deferred (tick noise, no verdict)',
  rel(100, 102.1, 0.005).resolved, false);

check('relative: +2.5% vs bench +0.5% -> deferred (lag -2% < relMove 3%)',
  rel(100, 102.5, 0.005).resolved, false);

check('relative: decisive rise but bench feed hiccuped -> deferred, not wrong by guess',
  evaluateSellRelative({ price: 100, benchPrice: 100 }, 104, null).resolved, false);

check('relative: stock +2.5% vs bench +5.5% -> correct (lag exactly 3%)',
  rel(100, 102.5, 0.055).correct, true);

check('relative: stock +2% vs bench +5% -> correct (decisive rise but lagged)',
  rel(100, 102, 0.05).correct, true);

check('relative: stock +4% vs bench +1% -> incorrect (beat market by 3% = relMove)',
  rel(100, 104, 0.01).correct, false);

// The deferred knife-edge cases land a verdict at the 5-day horizon.
check('horizon: deferred +4% vs bench +2% -> incorrect after horizon',
  horiz(100, 104, 0.02).correct, false);

check('horizon: deferred +2.1% vs bench +0.5% -> incorrect (beat market over horizon)',
  horiz(100, 102.1, 0.005).correct, false);

check('horizon: +2.5% vs bench +2.0% -> neutral (within tolerance 1%)',
  horiz(100, 102.5, 0.02).correct, null);

check('horizon: +4% vs bench +4.5% -> neutral (within tolerance 1%)',
  horiz(100, 104, 0.045).correct, null);

check('horizon: bench captured but live bench missing -> neutral (cannot judge)',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 104, null).correct, null);

// ─── Live-feed fundamental sanitization (sanitizeLiveFundamentals) ───
// The financial reports feed sometimes ships misaligned-quarter artifacts (e.g.
// AAPL "revenue -38.7%" / "D/E 6.08") that would manufacture sell evidence.
const { sanitizeLiveFundamentals } = signalService;

check('sanitize: garbage live revenue falls back to baseline',
  sanitizeLiveFundamentals({ revenueGrowth: 8.2, debtToEquity: 1.5 }, { revenueGrowth: -38.7, debtToEquity: 6.08 }).revenueGrowth, 8.2);

check('sanitize: garbage live D/E falls back to baseline',
  sanitizeLiveFundamentals({ revenueGrowth: 8.2, debtToEquity: 1.5 }, { revenueGrowth: -38.7, debtToEquity: 6.08 }).debtToEquity, 1.5);

check('sanitize: sane live values pass through unchanged',
  JSON.stringify([sanitizeLiveFundamentals({ revenueGrowth: 8.2, debtToEquity: 1.5 }, { revenueGrowth: 12.5, debtToEquity: 1.8 }).revenueGrowth, sanitizeLiveFundamentals({ revenueGrowth: 8.2, debtToEquity: 1.5 }, { revenueGrowth: 12.5, debtToEquity: 1.8 }).debtToEquity]),
  JSON.stringify([12.5, 1.8]));

check('sanitize: no baseline + implausible live revenue -> dropped to null',
  sanitizeLiveFundamentals({}, { revenueGrowth: -84 }).revenueGrowth, null);

check('sanitize: no baseline + plausible live revenue passes',
  sanitizeLiveFundamentals({}, { revenueGrowth: 120.5 }).revenueGrowth, 120.5);

check('sanitize: D/E beyond 5 with no baseline -> dropped to null',
  sanitizeLiveFundamentals({}, { debtToEquity: 6.08 }).debtToEquity, null);

check('sanitize: absent live metrics keep baseline untouched',
  sanitizeLiveFundamentals({ revenueGrowth: 8.2, debtToEquity: 1.5 }, {}).revenueGrowth, 8.2);

check('sanitize: null live input returns stock unchanged',
  sanitizeLiveFundamentals({ revenueGrowth: 8.2 }, null).revenueGrowth, 8.2);

// ─── Absolute evaluator dispatch (evaluateForwardPrediction) ───
// Decisive up-move WITH a benchmark must stay pending so the benchmark-relative
// refinement can run; WITHOUT a benchmark it resolves incorrect immediately.
const { evaluateForwardPrediction } = signalService;
const fwd = (entry, px, benchPrice) =>
  evaluateForwardPrediction({ action: 'sell', price: entry, benchPrice }, px);

check('fwd: sell rose 4% with bench captured -> pending (defer to relative)',
  JSON.stringify(fwd(100, 104, 100)), JSON.stringify({ status: 'pending' }));

check('fwd: sell rose 4% with no bench -> resolved incorrect',
  fwd(100, 104, null).status, 'resolved');

check('fwd: sell fell 4% -> resolved correct',
  fwd(100, 96, 100).status, 'resolved');

check('fwd: sell moved 1% -> pending',
  fwd(100, 101, 100).status, 'pending');

// ─── NSE-aware sell thresholds (sellThresholdsFor + wide bands) ───
// Low-float volatile Kenyan names get wider decisive-move, relative-lag and
// horizon-tolerance bands than liquid US names, so a 2-5% pop on a flat NSE20
// resolves neutral instead of a wrong-sell (that pop is ordinary NSE noise).
const { sellThresholdsFor } = signalService;
const NSE_TH = sellThresholdsFor('SCAN');
const US_TH = sellThresholdsFor('PFE');

check('nse: SCAN gets NSE bands',
  JSON.stringify(NSE_TH),
  JSON.stringify({ exitMove: 0.06, relMove: 0.08, horizonTolerance: 0.06 }));

check('nse: PFE keeps US bands',
  JSON.stringify(US_TH),
  JSON.stringify({ exitMove: 0.02, relMove: 0.03, horizonTolerance: 0.01 }));

check('nse: unknown symbol defaults to US bands',
  JSON.stringify(sellThresholdsFor('ZZZZZ')),
  JSON.stringify(US_TH));

// SCAN-style case: +3.8% pop, flat NSE20 → neutral at horizon, not wrong.
check('nse: +3.8% pop vs flat NSE20 -> neutral at horizon',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 103.8, 0, NSE_TH).correct, null);

check('nse: +4.7% pop vs flat NSE20 -> neutral at horizon',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 104.7, 0, NSE_TH).correct, null);

check('nse: +2.5% pop vs flat NSE20 -> neutral at horizon',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 102.5, 0, NSE_TH).correct, null);

// Same case under US bands still resolves wrong (proves the bands differ).
check('nse: same +3.8% pop under US bands -> wrong at horizon',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 103.8, 0, US_TH).correct, false);

// NSE bands still call a real underperformer correct and an outlier wrong.
check('nse: -7% drop vs flat NSE20 -> correct (exit gate)',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 93, 0, NSE_TH).correct, true);

check('nse: +9% pop vs flat NSE20 -> wrong (decisive beat)',
  evaluateSellAtHorizon({ price: 100, benchPrice: 100 }, 109, 0, NSE_TH).correct, false);

check('nse: +5% pop vs NSE20 +9% -> unresolved (sideways, lag 4% < relMove 8%)',
  evaluateSellRelative({ price: 100, benchPrice: 100 }, 105, 0.09, NSE_TH).resolved, false);

check('nse: +7% pop vs NSE20 +16% -> correct (rose but lagged by 9% >= relMove 8%)',
  evaluateSellRelative({ price: 100, benchPrice: 100 }, 107, 0.16, NSE_TH).correct, true);

check('nse: +7% pop with no bench still wrong (absolute fallback, exitMove 6%)',
  evaluateSellRelative({ price: 100, benchPrice: null }, 107, null, NSE_TH).correct, false);

check('nse: fwd dispatch defers +5% pop WITH bench -> pending',
  evaluateForwardPrediction({ action: 'sell', price: 100, benchPrice: 100 }, 105, NSE_TH).status, 'pending');

check('nse: fwd dispatch resolves +7% pop with no bench -> wrong',
  evaluateForwardPrediction({ action: 'sell', price: 100, benchPrice: null }, 107, NSE_TH).status, 'resolved');

// ─── Sell audit dedup (dedupeSellPredictions) ───
// Re-emissions of the same persistent sell must count once per call, while a
// genuinely new call (fresh unresolved row created after a resolution) stays.
const { dedupeSellPredictions } = signalService;
const T = '2026-08-03T07:18:00.000Z';
const row = (id, symbol, price, resolved, resolvedAt) => ({
  id, symbol, price, resolved: !!resolved,
  resolved_at: resolved ? resolvedAt : null,
});
const dedup = rows => dedupeSellPredictions(rows).map(r => r.id).join(',');

// 4 resolved re-emissions of the same SCAN call (ms apart, same minute) -> 1.
check('dedup: 4 resolved re-emissions collapse to 1',
  dedup([
    row(1, 'SCAN', 2.10, true, '2026-08-03T07:18:39.612Z'),
    row(2, 'SCAN', 2.10, true, '2026-08-03T07:18:39.763Z'),
    row(3, 'SCAN', 2.10, true, '2026-08-03T07:18:39.838Z'),
    row(4, 'SCAN', 2.10, true, '2026-08-03T07:18:39.914Z'),
  ]), '1');

// Resolutions in different minutes are different calls -> kept separate.
check('dedup: resolved calls in different minutes stay separate',
  dedup([
    row(1, 'SCAN', 2.10, true, '2026-08-03T07:18:00.000Z'),
    row(2, 'SCAN', 2.10, true, '2026-08-03T13:33:00.000Z'),
  ]), '1,2');

// Resolved AND a fresh unresolved call for the same symbol+price both count.
check('dedup: resolved + fresh pending call both kept',
  dedup([
    row(1, 'SCAN', 2.10, true, '2026-08-03T07:18:39.612Z'),
    row(5, 'SCAN', 2.10, false, null),
  ]), '1,5');

// 5 pending re-emissions of PFE at the same price -> latest kept (1 row).
check('dedup: 5 pending re-emissions collapse to latest',
  dedup([
    row(9, 'PFE', 25.01, false, null),
    row(8, 'PFE', 25.01, false, null),
    row(7, 'PFE', 25.01, false, null),
    row(6, 'PFE', 25.01, false, null),
    row(5, 'PFE', 25.01, false, null),
  ]), '9');

// Same symbol pending at different ref prices = different calls.
check('dedup: pending at different ref prices stay separate',
  dedup([
    row(1, 'KEY', 22.59, false, null),
    row(2, 'KEY', 22.65, false, null),
  ]), '1,2');

// Different symbols never collide, even at the same price + resolution minute.
check('dedup: different symbols never collide',
  dedup([
    row(1, 'SCAN', 2.10, true, '2026-08-03T07:18:39.612Z'),
    row(2, 'KQ', 2.10, true, '2026-08-03T07:18:39.612Z'),
  ]), '1,2');

check('dedup: empty input -> empty output',
  dedup([]), '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
