require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { parsePdfBuffer } = require('./jsParser');

// Re-parse the statements that still mismatched under reliable Mistral OCR,
// using the SAME production pipeline (OCR + LLM extract + validate). Guarded:
// if the re-parse degrades (status != completed, or fewer metrics), we revert
// to the previously-stored values so we never lose data.
const ocr = JSON.parse(fs.readFileSync(path.join(__dirname, 'verify_report_ocr.json'), 'utf8'));
const targets = ocr
  .filter(s => s.summary && s.summary.mismatch > 0)
  .filter(s => !(s.ticker === 'SLAM' && (s.period === 'null' || s.period === null)))
  .map(s => ({ ticker: s.ticker, period: s.period }));

(async () => {
  const rows = await pool.query(
    `SELECT fs.id, s.ticker, fs.period_end_date, fs.period_type, fs.file_name, fs.status, fs.parsed_data, fs.processed_by
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market='NSE' AND fs.status='completed'`
  );
  const byKey = {};
  for (const r of rows.rows) byKey[r.ticker + '|' + (r.period_end_date ? r.period_end_date.toISOString().slice(0, 10) : 'null')] = r;

  const dir = path.join(__dirname, 'verify_pdfs');
  let reparsed = 0, kept = 0, reverted = 0;
  for (const t of targets) {
    const key = t.ticker + '|' + (t.period || 'null');
    const row = byKey[key];
    if (!row) { console.log('NO ROW', key); continue; }
    const dest = path.join(dir, row.file_name);
    if (!fs.existsSync(dest)) { console.log('NO CACHE', row.file_name); continue; }
    const before = { parsed_data: row.parsed_data, status: row.status, processed_by: row.processed_by };
    const beforeCount = Object.keys(row.parsed_data || {}).length;
    const buf = fs.readFileSync(dest);
    console.log(`REPARSE ${t.ticker} ${t.period} (id ${row.id}, before=${beforeCount} metrics)`);
    await parsePdfBuffer(buf, row.id, { ticker: row.ticker, period_end_date: row.period_end_date, period_type: row.period_type });
    const a = (await pool.query(`SELECT status, parsed_data, processed_by FROM financial_statements WHERE id=$1`, [row.id])).rows[0];
    const afterCount = Object.keys(a.parsed_data || {}).length;
    if (a.status !== 'completed' || afterCount < beforeCount) {
      await pool.query(`UPDATE financial_statements SET status=$1, parsed_data=$2, processed_by=$3 WHERE id=$4`,
        [before.status, JSON.stringify(before.parsed_data), before.processed_by, row.id]);
      console.log(`  -> REVERTED (new status=${a.status}, metrics=${afterCount})`);
      reverted++;
    } else {
      console.log(`  -> KEPT (status=${a.status}, metrics=${afterCount}, by=${a.processed_by})`);
      kept++;
    }
    reparsed++;
  }
  console.log(`\nDONE reparsed=${reparsed} kept=${kept} reverted=${reverted}`);
  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
