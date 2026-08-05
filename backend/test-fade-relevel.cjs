// Unit verification for the two critical monitor-gate behaviors:
//  1) assessConvictionFade - conviction-fade exit decision
//  2) computeRelevelStop   - stop re-leveling to live market behavior
// Run: node backend/test-fade-relevel.cjs
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { assessConvictionFade, computeRelevelStop, fadeCloseReason, staleThesisDaysFor, isLongTermHold, evaluateScoreClose, fadeCutReached, getLiveWinRate } = require('./signalService');

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

// ─── fadeCloseReason (tightened re-validation) ───────────────────────────────
section('fadeCloseReason (tightened re-validation)');
const now = Date.now();
const DAY = 86400000;

check('long-term hold types are never score-closed',
  [isLongTermHold('Long Term'), isLongTermHold('Long Term Value'), isLongTermHold('Swing Trade')],
  [true, true, false]);

check('staleThesisDaysFor scales by trade type',
  [staleThesisDaysFor('Day Trade'), staleThesisDaysFor('Momentum Trade'), staleThesisDaysFor('Swing Trade'), staleThesisDaysFor('Aggressive Buy')],
  [5, 21, 30, 30]);

// base position: entry 100, target1 110, fresh, swing
const basePos = { action: 'buy', entryPrice: 100, stopLoss: 92, target1: 110, timestamp: now, type: 'Swing Trade' };

check('fresh action still buy -> no fade close',
  fadeCloseReason(basePos, 'buy', true, 102), null);

check('fresh action sell -> no fade close (flip handles it)',
  fadeCloseReason(basePos, 'sell', true, 102), null);

check('fresh hold on young position -> null (needs confirmation)',
  fadeCloseReason(basePos, 'hold', true, 102), null);

check('fresh hold at/above target1 -> profit fade',
  [fadeCloseReason({ ...basePos }, 'hold', true, 110), fadeCloseReason({ ...basePos }, 'hold', true, 114)],
  ['profit fade', 'profit fade']);

check('fresh hold on untrustworthy data -> null even above target1',
  fadeCloseReason(basePos, 'hold', false, 112), null);

check('long-term hold never immediate-close, even stale or above target',
  fadeCloseReason({ ...basePos, type: 'Long Term', timestamp: now - 200 * DAY }, 'hold', true, 112), null);

check('trailing position excluded (trail stop books the exit)',
  fadeCloseReason({ ...basePos, trailing: true }, 'hold', true, 105), null);

check('stale swing (>30d) hold -> stale thesis',
  fadeCloseReason({ ...basePos, timestamp: now - 31 * DAY }, 'hold', true, 105), 'stale thesis');

check('young momentum (<21d) hold -> null',
  fadeCloseReason({ ...basePos, type: 'Momentum Trade', timestamp: now - 10 * DAY }, 'hold', true, 105), null);

check('stale momentum (>21d) hold -> stale thesis',
  fadeCloseReason({ ...basePos, type: 'Momentum Trade', timestamp: now - 25 * DAY }, 'hold', true, 105), 'stale thesis');

check('stale day-trade (>=5d) hold -> stale thesis',
  fadeCloseReason({ ...basePos, type: 'Day Trade', timestamp: now - 5 * DAY }, 'hold', true, 102), 'stale thesis');

check('exactly at threshold counts as stale (age >= threshold)',
  fadeCloseReason({ ...basePos, timestamp: now - 30 * DAY }, 'hold', true, 105), 'stale thesis');

check('no timestamp treated as fresh (age 0)',
  fadeCloseReason({ action: 'buy', entryPrice: 100, target1: 110, type: 'Swing Trade' }, 'hold', true, 102), null);

check('undefined position -> null',
  fadeCloseReason(undefined, 'hold', true, 102), null);

check('profit fade wins over stale (both true, above target)',
  fadeCloseReason({ ...basePos, timestamp: now - 60 * DAY }, 'hold', true, 112), 'profit fade');

// gate interaction: profit fade closes on the FIRST fade reading, no confirmation
let fadeOut = { action: 'buy', fadeCount: 0, entryPrice: 100, target1: 110, timestamp: now, type: 'Swing Trade' };
check('single fade reading at target1 immediately closes (no 2-reading wait)',
  fadeCloseReason(fadeOut, 'hold', true, 112) !== null, true);

