const { pool } = require('./db');
async function main() {
  for (const tbl of ['support_messages', 'support_chat_messages', 'contact_requests', 'contact_messages', 'inquiries']) {
    try {
      const cnt = await pool.query('SELECT COUNT(*)::int as cnt FROM ' + tbl);
      console.log(tbl + ':', cnt.rows[0].count);
    } catch { console.log(tbl + ': not found'); }
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
