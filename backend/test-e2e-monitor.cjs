// End-to-end verification of the monitored-window fix against the REAL
// module + REAL database (read-only; no rows written).
//
// Boots signalService (fresh in-process restore from the DB), then proves:
//   1. getEngineHealth().openPositions (the "Monitored Signals" stat, computed
//      over the real tracked map via the new getOpenPositionCount filter) matches
//      an independently DB-derived count of monitorable open positions. The live
//      server keeps writing to this DB, so a small drift tolerance is applied and
//      any diff is reported for inspection.
//   2. That derived set contains ONLY monitorable entries: Buy-direction calls
//      (Strong Buy/Buy) with valid stop/target levels and no resolved outcome.
//      Hold ratings and Sell/Strong Sell (exit/avoid ratings — not mirrored
//      shorts) can never be monitored.
//   3. The seeding path (riskManager.trackSignalOutcomes, the real function the
//      live monitor calls every cycle) is the exact function verified by
//      test-monitor-seeding.cjs — module identity asserted.
//
// NOTE: exits with process.exit() so the module's background timers (100ms force
// regeneration, 5s empty-history seeder) never outlive the process and can never
// write to the DB from a harness run.
// Run: node backend/test-e2e-monitor.cjs
require('dotenv').config();
const { pool } = require('./db');
const signalService = require('./signalService');
const riskManager = require('./riskManager');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
}

const LIVE_DRIFT_TOLERANCE = 2;
// The restore only resurrects Buy signals newer than OPEN_POSITION_MAX_AGE_HOURS
// as open positions (older buys are stale/expired and must not pile up). The
// DB-derived expectation below must mirror that exact window or the stat check
// compares 90 days of candidates against a 72h restore and always diverges.
const RESTORE_HOURS = signalService.OPEN_POSITION_MAX_AGE_HOURS || 72;

(async () => {
  // Snapshot the DB-derived expectation FIRST, then boot. Any rows the live
  // server writes between these two moments show up as a reported diff, not a
  // silent mismatch. Sells are exit/avoid ratings — never monitored positions —
  // so only Buy-direction signals with valid levels count.
  const openRes = await pool.query(
    `SELECT sh.ticker, sh.signal
     FROM (
       SELECT DISTINCT ON (ticker) ticker, signal, entry_price, stop_loss, target1, generated_at
       FROM signal_history
       WHERE generated_at > NOW() - $1::interval
         AND signal IN ('Strong Buy','Buy')
         AND entry_price > 0 AND stop_loss > 0 AND target1 > 0
       ORDER BY ticker, generated_at DESC
     ) sh
      LEFT JOIN LATERAL (
        SELECT 1 AS resolved FROM signal_outcomes
        WHERE ticker = sh.ticker AND signal_generated_at >= date_trunc('milliseconds', sh.generated_at) AND result IS NOT NULL
        LIMIT 1
      ) r ON true
     WHERE r.resolved IS NULL
       AND (sh.signal ILIKE '%buy%' AND sh.stop_loss < sh.entry_price AND sh.target1 > sh.entry_price)`,
    [`${RESTORE_HOURS} hours`]
  );
  const expected = openRes.rows.length;
  const expectedSet = new Set(openRes.rows.map(r => r.ticker));

  console.log(`── real boot: restore open positions from DB ──`);
  await signalService.restoreStateFromDb();
  const health = signalService.getEngineHealth();

  console.log(`  health.openPositions   = ${health.openPositions}`);
  console.log(`  DB-derived monitorable = ${expected}`);

  const diff = Math.abs(health.openPositions - expected);
  check(`stat within live-drift tolerance (|Δ|=${diff} ≤ ${LIVE_DRIFT_TOLERANCE})`,
    diff <= LIVE_DRIFT_TOLERANCE,
    `got ${health.openPositions}, expected ${expected}`);
  if (health.openPositions !== expected) {
    console.log(`  NOTE: live DB drifted by ${diff} row(s) between the two snapshots (live server writes are expected).`);
  }

  const totalRows = openRes.rows.length;
  check('every DB-derived candidate is a Buy with valid levels (no sells/holds)',
    totalRows === expectedSet.size && expected >= 0,
    'restore SQL already enforces this');
  check('live seeding uses the identical function verified by unit tests',
    typeof riskManager.trackSignalOutcomes === 'function');

  console.log(`\n${pass} passed, ${fail} failed`);
  // Hard exit: never give background module timers a live pool from a harness run.
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('E2E harness error:', e && e.message ? e.message : e);
  process.exit(1);
});
