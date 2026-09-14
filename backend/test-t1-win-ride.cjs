// Regression tests for the T1-win-then-ride contract:
// When a Buy crosses target1 it BOOKS a win in the stats (exit = target1) but the
// position KEEPS RIDING toward the ultimate target — one win per trade, no double
// counting.  If the ride later reaches the ultimate target (or a locked-profit
// stop) the SAME outcome row is upgraded: exit_price becomes the final level and
// the win is never counted a second time.
// Run: node backend/test-t1-win-ride.cjs
const { trackSignalOutcomes } = require('./riskManager');

// Fake clock: trackSignalOutcomes defers resolution for signals younger than
// MIN_SIGNAL_AGE_MS (5 min), so multi-cycle tests advance the clock between calls.
let clock = Date.now();
const _DateNow = Date.now;
Date.now = () => clock;
const advance = (ms) => { clock += ms; };

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
}

function state() { return { consecutiveLosses: 0, totalTrades: 0 }; }
function perf() { return { wins: 0, losses: 0, total: 0, winRate: 0 }; }
function holdSig() { return { signal: 'Hold', action: 'hold', stopLoss: 95, target1: 105, positionSize: '25%' }; }
// Buy with a real two-rung ladder: ultimate = target2. stop 95 is widened to the
// 18% MIN_STOP_PCT floor (82) at seed; T1 crossing locks it to 110.
function buySig2(t1 = 120, t2 = 140, stop = 95) {
  return { signal: 'Buy', action: 'buy', stopLoss: stop, target1: t1, target2: t2, positionSize: '25%' };
}

console.log('── T1 crossing books the win while the position keeps riding ──');

let m = new Map(), st = state(), pf = perf();
trackSignalOutcomes(st, pf, m, 'W1', 100, buySig2(), true);
advance(6 * 60 * 1000); // past min-age gate
trackSignalOutcomes(st, pf, m, 'W1', 125, holdSig(), true); // >= target1 (120), < ultimate (140)
const w1 = m.get('W1');
check('T1 crossing books ONE win in the stats', pf.wins === 1 && pf.total === 1 && st.totalTrades === 1);
check('  milestone flag set for persistence + card', w1 && w1.milestoneWinBooked === true);
check('  milestone exit recorded at target1 (120)', w1 && w1.milestoneExitPrice === 120);
check('  close reason set for the milestone row', w1 && w1.closeReason === 'target1 milestone');
check('  result is STILL NULL (position keeps riding)', w1 && !w1.result);
check('  position is still monitored', m.size === 1);
check('  stop locked to entry + 0.5*(t1-entry) = 110', w1 && w1.stopLoss === 110);
check('  stage advanced past target1', w1 && w1.stageIdx === 1);

console.log('── continued ride does not book a second win ──');

advance(6 * 60 * 1000);
// Still riding: price 130 sits at/above T1 but the position already banked it.
trackSignalOutcomes(st, pf, m, 'W1', 130, holdSig(), true);
check('next cycle at/above T1 keeps riding, still open', m.get('W1') && !m.get('W1').result);
check('  no second win booked', pf.wins === 1 && pf.total === 1 && st.totalTrades === 1);

console.log('── ultimate target resolves the SAME win (upgraded exit, no re-count) ──');

advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W1', 145, holdSig(), true); // >= ultimate (140)
check('ultimate reach resolves as a win at the ULTIMATE exit (140)', m.size === 0 && w1.result === 'win' && w1.exitPrice === 140);
check('  close reason = ultimate target reached', w1.closeReason === 'ultimate target reached');
check('  win still counted ONCE (1/1, 100%)', pf.wins === 1 && pf.total === 1 && st.totalTrades === 1 && pf.winRate === 100);