// ─── evaluateScoreClose (monitor-gate verdict + min-age guard) ────────────────
section('evaluateScoreClose (min-age guard)');
const T0 = Date.now();
const HOUR = 3600000;
const freshPos = { action: 'buy', entryPrice: 100, stopLoss: 92, target1: 110, timestamp: T0, type: 'Swing Trade', fadeCount: 0 };

// The min-age section pins the boundary to a 1h guard explicitly so the
// mechanism is tested time-agnostically; the production default (6h) is covered
// by the dedicated "default min-age" checks at the end of the section.
check('5-min-old flip reading does NOT close (min-age guard)',
  evaluateScoreClose(freshPos, 'sell', true, 102, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: true, longTermHold: false });

check('5-min-old fade reading does NOT close and does NOT accumulate confirmations',
  evaluateScoreClose(freshPos, 'hold', true, 102, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: true, longTermHold: false });

check('5-min-old 2nd fade reading still suppressed (counter can never pre-load)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 102, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: true, longTermHold: false });

check('5-min-old hold at/above target1 does NOT profit-fade (guard wins)',
  evaluateScoreClose(freshPos, 'hold', true, 112, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: true, longTermHold: false });

check('exactly at the guard boundary is old enough (>= min age)',
  evaluateScoreClose(freshPos, 'sell', true, 102, T0 + HOUR, HOUR),
  { close: 'score flipped', fadeCount: 0, isFade: false, tooYoung: false, longTermHold: false });

check('2h-old flip reading closes immediately',
  evaluateScoreClose(freshPos, 'sell', true, 102, T0 + 2 * HOUR, HOUR),
  { close: 'score flipped', fadeCount: 0, isFade: false, tooYoung: false, longTermHold: false });

check('2h-old first fade reading waits for confirmation (1/2)',
  evaluateScoreClose(freshPos, 'hold', true, 102, T0 + 2 * HOUR, HOUR),
  { close: null, fadeCount: 1, isFade: true, tooYoung: false, longTermHold: false });

check('2h-old 2nd fade on a WINNER (+2%) does NOT close (winners ride)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 102, T0 + 2 * HOUR, HOUR),
  { close: null, fadeCount: 2, isFade: true, tooYoung: false, longTermHold: false });

check('2h-old 2nd fade on a WINNER (+4%) does NOT close (winners ride)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 104, T0 + 2 * HOUR, HOUR),
  { close: null, fadeCount: 2, isFade: true, tooYoung: false, longTermHold: false });

check('2h-old 2nd fade on a LOSER past half-stop (-4%) closes',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 96, T0 + 2 * HOUR, HOUR),
  { close: 'conviction faded', fadeCount: 2, isFade: true, tooYoung: false, longTermHold: false });

check('2h-old hold at/above target1 profit-fades on first reading',
  evaluateScoreClose(freshPos, 'hold', true, 112, T0 + 2 * HOUR, HOUR),
  { close: 'profit fade', fadeCount: 1, isFade: true, tooYoung: false, longTermHold: false });

check('stale position (>30d) + hold -> stale thesis',
  evaluateScoreClose({ ...freshPos, timestamp: T0 - 31 * DAY }, 'hold', true, 105, T0 + 2 * HOUR, HOUR),
  { close: 'stale thesis', fadeCount: 1, isFade: true, tooYoung: false, longTermHold: false });

check('long-term hold type + old + flip -> still no score close (stop/target only)',
  evaluateScoreClose({ ...freshPos, type: 'Long Term' }, 'sell', true, 102, T0 + 2 * HOUR, HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: false, longTermHold: true });

check('undefined position -> no close',
  evaluateScoreClose(undefined, 'hold', true, 102, T0 + 2 * HOUR, HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: true, longTermHold: false });

check('default min-age (6h): 4h-old 2nd fade does NOT close (too young)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 104, T0 + 4 * HOUR),
  { close: null, fadeCount: 0, isFade: false, tooYoung: true, longTermHold: false });

check('default min-age (6h): 7h-old 2nd fade on a WINNER (+4%) does NOT close',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 104, T0 + 7 * HOUR),
  { close: null, fadeCount: 2, isFade: true, tooYoung: false, longTermHold: false });

