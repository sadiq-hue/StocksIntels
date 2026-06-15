const { pool } = require('./db');
async function main() {
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%ticket%' OR table_name LIKE '%contact%' OR table_name LIKE '%support%'");
  console.log('=== RELATED TABLES ===');
  tables.rows.forEach(r => console.log(r.table_name));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
