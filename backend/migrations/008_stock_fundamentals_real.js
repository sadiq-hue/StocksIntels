/**
 * Migration 008: reconcile stock_fundamentals to the canonical symbol-keyed schema.
 *
 * WHY
 * ---
 * Production has a legacy `stock_fundamentals` shape (primary key `id uuid`,
 * `stock_id`, `statement_id`, raw columns) with NO `symbol` column and 0 rows.
 * That is why nseFundamentalsSeeder logs `column "symbol" does not exist` every
 * 4 hours and why the supplementary fundamentals lookup in
 * financialReportsService.buildLocalNseReport finds nothing. The rest of the app
 * (seeder, financialStatementsStore, buildLocalNseReport, ML services) expects
 * the symbol-keyed shape from db/init.sql.
 *
 * WHAT
 * ----
 * Additive only — no data is dropped. Adds the missing canonical columns, a
 * unique index on `symbol` (so `ON CONFLICT (symbol)` works), and the columns the
 * ingest writes. Legacy columns are left in place so the stale `stock_id` readers
 * keep working.
 *
 * USAGE
 *   node migrations/008_stock_fundamentals_real.js           # dry run
 *   node migrations/008_stock_fundamentals_real.js --apply
 */

const { pool } = require('../db');

const APPLY = process.argv.includes('--apply');

const COLUMNS = [
  ['symbol', 'VARCHAR(20)'],
  ['pb_ratio', 'NUMERIC(10,2)'],
  ['roe', 'NUMERIC(10,2)'],
  ['debt_to_equity', 'NUMERIC(10,2)'],
  ['current_ratio', 'NUMERIC(10,2)'],
  ['revenue_growth', 'NUMERIC(10,4)'],
  ['eps_growth', 'NUMERIC(10,4)'],
  ['dividend_yield', 'NUMERIC(10,4)'],
  ['fcf_yield', 'NUMERIC(10,2)'],
  ['market_cap', 'NUMERIC(20,2)'],
  ['payout_ratio', 'NUMERIC(10,2)'],
  ['net_margin', 'NUMERIC(10,4)'],
  ['period_end_date', 'DATE'],
  ['data_source', 'VARCHAR(30)'],
];

async function main() {
  console.log(`Migration 008 (stock_fundamentals schema) — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  const existing = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_fundamentals'`
  );
  const have = new Set(existing.rows.map(r => r.column_name));
  const missing = COLUMNS.filter(([c]) => !have.has(c));
  console.log(`  ${have.size} columns present; adding: ${missing.map(m => m[0]).join(', ') || '(none)'}`);
  const idx = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE tablename='stock_fundamentals' AND indexname='ux_stock_fundamentals_symbol'`
  );
  console.log(`  unique index on symbol: ${idx.rows.length ? 'present' : 'to create'}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply.');
    await pool.end();
    return;
  }

  for (const [name, type] of missing) {
    await pool.query(`ALTER TABLE stock_fundamentals ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    console.log(`  added ${name} ${type}`);
  }
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_fundamentals_symbol ON stock_fundamentals (symbol)`);
  console.log('  ensured unique index ux_stock_fundamentals_symbol');
  console.log('\nSchema reconciled.');
  await pool.end();
}

main().catch((e) => { console.error('Migration 008 failed:', e.message); process.exit(1); });
