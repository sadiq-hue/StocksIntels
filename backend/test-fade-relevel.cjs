// Unit verification for the two critical monitor-gate behaviors:
//  1) assessConvictionFade - conviction-fade exit decision
//  2) computeRelevelStop   - stop re-leveling to live market behavior
// Run: node backend/test-fade-relevel.cjs
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { assessConvictionFade, computeRelevelStop } = require('./signalService');

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }

// ─── assessConvictionFade ──────────────────────────────────────────────────
section('assessConvictionFade');

check('buy + fresh hold + ok -> fade count 1, not confirmed',
  assessConvictionFade('buy', 'hold', true, 0),
  { isFade: true, fadeCount: 1, fadeConfirmed: false });

check('buy + fresh hold, 2nd consecutive -> confirmed',
  assessConvictionFade('buy', 'hold', true, 1),
  { isFade: true, fadeCount: 2, fadeConfirmed: true });

check('buy + fresh hold, 3rd consecutive -> stays confirmed',
  assessConvictionFade('buy', 'hold', true, 2),
  { isFade: true, fadeCount: 3, fadeConfirmed: true });

check('buy + fresh hold on UNTRUSTWORTHY data -> not a fade (count resets)',
  assessConvictionFade('buy', 'hold', false, 1),
  { isFade: false, fadeCount: 0, fadeConfirmed: false });

check('buy + fresh buy -> not a fade (count resets)',
  assessConvictionFade('buy', 'buy', true, 1),
  { isFade: false, fadeCount: 0, fadeConfirmed: false });

check('buy + fresh sell -> not a fade (flip handled by isFlip, not fade)',
  assessConvictionFade('buy', 'sell', true, 1),
  { isFade: false, fadeCount: 0, fadeConfirmed: false });

check('sell + fresh hold -> fade (symmetric)',
  assessConvictionFade('sell', 'hold', true, 0),
  { isFade: true, fadeCount: 1, fadeConfirmed: false });

check('hold + fresh hold -> not a fade (position never monitored as hold)',
  assessConvictionFade('hold', 'hold', true, 1),
  { isFade: false, fadeCount: 0, fadeConfirmed: false });

check('recovery after one fade reading resets the counter',
  assessConvictionFade('buy', 'hold', true, 0).fadeCount === 1
    && assessConvictionFade('buy', 'buy', true, 1).fadeCount === 0
    && assessConvictionFade('buy', 'hold', true, 0).fadeCount === 1,
  true);

check('undefined prevFadeCount treated as 0',
  assessConvictionFade('buy', 'hold', true, undefined),
  { isFade: true, fadeCount: 1, fadeConfirmed: false });

// ─── computeRelevelStop ────────────────────────────────────────────────────
section('computeRelevelStop');
// position: entry 100, stop 92, target1 110  => targetDist 10
const pos = { entryPrice: 100, stopLoss: 92, target1: 110 };

check('tighter ATR stop ratchets up (92 -> 95), changed, progress 20',
  computeRelevelStop(pos, 102, 95),
  { newStop: 95, changed: true, progress: 20 });

check('looser ATR stop never loosens (92 kept), unchanged',
  computeRelevelStop(pos, 102, 90),
  { newStop: 92, changed: false, progress: 20 });

check('progress >= 50 ratchets stop to breakeven (entry 100)',
  computeRelevelStop(pos, 105, 94),
  { newStop: 100, changed: true, progress: 50 });

check('progress >= 75 locks 50% of open gain (entry + 4 = 104)',
  computeRelevelStop(pos, 108, 97),
  { newStop: 104, changed: true, progress: 80 });

check('progress beyond target keeps the fresher ATR stop (106.4) over the 106 lock floor',
  computeRelevelStop(pos, 112, 106.4),
  { newStop: 106.4, changed: true, progress: 120 });

check('price at/below stop -> not a change',
  computeRelevelStop(pos, 91, 92),
  { newStop: 92, changed: false, progress: -90 });

check('null fresh stop -> no change',
  computeRelevelStop(pos, 102, null),
  { newStop: 92, changed: false, progress: 0 });

check('invalid geometry (target1 <= entry) -> no change',
  computeRelevelStop({ entryPrice: 100, stopLoss: 92, target1: 95 }, 102, 95),
  { newStop: 92, changed: false, progress: 0 });

check('undefined position -> no change',
  computeRelevelStop(undefined, 102, 95),
  { newStop: undefined, changed: false, progress: 0 });

check('fresh stop equal to current stop -> no change',
  computeRelevelStop(pos, 102, 92),
  { newStop: 92, changed: false, progress: 20 });

check('result is rounded to 2 decimals',
  computeRelevelStop(pos, 102.5, 94.444),
  { newStop: 94.44, changed: true, progress: 25 });

check('entry <= 0 guard -> no change',
  computeRelevelStop({ entryPrice: 0, stopLoss: 92, target1: 110 }, 102, 95),
  { newStop: 92, changed: false, progress: 0 });

check('new stop must stay below the market price (92.5 < 93 ok, tightened)',
  computeRelevelStop(pos, 93, 92.5),
  { newStop: 92.5, changed: true, progress: -70 });

// ─── gate interaction invariants ───────────────────────────────────────────
section('gate interaction invariants');

// A fade must be confirmed twice, then the close branch only executes on open market.
let out = { action: 'buy', fadeCount: undefined };
for (let i = 1; i <= 3; i++) {
  const r = assessConvictionFade(out.action, 'hold', true, out.fadeCount);
  out.fadeCount = r.fadeCount;
  check(`cycle ${i}: fadeCount=${out.fadeCount} confirmed=${r.fadeConfirmed}`,
    [r.fadeCount, r.fadeConfirmed],
    [i, i >= 2]);
}
const closeAllowed = out.fadeCount >= 2;
check('close allowed only after confirmation threshold', closeAllowed, true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