console.log('── milestone win then locked-stop retrace upgrades to the stop exit ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'W2', 100, buySig2(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W2', 125, holdSig(), true); // T1 crossed -> win booked, stop locked 110
const w2 = m.get('W2');
check('T1 crossing booked the win (exit=120)', pf.wins === 1 && pf.total === 1 && w2.closeReason === 'target1 milestone');
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W2', 108, holdSig(), true); // <= locked stop 110
check('locked stop resolves the position (entry cleared)', m.size === 0);
check('  booked as a WIN, upgraded to the stop exit (110)', w2.result === 'win' && w2.exitPrice === 110 && w2.closeReason === 'stop loss');
check('  still ONE win — no re-count on the stop', pf.wins === 1 && pf.total === 1 && st.totalTrades === 1);

console.log('── single-cycle gap past target1 (+target2) books ONE win at T1 ──');

m = new Map(); st = state(); pf = perf();
// Three-rung ladder: T1=120, T2=130 (ultimate=150 via target3).
trackSignalOutcomes(st, pf, m, 'W3', 100, { signal: 'Buy', action: 'buy', stopLoss: 95, target1: 120, target2: 130, target3: 150, positionSize: '25%' }, true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W3', 135, holdSig(), true); // gaps past T1 AND T2, not ultimate
const w3 = m.get('W3');
check('gap past T1+T2 books exactly ONE win (exit=120)', pf.wins === 1 && pf.total === 1 && w3 && w3.milestoneExitPrice === 120);
check('  riding to ultimate, stage advanced to T3', w3 && !w3.result && w3.stageIdx === 2);

console.log('── gap straight to the ultimate target from entry books ONE direct win ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'W4', 100, buySig2(), true);
advance(6 * 60 * 1000);
// Capture the position reference BEFORE the resolving touch — resolution deletes
// it from the map. 142 >= ultimate (140) in one move.
const w4 = m.get('W4');
trackSignalOutcomes(st, pf, m, 'W4', 142, holdSig(), true);
check('direct ultimate reach resolves at the ultimate exit (140)', m.size === 0 && w4.result === 'win' && w4.exitPrice === 140 && w4.closeReason === 'ultimate target reached');
check('  no milestone flag (never staged)', w4.milestoneWinBooked !== true);
check('  counted as ONE win', pf.wins === 1 && pf.total === 1 && st.totalTrades === 1);

console.log('── milestone is NOT booked while the market is closed ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'W5', 100, buySig2(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W5', 125, holdSig(), false); // above T1 but market closed
check('market-closed T1 touch defers the milestone (no win yet)', m.get('W5') && !m.get('W5').milestoneWinBooked && !m.get('W5').result && pf.wins === 0);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W5', 125, holdSig(), true); // next live session
check('  milestone books on the first live T1 touch', m.get('W5') && m.get('W5').milestoneWinBooked === true && pf.wins === 1 && pf.total === 1);

console.log('── young signals cannot book the milestone ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'W6', 100, buySig2(), true);
trackSignalOutcomes(st, pf, m, 'W6', 125, holdSig(), true); // same clock, younger than 5 min
check('min-age gate defers a sub-5min T1 touch (no win)', m.get('W6') && !m.get('W6').milestoneWinBooked && !m.get('W6').result && pf.wins === 0 && pf.total === 0);

console.log('── defensive: milestone-booked position cannot double-degrade to a loss ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'W7', 100, buySig2(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W7', 125, holdSig(), true); // win booked at T1
const w7 = m.get('W7');
w7.stopLoss = 95; // corrupt: below entry (milestone locks never do this) — must still resolve as the banked win
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'W7', 80, holdSig(), true); // <= floored stop 82 (95 -> 82)
check('below-entry stop after milestone still resolves as a WIN (already banked)', m.size === 0 && w7.result === 'win' && w7.closeReason === 'stop loss');
check('  still counted once', pf.wins === 1 && pf.total === 1 && st.totalTrades === 1);

console.log('── average win rate stays correct across mixed milestones ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'M1', 100, buySig2(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'M1', 125, holdSig(), true); // win at T1
trackSignalOutcomes(st, pf, m, 'M2', 100, buySig2(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'M2', 80, holdSig(), true); // loss on the stop
check('two trades, one milestone win + one loss = 50%', pf.wins === 1 && pf.losses === 1 && pf.total === 2 && pf.winRate === 50 && st.totalTrades === 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);