require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

// One-off: dump NSE completed financial statements + their stock rows from the
// LOCAL database into backend/seed/nse_statements.json. This JSON is committed
// and replayed by seedNseData.js on every environment (including the deployed
// one) so NSE data is available without re-scraping Mistral/NSE.
(async () => {
  const res = await pool.query(`
    SELECT
      s.ticker,
      s.name      AS stock_name,
      s.sector,
      s.currency,
      fs.period_type,
      fs.period_end_date,
      fs.file_name,
      fs.file_size,
      fs.mime_type,
      fs.status,
      fs.parsed_data,
      fs.error_message,
      fs.processed_by,
      fs.parsed_at
    FROM financial_statements fs
    JOIN stocks s ON s.id = fs.stock_id
    WHERE s.market = 'NSE'
      AND fs.status = 'completed'
      AND fs.parsed_data IS NOT NULL
    ORDER BY s.ticker, fs.period_end_date
  `);

  const stocks = {};
  const statements = [];
  for (const r of res.rows) {
    stocks[r.ticker] = {
      ticker: r.ticker,
      name: r.stock_name,
      sector: r.sector || 'Other',
      currency: r.currency || 'KES',
    };
    statements.push({
      ticker: r.ticker,
      period_type: r.period_type,
      period_end_date: r.period_end_date ? r.period_end_date.toISOString().slice(0, 10) : null,
      file_name: r.file_name,
      file_size: r.file_size,
      mime_type: r.mime_type || 'application/pdf',
      status: r.status,
      parsed_data: r.parsed_data,
      error_message: r.error_message,
      processed_by: r.processed_by,
      parsed_at: r.parsed_at ? r.parsed_at.toISOString() : null,
    });
  }

  const out = { generatedAt: new Date().toISOString(), stocks: Object.values(stocks), statements };
  const dir = path.join(__dirname, 'seed');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'nse_statements.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Wrote ${statements.length} statements for ${Object.keys(stocks).length} NSE stocks to ${file}`);
  await pool.end();
})().catch(async (e) => {
  console.error('Dump failed:', e.message);
  process.exit(1);
});
