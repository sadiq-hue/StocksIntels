const { pool } = require('./db');
async function main() {
  const schema = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'support_tickets'");
  console.log('=== SUPPORT_TICKETS SCHEMA ===');
  schema.rows.forEach(r => console.log(r.column_name, r.data_type));
  const cnt = await pool.query('SELECT COUNT(*)::int FROM support_tickets');
  console.log('\nCount:', cnt.rows[0].count);
  if (cnt.rows[0].count > 0) {
    const data = await pool.query('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 5');
    data.rows.forEach(r => console.log(r));
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
