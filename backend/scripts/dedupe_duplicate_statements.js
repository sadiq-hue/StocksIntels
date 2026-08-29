// Maintenance: remove duplicate NSE financial_statement rows that share the same
// ticker + period_end_date + file_name (precise re-imports). Keeps the row whose
// period_type matches nseReportTypes.inferPeriodType(file_name, period_end_date),
// falling back to the lowest id. DRY=1 previews without deleting.
//
// Run from backend/ (uses .env):
//   DRY=1 node scripts/dedupe_duplicate_statements.js   # preview
//   node scripts/dedupe_duplicate_statements.js          # apply
require('dotenv').config();
const { pool } = require('../db');
const { inferPeriodType } = require('../nseReportTypes');

const DRY = process.env.DRY === '1';

(async () => {
  const groups = await pool.query(`
    SELECT s.ticker, fs.period_end_date::text AS ped, fs.file_name,
           array_agg(FORMAT('%s:%s:%s', fs.id, fs.period_type, COALESCE(fs.status,'')) ORDER BY fs.id) AS rows
    FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
    WHERE s.market = 'NSE'
    GROUP BY s.ticker, fs.period_end_date, fs.file_name
    HAVING COUNT(*) > 1
    ORDER BY s.ticker`);
  let deleted = 0;
  for (const g of groups.rows) {
    const entries = g.rows.map(r => { const [id, pt, status] = r.split(':'); return { id: +id, pt, status }; });
    const live = entries.filter(e => e.status === 'completed' || e.status === 'pending_review');
    const candidates = live.length ? live : entries;
    const expected = inferPeriodType(g.file_name, g.ped);
    const match = candidates.filter(e => e.pt === expected);
    const keep = (match.length ? match : candidates).sort((a, b) => a.id - b.id)[0];
    for (const e of entries) {
      if (e.id === keep.id) continue;
      console.log(`${DRY ? '[DRY] ' : ''}DELETE id=${e.id} (${g.ticker} ${g.ped} period_type=${e.pt}) keep=${keep.id} pt=${keep.pt} expected=${expected}`);
      if (!DRY) await pool.query(`DELETE FROM financial_statements WHERE id = $1`, [e.id]);
      deleted++;
    }
  }
  console.log(`\n${DRY ? 'PREVIEW' : 'APPLIED'}: groups=${groups.rows.length}, deleted=${deleted}`);
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });