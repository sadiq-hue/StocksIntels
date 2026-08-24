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

const HOUR = 3600000;
const DAY = 86400000;
const NOW0 = Date.parse('2026-08-03T00:00:00Z');       // fixed "today" (UTC midnight)
const T0 = Date.parse('2026-08-01T00:00:00Z');         // fixed position-entry time
const DEEP = 40;                                       // deep fade score (<= FADE_DEEP_SCORE)
const MARGINAL = 48;                                   // marginal fade score (43..54)

// ─── assessConvictionFade ──────────────────────────────────────────────────
section('assessConvictionFade');

check('buy + fresh hold + ok -> deep fade count 1, not confirmed (needs 3)',
  assessConvictionFade('buy', 'hold', true, 0, null, NOW0, DEEP),
  { isFade: true, fadeCount: 1, fadeConfirmed: false, fadeFirstSeen: NOW0, required: 3 });

check('buy + fresh hold, 2nd consecutive deep reading same day -> count 2, not confirmed',
  assessConvictionFade('buy', 'hold', true, 1, NOW0, NOW0 + 2 * HOUR, DEEP),
  { isFade: true, fadeCount: 2, fadeConfirmed: false, fadeFirstSeen: NOW0, required: 3 });

check('buy + fresh hold, 3rd deep reading ACROSS a day boundary -> confirmed',
  assessConvictionFade('buy', 'hold', true, 2, NOW0 - DAY, NOW0, DEEP),
  { isFade: true, fadeCount: 3, fadeConfirmed: true, fadeFirstSeen: NOW0 - DAY, required: 3 });

check('same-day 3rd deep reading is NOT confirmed (streak must span two days)',
  assessConvictionFade('buy', 'hold', true, 2, NOW0, NOW0 + 2 * HOUR, DEEP),
  { isFade: true, fadeCount: 3, fadeConfirmed: false, fadeFirstSeen: NOW0, required: 3 });

check('MARGINAL fade (score 48) at count 3 still not confirmed (needs 4)',
  assessConvictionFade('buy', 'hold', true, 2, NOW0 - DAY, NOW0, MARGINAL),
  { isFade: true, fadeCount: 3, fadeConfirmed: false, fadeFirstSeen: NOW0 - DAY, required: 4 });

check('MARGINAL fade at count 4 across days -> confirmed',
  assessConvictionFade('buy', 'hold', true, 3, NOW0 - DAY, NOW0, MARGINAL),
  { isFade: true, fadeCount: 4, fadeConfirmed: true, fadeFirstSeen: NOW0 - DAY, required: 4 });

check('buy + fresh hold on UNTRUSTWORTHY data -> not a fade (count resets)',
  assessConvictionFade('buy', 'hold', false, 1, NOW0, NOW0, DEEP),
  { isFade: false, fadeCount: 0, fadeConfirmed: false, fadeFirstSeen: null, required: 3 });

check('buy + fresh buy -> not a fade (count resets)',
  assessConvictionFade('buy', 'buy', true, 1, NOW0, NOW0, DEEP),
  { isFade: false, fadeCount: 0, fadeConfirmed: false, fadeFirstSeen: null, required: 3 });

check('buy + fresh sell -> not a fade (flip handled by isFlip, not fade)',
  assessConvictionFade('buy', 'sell', true, 1, NOW0, NOW0, DEEP),
  { isFade: false, fadeCount: 0, fadeConfirmed: false, fadeFirstSeen: null, required: 3 });

check('sell + fresh hold -> fade (symmetric)',
  assessConvictionFade('sell', 'hold', true, 0, null, NOW0, DEEP),
  { isFade: true, fadeCount: 1, fadeConfirmed: false, fadeFirstSeen: NOW0, required: 3 });

check('hold + fresh hold -> not a fade (position never monitored as hold)',
  assessConvictionFade('hold', 'hold', true, 1, NOW0, NOW0, DEEP),
  { isFade: false, fadeCount: 0, fadeConfirmed: false, fadeFirstSeen: null, required: 3 });

check('recovery after one fade reading resets the counter and firstSeen',
  assessConvictionFade('buy', 'hold', true, 0).fadeCount === 1
    && assessConvictionFade('buy', 'buy', true, 1).fadeCount === 0
    && assessConvictionFade('buy', 'buy', true, 1).fadeFirstSeen === null
    && assessConvictionFade('buy', 'hold', true, 0).fadeCount === 1,
  true);

