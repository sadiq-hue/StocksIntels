const { pool } = require('../db');
(async () => {
  await pool.query("ALTER TABLE broker_account_snapshots ADD COLUMN IF NOT EXISTS trade_history JSONB DEFAULT '[]'::jsonb");
  console.log('OK');
  process.exit();
})().catch(e => { console.error(e.message); process.exit(1); });
