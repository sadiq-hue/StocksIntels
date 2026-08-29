// One-off migration: re-derive period_type for existing NSE financial statements
// using the same classifier the live detector applies to new filings
// (nseReportTypes.inferPeriodType). Mirrors the auto-NSE labeling exactly.
//
// Run from backend/ so dotenv picks up .env (prod DATABASE_URL):
//   node scripts/relabel_period_types.js            # apply
//   DRY=1 node scripts/relabel_period_types.js      # preview only
require('dotenv').config();
const { pool } = require('../db');
const { inferPeriodType } = require('../nseReportTypes');

const DRY = process.env.DRY === '1';

(async () => {
  const { rows } = await pool.query(
    `SELECT fs.id, s.ticker, fs.period_end_date::text AS ped, fs.file_name, fs.period_type
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market = 'NSE'`
  );
  const byType = {};
  for (const r of rows) {
    const pt = inferPeriodType(r.file_name, r.ped);
    byType[pt] = (byType[pt] || 0) + 1;
    if (pt === r.period_type) continue;
    console.log(`${DRY ? '[DRY] ' : ''}${r.ticker} ${r.ped} ${r.period_type || '(none)'} -> ${pt} (${r.file_name})`);
    if (!DRY) await pool.query(`UPDATE financial_statements SET period_type=$1 WHERE id=$2`, [pt, r.id]);
  }
  console.log(`\n${DRY ? 'PREVIEW' : 'APPLIED'}: scanned=${rows.length} results by type:`, byType);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });