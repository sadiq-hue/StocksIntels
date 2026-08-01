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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