const undef = assessConvictionFade('buy', 'hold', true, undefined);
check('undefined prevFadeCount treated as 0 (count 1, seeds firstSeen)',
  [undef.fadeCount, undef.isFade, undef.fadeFirstSeen != null], [1, true, true]);

check('fade without a fresh score defaults to the harder marginal count (4)',
  assessConvictionFade('buy', 'hold', true, 0, null, NOW0).required, 4);

// ─── computeRelevelStop ────────────────────────────────────────────────────
section('computeRelevelStop');
// position: entry 100, stop 82 (an 18% stop — typical ATR-scaled width above the
// 15% floor), target1 110  => targetDist 10. The pre-lock cap sits at
// entry - max(2%, MIN_STOP_PCT*100=15%, freshStopDist*0.5) = 85 in these cases,
// so pre-lock re-leveling can ratchet the stop up to (but never above) the 15%
// floor, and the lock phase (>= 75% progress) starts banking half the gain.
const pos = { entryPrice: 100, stopLoss: 82, target1: 110 };

check('tighter ATR stop ratchets up (82 -> 85), capped at the 15% floor, changed, progress 20',
  computeRelevelStop(pos, 102, 95),
  { newStop: 85, changed: true, progress: 20 });

check('looser ATR stop never loosens (82 kept), unchanged',
  computeRelevelStop(pos, 102, 80),
  { newStop: 82, changed: false, progress: 20 });

check('progress 50 (pre-lock) tightens to the floor (85) but stays BELOW entry (no breakeven ratchet)',
  computeRelevelStop(pos, 105, 94),
  { newStop: 85, changed: true, progress: 50 });

check('progress >= 75 locks 50% of open gain (entry + 4 = 104)',
  computeRelevelStop(pos, 108, 97),
  { newStop: 104, changed: true, progress: 80 });

check('progress beyond target keeps the fresher ATR stop (106.4) over the 106 lock floor',
  computeRelevelStop(pos, 112, 106.4),
  { newStop: 106.4, changed: true, progress: 120 });

check('price at/below stop -> not a change',
  computeRelevelStop(pos, 80, 75),
  { newStop: 82, changed: false, progress: -200 });

check('null fresh stop -> no change',
  computeRelevelStop(pos, 102, null),
  { newStop: 82, changed: false, progress: 0 });

check('invalid geometry (target1 <= entry) -> no change',
  computeRelevelStop({ entryPrice: 100, stopLoss: 82, target1: 95 }, 102, 95),
  { newStop: 82, changed: false, progress: 0 });

check('undefined position -> no change',
  computeRelevelStop(undefined, 102, 95),
  { newStop: undefined, changed: false, progress: 0 });

check('fresh stop equal to current stop -> no change',
  computeRelevelStop(pos, 102, 82),
  { newStop: 82, changed: false, progress: 20 });

check('lock result is rounded to 2 decimals (104.25)',
  computeRelevelStop(pos, 108.5, 97),
  { newStop: 104.25, changed: true, progress: 85 });

check('entry <= 0 guard -> no change',
  computeRelevelStop({ entryPrice: 0, stopLoss: 82, target1: 110 }, 102, 95),
  { newStop: 82, changed: false, progress: 0 });

check('pre-lock stop never ratchets above entry minus the 15% floor (fresh 99 capped at 85)',
  computeRelevelStop(pos, 106, 99),
  { newStop: 85, changed: true, progress: 60 });

check('extreme-volatility fresh stop is still held at the 15% floor pre-lock (fresh 95 -> cap 85)',
  computeRelevelStop(pos, 107, 95),
  { newStop: 85, changed: true, progress: 70 });

check('calm name with a nearly-breakeven fresh stop is held at the 15% floor (cap 85)',
  computeRelevelStop(pos, 102, 99.5),
  { newStop: 85, changed: true, progress: 20 });

check('the +10% rally then dip-to-entry scenario keeps the stop below entry (85), position alive',
  computeRelevelStop(pos, 100, 98),
  { newStop: 85, changed: true, progress: 0 });

