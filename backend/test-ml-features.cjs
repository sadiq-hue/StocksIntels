// Verifies the ML feature vector can never be corrupted by a bad indicator.
// A broken Bollinger span, a near-zero SMA denominator and an absurd volume
// ratio previously produced training means of ~1e14 and a sigmoid pinned at 1.0
// for every stock. extractRawIndicators must clamp/neutralise all of them.
process.env.NODE_ENV = 'test';
const ml = require('./mlSignalModel');
const engineConfig = require('./engineConfig');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); }
}

const names = engineConfig.getConfig().ml_features.feature_list || ml.FEATURES;

const feats = ml.extractRawIndicators({
  fundamental: { score: 60, metrics: { peRating: 'N/A', revRating: '-999999999' } },
  technical: {
    score: 60,
    indicators: {
      rsi: 'x', macd: 'NaN', bbLower: 10, bbUpper: 10,
      smaFast: 100, smaSlow: 1e-9, volRatio: 9e12, momentum: 1e15,
    },
  },
  macro: { score: 60 },
  priceHistory: [], currentPrice: 100, volume: 0,
});

check('length matches feature_list', feats.length === names.length);
check('all finite despite garbage input', feats.every(Number.isFinite));
check('all bounded (|v| <= 1e6)', feats.every(v => Math.abs(v) <= 1e6));

// A neutral, well-formed input should stay in a sane range too.
const clean = ml.extractRawIndicators({
  fundamental: { score: 50, metrics: {} },
  technical: { score: 50, indicators: { rsi: 50, macd: 0, bbLower: 90, bbUpper: 110, smaFast: 100, smaSlow: 100, volRatio: 1, momentum: 0 } },
  macro: { score: 50 },
  priceHistory: [], currentPrice: 100, volume: 1000,
});
check('clean input finite', clean.every(Number.isFinite));
check('clean input bounded', clean.every(v => Math.abs(v) <= 1e6));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
