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
    console.log(`[seedNseData] existing NSE statements in DB: ${existing.rows[0].c}, in seed: ${uniqueKeys.size}`);
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

    if (!st.period_end_date) {
      console.warn(`[seedNseData] Skipping ${st.ticker} ${st.period_type}: null period_end_date`);
      skipped++;
      continue;
    }

    const dup = await pool.query(
      `SELECT id, status FROM financial_statements
       WHERE stock_id = $1
         AND (period_end_date AT TIME ZONE 'Africa/Nairobi')::date = $2::date
         AND period_type = $3 LIMIT 1`,
      [stockId, st.period_end_date, st.period_type]
    );
    if (dup.rows.length > 0) {
      if (dup.rows[0].status === 'pending_review') {
        console.log(`[seedNseData] Skipping ${st.ticker} ${st.period_type} ${st.period_end_date}: pending_review exists, won't overwrite`);
        skipped++;
        continue;
      }
      const upd = await pool.query(
        `UPDATE financial_statements SET
           parsed_data = $1,
           status = $2,
           processed_by = $3,
           file_name = $4,
           file_size = $5,
           mime_type = $6,
           uploaded_at = COALESCE(uploaded_at, NOW())
         WHERE stock_id = $7
           AND (period_end_date AT TIME ZONE 'Africa/Nairobi')::date = $8::date
           AND period_type = $9`,
        [
          st.parsed_data,
          st.status || 'completed',
          st.processed_by || 'seed',
          st.file_name,
          st.file_size,
          st.mime_type,
          stockId, st.period_end_date, st.period_type
        ]
      );
      if (upd.rowCount > 0) skipped++;
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
        new Date(`${st.period_end_date}T00:00:00.000Z`),
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

  const seedKeys = new Set(
    statements
      .filter((st) => st.period_end_date)
      .map((st) => `${st.ticker}|${st.period_end_date}|${st.period_type}`)
  );
  // The seed file is a static snapshot of historical NSE statements. The orphan
  // cleanup below is meant to remove stale/renamed seed rows — NOT freshly
  // auto-detected reports. Guard with the seed's own max period so post-seed
  // periods (e.g. H1 2026, which the NSE detector adds at runtime) are never
  // wiped on redeploy, which would otherwise trigger a re-parse + email loop.
  let maxSeedDate = null;
  for (const st of statements) {
    if (st.period_end_date && (!maxSeedDate || st.period_end_date > maxSeedDate)) maxSeedDate = st.period_end_date;
  }

  const exist = await pool.query(
    `SELECT fs.id, s.ticker,
            (fs.period_end_date AT TIME ZONE 'Africa/Nairobi')::date::text AS nb_date,
            fs.period_type
     FROM financial_statements fs
     JOIN stocks s ON s.id = fs.stock_id
     WHERE s.market = 'NSE'
       -- Never delete rows the auto-detector is holding for admin review; they
       -- are in-flight and not part of the static seed by design.
       AND fs.status <> 'pending_review'
       -- Only consider periods the seed itself covers; anything newer is the
       -- detector's territory and must be preserved.
       AND ($1::date IS NULL OR (fs.period_end_date AT TIME ZONE 'Africa/Nairobi')::date <= $1::date)`,
    [maxSeedDate]
  );
  const orphanIds = exist.rows
    .filter((r) => !seedKeys.has(`${r.ticker}|${String(r.nb_date).slice(0, 10)}|${r.period_type}`))
    .map((r) => r.id);
  let orphanDeleted = 0;
  if (orphanIds.length > 0) {
    const del = await pool.query('DELETE FROM financial_statements WHERE id = ANY($1)', [orphanIds]);
    orphanDeleted = del.rowCount || 0;
  }

  console.log(`[seedNseData] Upserted ${stockUpserts} new stocks; inserted ${inserted} statements (${skipped} updated as duplicates), ${orphanDeleted} orphans removed`);
  return { stockUpserts, inserted, skipped, orphanDeleted };
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
