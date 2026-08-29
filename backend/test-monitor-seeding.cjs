// Regression tests for the monitored-window seeding fix:
// Hold ratings and level-less Sell ratings must NOT be stored in the tracked map
// (they inflated "Monitored Signals", churned timestamps, and risked evicting real
// positions). Only open directional calls with stop/target levels are tracked.
// Run: node backend/test-monitor-seeding.cjs
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
// buySig's 5% stop is a legacy sub-floor input — seeding MUST normalize it to the
// 15% MIN_STOP_PCT floor (95 -> 85 at entry 100), never leave it tight.
function buySig() { return { signal: 'Buy', action: 'buy', stopLoss: 95, target1: 105, positionSize: '25%' }; }
function sellSig() { return { signal: 'Sell', action: 'sell', stopLoss: null, target1: null, positionSize: '25%' }; }
// Legacy artifact form: a Sell carrying short-style levels. Sells are exit/avoid
// ratings, NOT mirrored shorts — even a leveled Sell must never be monitored.
function leveledSellSig() { return { signal: 'Sell', action: 'sell', stopLoss: 105, target1: 95, positionSize: '25%' }; }

console.log('── fresh symbol seeding ──');

let m = new Map(), st = state(), pf = perf();
trackSignalOutcomes(st, pf, m, 'X1', 100, holdSig(), true);
check('Hold signal is NOT stored (fresh symbol)', m.size === 0);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X2', 100, buySig(), true);
check('Buy signal IS stored as an open entry', m.size === 1 && m.get('X2').action === 'buy' && !m.get('X2').result);
check('  sub-floor 5% stop is NORMALIZED to the 15% floor (95 -> 85)', m.get('X2').stopLoss === 85 && m.get('X2').target1 === 105 && m.get('X2').timestamp);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X2b', 100, { signal: 'Buy', action: 'buy', stopLoss: 80, target1: 105, positionSize: '25%' }, true);
check('  a 20% (wider-than-floor) stop is NOT loosened (80 stays 80)', m.get('X2b').stopLoss === 80);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X3', 100, sellSig(), true);
check('level-less Sell rating is NOT stored', m.size === 0);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X3b', 100, leveledSellSig(), true);
check('leveled Sell is NOT stored either (sells are never monitored)', m.size === 0);

console.log('── open buy persistence (no resolution) ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X4', 100, buySig(), true);
advance(6 * 60 * 1000); // next monitor cycle, past the min-age gate
trackSignalOutcomes(st, pf, m, 'X4', 101, buySig(), true);
check('unresolved buy survives the next cycle unchanged (floored stop 85)', m.get('X4') && !m.get('X4').result && m.get('X4').stopLoss === 85);

console.log('── resolution clears the entry ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X5', 100, buySig(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'X5', 80, holdSig(), true); // price <= floored stop 85, market open
check('stop-hit loss resolves at the FLOOR (85) and the entry is removed (fresh Hold not re-seeded)', m.size === 0);
check('  loss counted in stats', pf.losses === 1 && pf.total === 1 && st.totalTrades === 1);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X6', 100, buySig(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'X6', 80, sellSig(), true);
check('stop-hit loss with fresh Sell rating also clears the entry', m.size === 0 && pf.losses === 1);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X6b', 100, buySig(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'X6b', 80, leveledSellSig(), true);
check('stop-hit loss with fresh leveled Sell also clears it', m.size === 0 && pf.losses === 1);

console.log('── market-closed deferral ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X7', 100, buySig(), true);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'X7', 80, holdSig(), false); // below floored stop but market closed -> defer
check('market-closed stop-hit is deferred, position still tracked', m.get('X7') && !m.get('X7').result);
check('  no stats mutated while deferred', pf.losses === 0 && st.totalTrades === 0);

console.log('── legacy sub-floor stop normalization ──');

// A pre-MIN_STOP_PCT position (like ASML's 2.61% stop) must be widened to the 15%
// floor BEFORE any resolution check, so a routine pullback can't book a noise-band
// loss. Normalizing at seed means price 90 (which would have hit the legacy 97)
// does NOT stop out, and only a move below the floor (84 <= 85) resolves it.
m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X11', 100, { signal: 'Buy', action: 'buy', stopLoss: 97, target1: 110, positionSize: '25%' }, true);
check('  legacy 3% stop normalized to the floor on seed (97 -> 85)', m.get('X11').stopLoss === 85);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'X11', 90, { signal: 'Buy', action: 'buy', stopLoss: 97, target1: 110, positionSize: '25%' }, true);
check('  price between legacy stop and floor does NOT stop out', m.get('X11') && !m.get('X11').result && pf.losses === 0);
advance(6 * 60 * 1000);
trackSignalOutcomes(st, pf, m, 'X11', 84, holdSig(), true); // <= floored stop 85
check('  only a move below the floor resolves the loss', m.size === 0 && pf.losses === 1 && st.totalTrades === 1);

console.log('── re-rating after resolution re-seeds only monitorable ──');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X8', 100, buySig(), true);
// close the old position by hand (mirrors the monitor-gate close that pre-sets result)
m.get('X8').result = 'win';
trackSignalOutcomes(st, pf, m, 'X8', 103, buySig(), true);
check('fresh Buy after close re-seeds a new open entry', m.get('X8') && !m.get('X8').result && m.get('X8').action === 'buy');

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X9', 100, buySig(), true);
m.get('X9').result = 'loss'; // gate closed it on a conviction fade
trackSignalOutcomes(st, pf, m, 'X9', 101, holdSig(), true);
check('gate-close + fresh Hold clears the stale entry entirely', m.size === 0);

m = new Map(); st = state(); pf = perf();
trackSignalOutcomes(st, pf, m, 'X10', 100, buySig(), true);
m.get('X10').result = 'loss';
trackSignalOutcomes(st, pf, m, 'X10', 101, sellSig(), true);
check('gate-close + fresh Sell rating also clears it', m.size === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
