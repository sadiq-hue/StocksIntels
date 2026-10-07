/**
 * Migration 007: engine v2 reset — archive the v1 signal cohort.
 *
 * WHY
 * ---
 * Every signal produced before this week was scored by a different engine than
 * the one running now:
 *   - the composite carried a constant 50 x w.confidence term (+6.5 pts each),
 *   - the ML win-probability model was numerically corrupt and saturated to 1.0
 *     for every stock (a constant +8.6 pts via the 15% ml_probability weight),
 *   - NSE fundamentals come from a hardcoded table, and macro conditions were
 *     partly reference estimates.
 * Mixing that cohort with the fixed engine corrupts every quality metric we
 * would use to judge the new engine, and would poison ML training/calibration.
 * The realized performance confirms it is not worth keeping as if it were the
 * current engine: Buy signals scored ~26% directional accuracy with a -4.8%
 * average return.
 *
 * WHAT
 * ----
 * This does NOT delete anything. It ARCHIVES the v1 cohort into
 * `*_legacy_v1` tables and empties the live tables, then tags future rows with
 * `engine_version = 'v2'` and clears the cached signal set. The live tables then
 * start clean, so every existing reader (stats, forward test, ML, monitored
 * restore, admin) automatically reports only v2 without a query change.
 *
 *   signal_history      -> signal_history_legacy_v1      (<empty>)
 *   signal_outcomes     -> signal_outcomes_legacy_v1     (<empty>)
 *   forward_predictions -> forward_predictions_legacy_v1 (<empty>)
 *   prediction_log      -> prediction_log_legacy_v1      (<empty>)
 *
 * Reversible:
 *   psql -c "INSERT INTO signal_history      SELECT * FROM signal_history_legacy_v1"
 *   psql -c "INSERT INTO signal_outcomes     SELECT * FROM signal_outcomes_legacy_v1"
 *   psql -c "INSERT INTO forward_predictions SELECT * FROM forward_predictions_legacy_v1"
 *
 * USAGE
 * -----
 *   node migrations/007_engine_v2_reset.js            # dry run (default)
 *   node migrations/007_engine_v2_reset.js --apply    # archive + empty + tag
 *
 * Safe to re-run: archives are created only if absent, and once the live tables
 * are empty the deletes are no-ops.
 */

const { pool } = require('../db');
const { ENGINE_VERSION } = require('../engineVersion');

const APPLY = process.argv.includes('--apply');
const TABLES = ['signal_history', 'signal_outcomes', 'forward_predictions', 'prediction_log'];
const ENGINE_TAG_TABLES = ['signal_history', 'signal_outcomes', 'forward_predictions'];
const LEGACY_SUFFIX = '_legacy_v1';

async function tableExists(name) {
  const r = await pool.query(
    `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
    [name]
  );
  return r.rows.length > 0;
}

async function countRows(name) {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${name}`);
  return r.rows[0].c;
}

async function main() {
  console.log(`Engine ${ENGINE_VERSION} reset — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  for (const t of TABLES) {
    const legacy = t + LEGACY_SUFFIX;
    const rows = await countRows(t);
    const archived = await tableExists(legacy);
    console.log(`  ${t}: ${rows} rows -> ${legacy}${archived ? ' (archive already exists)' : ''}`);
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to archive and empty.');
    await pool.end();
    return;
  }

  for (const t of TABLES) {
    const legacy = t + LEGACY_SUFFIX;
    if (await tableExists(legacy)) {
      console.log(`  archive ${legacy} already exists — not overwriting`);
    } else {
      await pool.query(`CREATE TABLE ${legacy} AS SELECT * FROM ${t}`);
      console.log(`  archived ${t} -> ${legacy}`);
    }
  }

  // TRUNCATE, not DELETE. prediction_log holds a multi-million-row UNINDEXED
  // foreign key to signal_history, so deleting history row-by-row makes Postgres
  // scan the whole child table per row — it stalls the DB for minutes. TRUNCATE
  // is instant and skips row-level FK checks.
  await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  console.log(`  truncated ${TABLES.join(', ')}`);

  for (const t of ENGINE_TAG_TABLES) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS engine_version VARCHAR(20) DEFAULT '${ENGINE_VERSION}'`);
  }
  console.log(`  tagged ${ENGINE_TAG_TABLES.join(', ')} with engine_version default '${ENGINE_VERSION}'`);

  const cache = await pool.query(`DELETE FROM app_cache WHERE cache_key = 'signals_cache'`);
  console.log(`  cleared app_cache.signals_cache (${cache.rowCount} row)`);

  console.log('\nReset complete. Live tables are empty; the next cycle repopulates under ' + ENGINE_VERSION + '.');
  await pool.end();
}

main().catch((e) => {
  console.error('Reset failed:', e.message);
  process.exit(1);
});