check('stop already at the floor does not churn when price retraces to entry',
  computeRelevelStop({ entryPrice: 100, stopLoss: 85, target1: 110 }, 100, 97),
  { newStop: 85, changed: false, progress: 0 });

check('lock at exactly 75% progress banks half the open gain (entry + 3.75 = 103.75)',
  computeRelevelStop(pos, 107.5, 97),
  { newStop: 103.75, changed: true, progress: 75 });

check('a stop raised past the cap by a prior lock is never loosened on retrace',
  computeRelevelStop({ entryPrice: 100, stopLoss: 104, target1: 110 }, 101, 96),
  { newStop: 104, changed: false, progress: 10 });

check('new stop must stay below the market price (85 < 93 ok, tightened)',
  computeRelevelStop(pos, 93, 92.5),
  { newStop: 85, changed: true, progress: -70 });

// ─── gate interaction invariants ───────────────────────────────────────────
section('gate interaction invariants');

// A fade must be confirmed (count threshold AND a day-boundary span), then the
// close branch only executes on open market.
let out = { action: 'buy', fadeCount: 0, fadeFirstSeen: null };
const dayA = NOW0 - 2 * DAY; // streak starts two days before NOW0
let r = assessConvictionFade(out.action, 'hold', true, out.fadeCount, out.fadeFirstSeen, dayA + HOUR, DEEP);
out.fadeCount = r.fadeCount; out.fadeFirstSeen = r.fadeFirstSeen;
check('day -2 morning: first deep reading, count 1, seeds firstSeen, not confirmed',
  [r.fadeCount, r.fadeConfirmed, r.fadeFirstSeen], [1, false, dayA + HOUR]);

r = assessConvictionFade(out.action, 'hold', true, out.fadeCount, out.fadeFirstSeen, dayA + 3 * HOUR, DEEP);
out.fadeCount = r.fadeCount; out.fadeFirstSeen = r.fadeFirstSeen;
check('day -2 afternoon: same-day 2nd reading, count 2, still not confirmed',
  [r.fadeCount, r.fadeConfirmed], [2, false]);

r = assessConvictionFade(out.action, 'hold', true, out.fadeCount, out.fadeFirstSeen, NOW0, DEEP);
out.fadeCount = r.fadeCount; out.fadeFirstSeen = r.fadeFirstSeen;
check('day 0: 3rd reading across a day boundary -> confirmed',
  [r.fadeCount, r.fadeConfirmed], [3, true]);

const closeAllowed = out.fadeCount >= 3;
check('close allowed only after confirmation threshold (count 3 + day span)', closeAllowed, true);

// ─── fadeCloseReason (tightened re-validation) ───────────────────────────────
section('fadeCloseReason (tightened re-validation)');
const now = Date.now();

check('long-term hold types are never score-closed',
  [isLongTermHold('Long Term'), isLongTermHold('Long Term Value'), isLongTermHold('Swing Trade')],
  [true, true, false]);

check('staleThesisDaysFor scales by trade type (Long Term is never stale)',
  [staleThesisDaysFor('Day Trade'), staleThesisDaysFor('Momentum Trade'), staleThesisDaysFor('Swing Trade'), staleThesisDaysFor('Aggressive Buy'), staleThesisDaysFor('Long Term')],
  [5, 21, 30, 30, Infinity]);

check('staleThesisDaysFor stretches for a wide target (RR 6 -> swing 30 -> 60)',
  [staleThesisDaysFor('Swing Trade', { entryPrice: 100, stopLoss: 95, target1: 130 }),
   staleThesisDaysFor('Momentum Trade', { entryPrice: 100, stopLoss: 95, target1: 130 }),
   staleThesisDaysFor('Day Trade', { entryPrice: 100, stopLoss: 95, target1: 130 })],
  [60, 42, 10]);

check('staleThesisDaysFor keeps the type base when RR is average (RR 1.25 -> swing 30)',
  staleThesisDaysFor('Swing Trade', { entryPrice: 100, stopLoss: 92, target1: 110 }), 30);

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

check('wide-target swing (window 60) NOT stale at 31d',
  fadeCloseReason({ ...basePos, entryPrice: 100, stopLoss: 95, target1: 130, timestamp: now - 31 * DAY }, 'hold', true, 105), null);

