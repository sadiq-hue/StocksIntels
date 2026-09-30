/**
 * Migration 006: collapse duplicate signal_outcomes rows.
 *
 * WHY
 * ---
 * The engine re-emitted an unchanged call on every signal cycle with a slightly
 * different reference price. Each re-emission got a fresh signal_generated_at, so
 * it slipped past the (ticker, signal_generated_at) conflict target and inserted
 * its own row into signal_outcomes. Those rows are not independent trades - they
 * are one idea re-priced - and counting each one inflated every accuracy figure
 * that reads the table:
 *
 *   - 661 live rows in the 180d window came from only 238 distinct theses
 *   - 423 rows were repeat emissions of a call already counted
 *   - the Forward Test / Health tabs reported ~57.5% where the thesis-level
 *     figure is 38.2%
 *
 * persistSignalOutcome() now updates a matching thesis row in place, so NEW
 * duplication stopped at that point, and getForwardTestStats() /
 * refreshPerformanceStats() collapse to thesis level when reporting. This
 * migration removes the historical backlog so the table is physically honest and
 * every current and future consumer - including computeBacktestStats() and any ad
 * hoc query - is correct without having to know about the collapse.
 *
 * HOW
 * ---
 * The rows to delete are chosen by collapseToThesesDetailed(), the SAME function
 * the reporting path uses, so the migration and the reported numbers can never
 * disagree about which row represents a thesis. For each thesis the latest
 * resolution is kept (matching the in-place UPDATE the engine now performs) and
 * the superseded repeat emissions are removed.
 *
 * Every deleted row is copied to signal_outcomes_dedup_backup first, so the
 * operation is reversible:
 *
 *   psql -c "INSERT INTO signal_outcomes SELECT * FROM signal_outcomes_dedup_backup"
 *
 * USAGE
 * -----
 *   node migrations/006_collapse_duplicate_outcomes.js            # dry run (default)
 *   node migrations/006_collapse_duplicate_outcomes.js --apply    # perform the delete
 *
 * Safe to re-run: once the duplicates are gone there is nothing left to collapse.
 */

require('dotenv').config();

const { Pool } = require('pg');
const { collapseToThesesDetailed } = require('../signalService');

const WINDOW_DAYS = 180; // must match SIGNAL_WINDOW_DAYS in signalService

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Same rows the Forward Test audits: resolved live outcomes in the window.
    const { rows } = await pool.query(
      `SELECT id, ticker, signal, entry_price, target1, result,
              recorded_at, resolved_at, signal_generated_at, close_reason
       FROM signal_outcomes
       WHERE result IS NOT NULL AND source = 'live'
         AND COALESCE(signal_generated_at, recorded_at) > NOW() - $1::interval`,
      [`${WINDOW_DAYS} days`]
    );

    const { kept, superseded } = collapseToThesesDetailed(rows);
    const before = rows.length;
    const winsBefore = rows.filter(r => r.result === 'win').length;
    const winsKept = kept.filter(r => r.result === 'win').length;

    console.log(`signal_outcomes (live, resolved, last ${WINDOW_DAYS}d)`);
    console.log(`  rows before        : ${before}`);
    console.log(`  distinct theses    : ${kept.length}`);
    console.log(`  superseded (dupes) : ${superseded.length}`);
    console.log(`  win rate before    : ${((winsBefore / before) * 100).toFixed(1)}%  (${winsBefore}/${before})`);
    console.log(`  win rate after     : ${((winsKept / kept.length) * 100).toFixed(1)}%  (${winsKept}/${kept.length})`);

    if (superseded.length === 0) {
      console.log('\nNothing to collapse - already clean. Exiting.');
      return;
    }

    // Group the deletions for a readable dry run.
    const byTicker = new Map();
    for (const r of superseded) {
      if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
      byTicker.get(r.ticker).push(r);
    }
    console.log(`\nTop tickers losing rows (${byTicker.size} tickers affected):`);
    [...byTicker.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 12)
      .forEach(([t, rs]) => {
        const wins = rs.filter(r => r.result === 'win').length;
        console.log(`  ${String(t).padEnd(7)} ${String(rs.length).padStart(3)} rows  (${wins} win / ${rs.length - wins} loss)`);
      });

    if (!apply) {
      console.log('\nDRY RUN - nothing was written. Re-run with --apply to perform the delete.');
      return;
    }

    // 1. Back up the exact rows we are about to delete, with the thesis they are
    //    being folded into, so the deletion is auditable and reversible.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS signal_outcomes_dedup_backup (
        LIKE signal_outcomes INCLUDING ALL,
        folded_into_id BIGINT,
        folded_ticker VARCHAR(20),
        folded_signal VARCHAR(20),
        backed_up_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`);

    const keeperByThesis = new Map();
    for (const k of kept) keeperByThesis.set(`${k.ticker}|${k.signal}`, k);

    await pool.query('BEGIN');
    try {
      let copied = 0;
      for (const r of superseded) {
        const keeper = keeperByThesis.get(`${r.ticker}|${r.signal}`);
        await pool.query(
          `INSERT INTO signal_outcomes_dedup_backup
             (id, ticker, entry_price, signal, exit_price, result, position_size,
              recorded_at, signal_history_id, resolved_at, signal_generated_at,
              source, close_reason, target1, stop_loss, folded_into_id, folded_ticker, folded_signal)
           SELECT o.id, o.ticker, o.entry_price, o.signal, o.exit_price, o.result, o.position_size,
                  o.recorded_at, o.signal_history_id, o.resolved_at, o.signal_generated_at,
                  o.source, o.close_reason, o.target1, o.stop_loss, $2, o.ticker, o.signal
           FROM signal_outcomes o WHERE o.id = $1`,
          [r.id, keeper ? keeper.id : null]
        );
        copied++;
      }
      const del = await pool.query(
        `DELETE FROM signal_outcomes WHERE id = ANY($1::bigint[])`,
        [superseded.map(r => r.id)]
      );
      console.log(`\n  backed up ${copied} rows to signal_outcomes_dedup_backup`);
      console.log(`  deleted ${del.rowCount} rows from signal_outcomes`);
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }

    const after = await pool.query(
      `SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE result='win')::int w
       FROM signal_outcomes
       WHERE result IS NOT NULL AND source='live'
         AND COALESCE(signal_generated_at, recorded_at) > NOW() - $1::interval`,
      [`${WINDOW_DAYS} days`]
    );
    console.log(`\n  rows after         : ${after.rows[0].n}`);
    console.log(`  win rate after     : ${((after.rows[0].w / after.rows[0].n) * 100).toFixed(1)}%`);
    console.log('\nTo roll back:  INSERT INTO signal_outcomes SELECT * FROM signal_outcomes_dedup_backup;');
  } catch (e) {
    console.error('migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
    // signalService starts background timers (engine cycles, quote refreshes) when
    // it is required, so the event loop never drains on its own. Exit explicitly
    // once the pool is closed.
    process.exit(process.exitCode || 0);
  }
}

main();