check('default min-age (6h): 7h-old 2nd fade on a LOSER past half-stop (-4%) closes',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 96, T0 + 7 * HOUR),
  { close: 'conviction faded', fadeCount: 2, isFade: true, tooYoung: false, longTermHold: false });

// ─── fadeCutReached (fair fade cut: losers only, winners ride) ────────────
section('fadeCutReached (fair fade cut - losers only)');
const bandPos = { action: 'buy', entryPrice: 100, stopLoss: 92, target1: 110 };
const bandSell = { action: 'sell', entryPrice: 100, stopLoss: 108, target1: 90 };

check('buy WINNER +2% -> NO fade cut (winners always ride)',
  fadeCutReached(bandPos, 102), false);

check('buy WINNER +10% -> NO fade cut (winners always ride)',
  fadeCutReached(bandPos, 110), false);

check('buy flat 0% -> NO fade cut',
  fadeCutReached(bandPos, 100), false);

check('buy -1% loss (inside band) -> NO cut',
  fadeCutReached(bandPos, 99), false);

check('buy at half stop distance (stop -8%, half -4%) -> cut',
  fadeCutReached(bandPos, 96), true);

check('buy at 40% of stop distance (-3.2%) -> NO cut',
  fadeCutReached(bandPos, 96.8), false);

check('sell WINNER -4% -> NO fade cut (winners always ride)',
  fadeCutReached(bandSell, 96), false);

check('sell at half of +8% stop distance (+4%) -> cut',
  fadeCutReached(bandSell, 104), true);

check('sell +2% -> NO cut',
  fadeCutReached(bandSell, 102), false);

check('no position / zero prices -> false',
  [fadeCutReached(null, 102), fadeCutReached(bandPos, 0), fadeCutReached({ ...bandPos, entryPrice: 0 }, 102)],
  [false, false, false]);

// ─── getLiveWinRate (mark-to-market win rate incl. open positions) ────────────
section('getLiveWinRate (mark-to-market)');
const outcomes = new Map([
  ['AMAT', { action: 'buy', entryPrice: 100, result: null }],
  ['WFC', { action: 'buy', entryPrice: 90, result: null }],
  ['BA', { action: 'buy', entryPrice: 200, result: null }],
  ['DDOG', { action: 'buy', entryPrice: 300, result: 'win' }],        // resolved — ignored by open pass
  ['HOLD', { action: 'hold', entryPrice: 50, result: null }],          // hold — not a monitored position
]);
const prices = new Map([['AMAT', 105], ['WFC', 88], ['BA', 210]]);    // no quote for DDOG/HOLD
const perf = { total: 40, wins: 24, losses: 16, winRate: 60 };

check('resolved-only rate passes through unchanged',
  getLiveWinRate(new Map(), new Map(), perf).resolved,
  { total: 40, wins: 24, losses: 16, winRate: 60 });

const mtm = getLiveWinRate(outcomes, prices, perf);
check('open long above entry counts as win (AMAT 105 vs 100)',
  [mtm.open.wins, mtm.open.losses, mtm.open.total], [2, 1, 3]);

check('open long below entry counts as loss (WFC 88 vs 90)',
  mtm.openPositions.find(p => p.symbol === 'WFC').mtm, 'loss');

check('open long above entry counted as win (BA 210 vs 200)',
  mtm.openPositions.find(p => p.symbol === 'BA').mtm, 'win');

check('resolved + hold positions excluded from open pass',
  mtm.openPositions.some(p => p.symbol === 'DDOG' || p.symbol === 'HOLD'), false);

check('unrealized pct is signed and rounded (AMAT +5%)',
  mtm.openPositions.find(p => p.symbol === 'AMAT').unrealizedPct, 5);

check('combined = resolved + open (24+2 wins / 40+3 total -> 60.5%)',
  [mtm.combined.total, mtm.combined.wins, mtm.combined.winRate], [43, 26, 60.5]);

check('symbol without a live quote is skipped, not guessed',
  getLiveWinRate(new Map([['NOQ', { action: 'buy', entryPrice: 100, result: null }]]), new Map(), perf).open.total, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
