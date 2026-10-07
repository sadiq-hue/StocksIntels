/**
 * Migration 008: reconcile stock_fundamentals to the canonical symbol-keyed schema.
 *
 * WHY
 * ---
 * Production has a legacy `stock_fundamentals` shape (primary key `id uuid`,
 * NOT NULL `stock_id`/`statement_id`, raw columns) with NO `symbol` column and 0
 * rows. That is why nseFundamentalsSeeder logs `column "symbol" does not exist`
 * every 4 hours and why the supplementary fundamentals lookup in
 * financialReportsService.buildLocalNseReport finds nothing. Every working
 * consumer (seeder, financialStatementsStore, buildLocalNseReport, ML services)
 * expects the symbol-keyed shape from db/init.sql.
 *
 * WHAT
 * ----
 * - If the table is absent, create the canonical symbol-keyed schema.
 * - If it exists, is EMPTY, and lacks `symbol` (the legacy shape), rebuild it to
 *   the canonical schema — the legacy NOT NULL stock_id/statement_id columns
 *   reject symbol-keyed inserts.
 * - Otherwise apply additive ALTERs (add missing columns, relax legacy NOT NULLs,
 *   ensure the unique index) so no data is ever dropped on a populated table.
 *
 * USAGE
 *   node migrations/008_stock_fundamentals_real.js           # dry run
 *   node migrations/008_stock_fundamentals_real.js --apply
 */

const { pool } = require('../db');

const APPLY = process.argv.includes('--apply');

const CANONICAL = `
  symbol varchar(20) PRIMARY KEY,
  stock_id uuid,
  pe_ratio numeric(10,2),
  pb_ratio numeric(10,2),
  debt_to_equity numeric(10,2),
  current_ratio numeric(10,2),
  roe numeric(10,2),
  revenue_growth numeric(10,4),
  eps_growth numeric(10,4),
  dividend_yield numeric(10,4),
  fcf_yield numeric(10,2),
  market_cap numeric(20,2),
  payout_ratio numeric(10,2),
  net_margin numeric(10,4),
  period_end_date date,
  data_source varchar(30),
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
`;

const ADD_COLUMNS = [
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
  ['updated_at', 'TIMESTAMPTZ DEFAULT now()'],
  ['created_at', 'TIMESTAMPTZ DEFAULT now()'],
];

async function main() {
  console.log(`Migration 008 (stock_fundamentals schema) — mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  const exists = (await pool.query(`SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='stock_fundamentals'`)).rows.length > 0;
  const cols = exists
    ? (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='stock_fundamentals'`)).rows.map(r => r.column_name)
    : [];
  const rows = exists ? (await pool.query(`SELECT COUNT(*)::int c FROM stock_fundamentals`)).rows[0].c : 0;

  let action;
  if (!exists) action = 'create canonical';
  else if (rows === 0 && !cols.includes('symbol')) action = 'rebuild canonical (empty legacy table)';
  else action = 'additive alter';

  console.log(`  table exists=${exists}, rows=${rows}, has symbol=${cols.includes('symbol')}`);
  console.log(`  planned action: ${action}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply.');
    await pool.end();
    return;
  }

  if (action === 'create canonical') {
    await pool.query(`CREATE TABLE stock_fundamentals (${CANONICAL});`);
  } else if (action === 'rebuild canonical (empty legacy table)') {
    await pool.query(`DROP TABLE IF EXISTS stock_fundamentals CASCADE;`);
    await pool.query(`CREATE TABLE stock_fundamentals (${CANONICAL});`);
  } else {
    const have = new Set(cols);
    for (const [name, type] of ADD_COLUMNS) {
      if (!have.has(name)) await pool.query(`ALTER TABLE stock_fundamentals ADD COLUMN IF NOT EXISTS ${name} ${type}`);
    }
    // Relax legacy NOT NULLs so symbol-keyed inserts are accepted.
    for (const col of ['stock_id', 'statement_id']) {
      await pool.query(`ALTER TABLE stock_fundamentals ALTER COLUMN ${col} DROP NOT NULL`).catch(() => {});
    }
    await pool.query(`ALTER TABLE stock_fundamentals ALTER COLUMN id SET DEFAULT gen_random_uuid()`).catch(() => {});
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_stock_fundamentals_symbol ON stock_fundamentals (symbol)`);
  console.log(`  done (${action}).`);
  await pool.end();
}

main().catch((e) => { console.error('Migration 008 failed:', e.message); process.exit(1); });
