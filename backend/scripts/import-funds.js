// Bulk fund-data importer.
//
// Usage:
//   node scripts/import-funds.js <file.csv> ["source label"] [YYYY-MM-DD]
//
// The CSV must have a header row. Recognised columns (aliases in
// specialFundsService.CSV_ALIASES): id, name, currency, yield_pct,
// one_year_return_pct, three_year_return_pct, ytd_return_pct, nav, aum,
// min_investment, management_fee_pct, expense_ratio_pct, risk_level,
// observation_date, source, source_url, ... Rows are matched to existing funds
// by id or name, otherwise created.
const fs = require('fs');
const path = require('path');
const { parseCsv, bulkIngest, ensureTable } = require('../specialFundsService');

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-funds.js <file.csv> ["source label"] [YYYY-MM-DD]');
    process.exit(1);
  }
  const csv = fs.readFileSync(path.resolve(file), 'utf8');
  const rows = parseCsv(csv);
  if (!rows.length) { console.error('No data rows found in', file); process.exit(1); }

  await ensureTable();
  const defaults = {
    data_source: process.argv[3] || 'CLI CSV import',
    observation_date: process.argv[4] || new Date().toISOString().slice(0, 10),
  };
  const summary = await bulkIngest(rows, defaults);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch((e) => { console.error('Import failed:', e.message); process.exit(1); });