check('wide-target swing (window 60) stale past its stretched window',
  fadeCloseReason({ ...basePos, entryPrice: 100, stopLoss: 95, target1: 130, timestamp: now - 61 * DAY }, 'hold', true, 105), 'stale thesis');

check('no timestamp treated as fresh (age 0)',
  fadeCloseReason({ action: 'buy', entryPrice: 100, target1: 110, type: 'Swing Trade' }, 'hold', true, 102), null);

check('undefined position -> null',
  fadeCloseReason(undefined, 'hold', true, 102), null);

check('profit fade wins over stale (both true, above target)',
  fadeCloseReason({ ...basePos, timestamp: now - 60 * DAY }, 'hold', true, 112), 'profit fade');

// gate interaction: profit fade closes on the FIRST fade reading, no confirmation
let fadeOut = { action: 'buy', fadeCount: 0, entryPrice: 100, target1: 110, timestamp: now, type: 'Swing Trade' };
check('single fade reading at target1 immediately closes (no multi-reading wait)',
  fadeCloseReason(fadeOut, 'hold', true, 112) !== null, true);

// ─── evaluateScoreClose (monitor-gate verdict + min-age guard) ────────────────
section('evaluateScoreClose (min-age guard)');
const now2d = T0 + 2 * DAY + 2 * HOUR; // 2 days + 2h after entry
const freshPos = { action: 'buy', entryPrice: 100, stopLoss: 85, target1: 110, timestamp: T0, type: 'Swing Trade', fadeCount: 0, fadeFirstSeen: null };

// The min-age section pins the boundary to a 1h guard explicitly so the
// mechanism is tested time-agnostically; the production default (6h) is covered
// by the dedicated "default min-age" checks at the end of the section.
check('5-min-old flip reading does NOT close (min-age guard)',
  evaluateScoreClose(freshPos, 'sell', true, 102, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: true, longTermHold: false });

check('5-min-old fade reading does NOT close and does NOT accumulate confirmations',
  evaluateScoreClose(freshPos, 'hold', true, 102, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: true, longTermHold: false });

