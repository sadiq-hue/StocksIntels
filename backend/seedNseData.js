require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

// Replays seed/seed/nse_statements.json into the current database. Used so that
// every environment (local + deployed) has NSE financial statements populated
// without needing to re-run the Mistral/NSE scraping pipeline. Idempotent:
// stocks are UPSERTed and statements are skipped if an identical period already
// exists. Maps by ticker -> stock_id at load time so it works regardless of how
// the target DB assigned serial IDs.
const SEED_FILE = path.join(__dirname, 'seed', 'nse_statements.json');

async function seedNseData({ force = false } = {}) {
  if (!fs.existsSync(SEED_FILE)) {
    console.log('[seedNseData] No seed file found, skipping');
    return { skipped: true };
  }
  const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const { stocks = [], statements = [] } = data;

  // Unique statement keys (ticker + period + type) — the JSON may contain
  // duplicate uploads for the same period, which we collapse on insert.
  const uniqueKeys = new Set(statements.map(s => `${s.ticker}|${s.period_end_date}|${s.period_type}`));

  // Quick guard: skip the (cheap) work if NSE completed statements already exist
  // at least as many unique periods as the seed describes.
  if (!force) {
    const existing = await pool.query(
      `SELECT COUNT(*)::int AS c FROM financial_statements fs
       JOIN stocks s ON s.id = fs.stock_id
       WHERE s.market = 'NSE' AND fs.status = 'completed'`
    );
    if (existing.rows[0].c >= uniqueKeys.size) {
      console.log(`[seedNseData] NSE data already present (${existing.rows[0].c} statements), skipping`);
      return { skipped: true, existing: existing.rows[0].c };
    }
  }

  let stockUpserts = 0;
  for (const s of stocks) {
    const r = await pool.query(
      `INSERT INTO stocks (ticker, name, sector, market, currency, is_active)
       VALUES ($1, $2, $3, 'NSE', $4, true)
       ON CONFLICT (ticker) DO UPDATE SET
         market = 'NSE',
         currency = EXCLUDED.currency,
         is_active = true,
         name = EXCLUDED.name
       RETURNING (xmax = 0) AS inserted`,
      [s.ticker, s.name, s.sector || 'Other', s.currency || 'KES']
    );
    if (r.rows[0] && r.rows[0].inserted) stockUpserts++;
  }

  let inserted = 0;
  let skipped = 0;
  for (const st of statements) {
    const sr = await pool.query('SELECT id FROM stocks WHERE UPPER(ticker) = $1', [st.ticker]);
    if (sr.rows.length === 0) {
      console.warn(`[seedNseData] No stock row for ticker ${st.ticker}, skipping statement`);
      skipped++;
      continue;
    }
    const stockId = sr.rows[0].id;

    const dup = await pool.query(
      `SELECT 1 FROM financial_statements
       WHERE stock_id = $1 AND period_end_date = $2 AND period_type = $3 LIMIT 1`,
      [stockId, st.period_end_date, st.period_type]
    );
    if (dup.rows.length > 0) {
      skipped++;
      continue;
    }

    await pool.query(
      `INSERT INTO financial_statements
        (stock_id, period_type, period_end_date, file_name, file_size, mime_type,
         status, parsed_data, error_message, processed_by, parsed_at, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($11, NOW()))`,
      [
        stockId,
        st.period_type,
        st.period_end_date,
        st.file_name,
        st.file_size || 0,
        st.mime_type || 'application/pdf',
        st.status || 'completed',
        st.parsed_data,
        st.error_message || null,
        st.processed_by || 'seed',
        st.parsed_at || null,
      ]
    );
    inserted++;
  }

  console.log(`[seedNseData] Upserted ${stockUpserts} new stocks; inserted ${inserted} statements (${skipped} skipped as duplicates)`);
  return { stockUpserts, inserted, skipped };
}

if (require.main === module) {
  seedNseData()
    .then(() => pool.end())
    .catch(async (e) => {
      console.error('[seedNseData] failed:', e.message);
      process.exit(1);
    });
}

module.exports = { seedNseData };
