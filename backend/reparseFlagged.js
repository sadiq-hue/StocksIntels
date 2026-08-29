require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');
const { parsePdfBuffer } = require('./jsParser');
const { inferPeriodType } = require('./nseReportTypes');

// Flagged tickers to refresh. Override with FLAG=IMH,KCB for a subset test.
const FLAGGED = (process.env.FLAG || 'ABSA,BAT,BOC,CABL,COOP,DTK,IMH,KCB,LIMT,NCBA,SLAM,TPSE')
  .split(',').map(s => s.trim()).filter(Boolean);

// A source filename is an annual (full-year) report if it says "Year Ended" /
// "Full Year" / "Annual", or is "Audited" (interims are unaudited).
function isAnnualCue(fn) {
  const s = String(fn).toLowerCase();
  return /\byear[-\s]?ended\b|\byear ended\b|full[-\s]?year|\byear-end\b|annual/.test(s) || /\baudited\b/.test(s);
}

function maxLarge(o) {
  return Math.max(o.total_assets || 0, o.total_revenue || 0, o.total_liabilities || 0, o.shareholders_equity || 0, o.net_income || 0);
}
function monthOf(pedText) { return parseInt(String(pedText).slice(5, 7), 10); }

(async () => {
  const rows = await pool.query(
    `SELECT fs.id, s.ticker, fs.period_end_date::text AS ped, fs.file_name, fs.status, fs.parsed_data, fs.period_type, fs.processed_by
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market='NSE' AND s.ticker = ANY($1)`,
    [FLAGGED]
  );
  const dir = path.join(__dirname, 'verify_pdfs');
  const cache = new Set(fs.readdirSync(dir));

  // ── 1. Guarded re-extraction (deterministic-scale parser) ──
  let reparsed = 0, kept = 0, reverted = 0;
  for (const r of rows.rows) {
    const fn = String(r.file_name).replace(/\r/g, '');
    const dest = path.join(dir, fn);
    if (!cache.has(fn) || !fs.existsSync(dest)) { console.log('NO CACHE', r.ticker, fn); continue; }
    const before = { status: r.status, parsed_data: r.parsed_data, processed_by: r.processed_by };
    const beforeCount = Object.keys(r.parsed_data || {}).length;
    const buf = fs.readFileSync(dest);
    console.log(`REPARSE ${r.ticker} ${r.ped} (id ${r.id}, before=${beforeCount} metrics, pt=${r.period_type})`);
    await parsePdfBuffer(buf, r.id, { ticker: r.ticker, period_end_date: r.ped, period_type: r.period_type });
    const a = (await pool.query(`SELECT status, parsed_data, processed_by FROM financial_statements WHERE id=$1`, [r.id])).rows[0];
    const aData = a.parsed_data || {};
    const afterCount = Object.keys(aData).length;
    // Keep the re-extracted value whenever it is plausibly scaled and has a
    // usable number of metrics — even if sparser than the original (the
    // original may itself be a 1000x scaling error). Only revert on a hard
    // failure, a gross over-scale, or an almost-empty extraction.
    if (a.status !== 'completed' || afterCount < 6 || maxLarge(aData) > 1e13) {
      await pool.query(`UPDATE financial_statements SET status=$1, parsed_data=$2, processed_by=$3 WHERE id=$4`,
        [before.status, JSON.stringify(before.parsed_data), before.processed_by, r.id]);
      console.log(`  -> REVERTED (status=${a.status}, metrics=${afterCount}, maxLarge=${maxLarge(aData)})`);
      reverted++;
    } else {
      const note = afterCount < beforeCount ? ` (sparser than before ${beforeCount})` : '';
      console.log(`  -> KEPT (status=${a.status}, metrics=${afterCount}, maxLarge=${maxLarge(aData)}, by=${a.processed_by})${note}`);
      kept++;
    }
    reparsed++;
  }
  console.log(`\nRE-EXTRACT reparsed=${reparsed} kept=${kept} reverted=${reverted}`);

  // ── 2. Re-derive period_type from source-filename cadence ──
  const all = await pool.query(
    `SELECT fs.id, s.ticker, fs.period_end_date::text AS ped, fs.file_name, fs.period_type
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market='NSE'`
  );
  const byTicker = {};
  for (const r of all.rows) (byTicker[r.ticker] = byTicker[r.ticker] || []).push(r);

  let ptChanged = 0;
  for (const [ticker, list] of Object.entries(byTicker)) {
    const months = {};
    for (const r of list) {
      if (isAnnualCue(r.file_name)) {
        const m = monthOf(r.ped);
        months[m] = (months[m] || 0) + 1;
      }
    }
    let fye = null, best = 0;
    for (const [m, c] of Object.entries(months)) if (c > best) { best = c; fye = +m; }
    if (!fye) continue; // no clear annual cue; leave labels as-is
    for (const r of list) {
      // FYE-month reports are full-year; everything else is interim — use the
      // shared classifier for half-year (Jun) vs quarterly (Mar/Sep) granularity.
      const newPt = (monthOf(r.ped) === fye) ? 'annual' : inferPeriodType(r.file_name, r.ped);
      if (newPt !== r.period_type) {
        await pool.query(`UPDATE financial_statements SET period_type=$1 WHERE id=$2`, [newPt, r.id]);
        ptChanged++;
      }
    }
  }
  console.log(`PERIOD_TYPE changed=${ptChanged}`);

  // ── 3. Sanity: no ticker/year should have >1 annual ──
  const chk = await pool.query(
    `SELECT s.ticker, EXTRACT(YEAR FROM fs.period_end_date)::int AS yr, COUNT(*) AS c
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market='NSE' AND fs.period_type='annual'
     GROUP BY s.ticker, yr ORDER BY s.ticker, yr`
  );
  const per = {};
  for (const r of chk.rows) per[r.ticker + ' ' + r.yr] = r.c;
  let conflicts = 0;
  for (const [k, c] of Object.entries(per)) if (c > 1) { conflicts++; console.log('  CONFLICT', k, c); }
  console.log('Tickers/years with >1 annual after fix:', conflicts);

  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
