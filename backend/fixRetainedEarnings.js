require('dotenv').config();
const { pool } = require('./db');

(async () => {
  const r = await pool.query(
    `SELECT fs.id, s.ticker, fs.period_end_date,
            (fs.parsed_data->>'retained_earnings')::numeric AS re,
            (fs.parsed_data->>'total_assets')::numeric AS ta
     FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market='NSE' AND fs.status='completed'
       AND fs.parsed_data ? 'retained_earnings' AND fs.parsed_data ? 'total_assets'`
  );
  const bad = [];
  for (const row of r.rows) {
    const re = Number(row.re), ta = Number(row.ta);
    if (ta > 0 && Math.abs(re) > ta) {
      bad.push({ id: row.id, ticker: row.ticker, period: row.period_end_date, re, ta });
    }
  }
  console.log('Candidates (|retained_earnings| > total_assets):');
  for (const b of bad) console.log(`  ${b.ticker} ${b.period}  re=${b.re}  ta=${b.ta}`);

  for (const b of bad) {
    await pool.query(
      `UPDATE financial_statements
       SET parsed_data = jsonb_set(parsed_data, '{retained_earnings}', 'null')
       WHERE id = $1`,
      [b.id]
    );
    console.log(`  -> nulled retained_earnings for ${b.ticker} ${b.period} (id ${b.id})`);
  }
  console.log(`Done. Fixed ${bad.length} statement(s).`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