check('5-min-old 2nd fade reading still suppressed (counter can never pre-load)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 102, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: true, longTermHold: false });

check('5-min-old hold at/above target1 does NOT profit-fade (guard wins)',
  evaluateScoreClose(freshPos, 'hold', true, 112, T0 + 5 * 60000, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: true, longTermHold: false });

check('exactly at the guard boundary is old enough (>= min age)',
  evaluateScoreClose(freshPos, 'sell', true, 102, T0 + HOUR, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: false, longTermHold: false });

check('2d-old single flip reading does NOT close (needs 2 confirmations)',
  evaluateScoreClose(freshPos, 'sell', true, 102, now2d, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: false, longTermHold: false });

check('2d-old 2nd consecutive flip reading at a loss closes (score flipped)',
  evaluateScoreClose({ ...freshPos, flipCount: 1, flipFirstSeen: T0 }, 'sell', true, 92, now2d, HOUR),
  { close: 'score flipped', fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: false, longTermHold: false });

check('2d-old 2nd flip reading but still a winner (+2%) does NOT close',
  evaluateScoreClose({ ...freshPos, flipCount: 1, flipFirstSeen: T0 }, 'sell', true, 102, now2d, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: false, longTermHold: false });

check('2d-old first DEEP fade reading waits for confirmation (1/3)',
  evaluateScoreClose(freshPos, 'hold', true, 102, now2d, HOUR, DEEP),
  { close: null, fadeCount: 1, fadeFirstSeen: now2d, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('2d-old first MARGINAL fade reading demands 4 confirmations',
  evaluateScoreClose(freshPos, 'hold', true, 102, now2d, HOUR, MARGINAL),
  { close: null, fadeCount: 1, fadeFirstSeen: now2d, required: 4, isFade: true, tooYoung: false, longTermHold: false });

check('2d-old 2nd fade on a WINNER (+2%) does NOT close (winners ride)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 102, now2d, HOUR, DEEP),
  { close: null, fadeCount: 2, fadeFirstSeen: now2d, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('deep fade confirmed across days on a LOSER past 80%-of-stop (-13% vs 15% stop) closes',
  evaluateScoreClose({ ...freshPos, fadeCount: 2, fadeFirstSeen: T0 }, 'hold', true, 87, now2d, HOUR, DEEP),
  { close: 'conviction faded', fadeCount: 3, fadeFirstSeen: T0, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('deep fade confirmed but only -4% (below the 12% cut for 15% stop) does NOT close',
  evaluateScoreClose({ ...freshPos, fadeCount: 2, fadeFirstSeen: T0 }, 'hold', true, 96, now2d, HOUR, DEEP),
  { close: null, fadeCount: 3, fadeFirstSeen: T0, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('same-day 3rd deep reading never closes, even at -13% (must span days)',
  evaluateScoreClose({ ...freshPos, fadeCount: 2, fadeFirstSeen: now2d }, 'hold', true, 87, now2d, HOUR, DEEP),
  { close: null, fadeCount: 3, fadeFirstSeen: now2d, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('MARGINAL fade at count 3 across days still not confirmed (needs 4)',
  evaluateScoreClose({ ...freshPos, fadeCount: 2, fadeFirstSeen: T0 }, 'hold', true, 87, now2d, HOUR, MARGINAL),
  { close: null, fadeCount: 3, fadeFirstSeen: T0, required: 4, isFade: true, tooYoung: false, longTermHold: false });

check('MARGINAL fade at count 4 across days on a -13% loser closes',
  evaluateScoreClose({ ...freshPos, fadeCount: 3, fadeFirstSeen: T0 }, 'hold', true, 87, now2d, HOUR, MARGINAL),
  { close: 'conviction faded', fadeCount: 4, fadeFirstSeen: T0, required: 4, isFade: true, tooYoung: false, longTermHold: false });

check('2d-old hold at/above target1 profit-fades on first reading',
  evaluateScoreClose(freshPos, 'hold', true, 112, now2d, HOUR, DEEP),
  { close: 'profit fade', fadeCount: 1, fadeFirstSeen: now2d, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('stale position (>30d) + hold -> stale thesis',
  evaluateScoreClose({ ...freshPos, timestamp: T0 - 31 * DAY }, 'hold', true, 105, now2d, HOUR, DEEP),
  { close: 'stale thesis', fadeCount: 1, fadeFirstSeen: now2d, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('long-term hold type + old + flip -> still no score close (stop/target only)',
  evaluateScoreClose({ ...freshPos, type: 'Long Term' }, 'sell', true, 102, now2d, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: false, longTermHold: true });

check('undefined position -> no close',
  evaluateScoreClose(undefined, 'hold', true, 102, now2d, HOUR),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: true, longTermHold: false });

check('default min-age (6h): 4h-old 2nd fade does NOT close (too young)',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 104, T0 + 4 * HOUR, undefined, DEEP),
  { close: null, fadeCount: 0, fadeFirstSeen: null, required: 3, isFade: false, tooYoung: true, longTermHold: false });

check('default min-age (6h): 7h-old 2nd fade on a WINNER (+4%) does NOT close',
  evaluateScoreClose({ ...freshPos, fadeCount: 1 }, 'hold', true, 104, T0 + 7 * HOUR, undefined, DEEP),
  { close: null, fadeCount: 2, fadeFirstSeen: T0 + 7 * HOUR, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('default min-age (6h): 7h-old 3rd reading same-day does NOT close (day span)',
  evaluateScoreClose({ ...freshPos, fadeCount: 2, fadeFirstSeen: T0 }, 'hold', true, 96, T0 + 7 * HOUR, undefined, DEEP),
  { close: null, fadeCount: 3, fadeFirstSeen: T0, required: 3, isFade: true, tooYoung: false, longTermHold: false });

check('default min-age (6h): 2d-old confirmed fade on a -13% loser closes (past 80% of 15% stop)',
  evaluateScoreClose({ ...freshPos, fadeCount: 2, fadeFirstSeen: T0 }, 'hold', true, 87, now2d, undefined, DEEP),
  { close: 'conviction faded', fadeCount: 3, fadeFirstSeen: T0, required: 3, isFade: true, tooYoung: false, longTermHold: false });

// ─── fadeCutReached (fair fade cut: losers only, 80%-of-stop + 3% floor) ────
section('fadeCutReached (fair fade cut - losers only)');
const bandPos = { action: 'buy', entryPrice: 100, stopLoss: 85, target1: 110 };
const bandSell = { action: 'sell', entryPrice: 100, stopLoss: 115, target1: 90 };

check('buy WINNER +2% -> NO fade cut (winners always ride)',
  fadeCutReached(bandPos, 102), false);

check('buy WINNER +10% -> NO fade cut (winners always ride)',
  fadeCutReached(bandPos, 110), false);

check('buy flat 0% -> NO fade cut',
  fadeCutReached(bandPos, 100), false);

check('buy -1% loss (inside band) -> NO cut',
  fadeCutReached(bandPos, 99), false);

check('buy -4% (below the 12% threshold for 15% stop) -> NO cut',
  fadeCutReached(bandPos, 96), false);

check('buy -5% -> NO cut (still under 80% of the 15% stop = -12%)',
  fadeCutReached(bandPos, 95), false);

check('buy exactly at 80% of the stop distance (-12%) -> cut',
  fadeCutReached(bandPos, 88), true);

check('sell WINNER -4% -> NO fade cut (winners always ride)',
  fadeCutReached(bandSell, 96), false);

check('sell +4% (below the +12% threshold) -> NO cut',
  fadeCutReached(bandSell, 104), false);

check('sell exactly at +12% (80% of the +15% stop) -> cut',
  fadeCutReached(bandSell, 112), true);

check('sell +2% -> NO cut',
  fadeCutReached(bandSell, 102), false);

check('no position / zero prices -> false',
  [fadeCutReached(null, 102), fadeCutReached(bandPos, 0), fadeCutReached({ ...bandPos, entryPrice: 0 }, 102)],
  [false, false, false]);

// The re-leveled pre-lock stop sits at least 2% below entry (volatility-scaled
// buffer); SCORE_CLOSE_CUT_MIN_PCT (3%) must keep a confirmed fade from yanking
// a position near breakeven — the hard stop is what books those exits.
// With the MIN_STOP_PCT floor, stops below 15% never trigger fade cut — the
// hard stop is the binding exit. This prevents premature closes on legacy or
// tight-stop positions.
const tightBand = { action: 'buy', entryPrice: 100, stopLoss: 98, target1: 110 };

check('tight re-leveled stop (-2%): fade cut does NOT fire at -1% (noise floor)',
  fadeCutReached(tightBand, 99), false);

check('tight re-leveled stop (-2%): fade cut does NOT fire at -1.5% (3% floor wins)',
  fadeCutReached(tightBand, 98.5), false);

check('tight re-leveled stop (-2%): fade cut does NOT fire at -3% (below 15% floor)',
  [fadeCutReached(tightBand, 97), fadeCutReached(tightBand, 99.5)],
  [false, false]);

// MIN_STOP_PCT floor: stops below 15% are protected from fade-cut — only the
// hard stop books those exits. This prevents legacy tight stops from causing
// premature closes (e.g. GE at -7.2% with an 8.5% stop).
const floorPos = { action: 'buy', entryPrice: 100, stopLoss: 92, target1: 110 };
check('8% stop: fade cut does NOT fire at -7% (below 15% floor, hard stop binds)',
  fadeCutReached(floorPos, 93), false);

check('8% stop: fade cut does NOT fire at -12% (below 15% floor)',
  fadeCutReached(floorPos, 88), false);

// Real-world regressions: BOC was fade-closed at -1.1% and EABL at +1.2% by the
// older logic — neither may be cut under the fair rules.
// With the MIN_STOP_PCT floor, BOC's 3.44% stop is below the floor, so fade cut
// never fires — the hard stop binds first.
check('BOC-like tight stop (-3.44%): -1.1% loss is NOT fade-cut (rides)',
  fadeCutReached({ action: 'buy', entryPrice: 180, stopLoss: 173.81, target1: 198.57 }, 178), false);

check('BOC-like tight stop: NOT cut even at -3% (below 15% floor, hard stop binds)',
  fadeCutReached({ action: 'buy', entryPrice: 180, stopLoss: 173.81, target1: 198.57 }, 174.5), false);

check('EABL-like winner +1.2% is never fade-cut',
  fadeCutReached({ action: 'buy', entryPrice: 281.5, stopLoss: 274.99, target1: 320.76 }, 285), false);

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
