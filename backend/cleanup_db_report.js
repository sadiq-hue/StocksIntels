require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function q(sql) {
  const res = await pool.query(sql);
  return res.rows;
}

async function count(table, where = '') {
  const w = where ? ` WHERE ${where}` : '';
  const r = await pool.query(`SELECT COUNT(*) AS c FROM ${table}${w}`);
  return Number(r.rows[0].c);
}

async function main() {
  console.log('=== CONNECTING TO DATABASE... ===');
  await pool.query('SELECT 1');
  console.log('Connected!\n');

  // Database size
  const sz = await q("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
  console.log(`DATABASE SIZE: ${sz[0].size}\n`);

  // Safe cleanup: expired OTPs
  const expiredOtps = await count('otp_codes', 'expires_at < NOW()');
  console.log(`[SAFE] otp_codes expired: ${expiredOtps}`);
  if (expiredOtps > 0) {
    await pool.query('DELETE FROM otp_codes WHERE expires_at < NOW()');
    console.log(`  -> Deleted ${expiredOtps} expired OTP codes`);
  }

  // Safe cleanup: old engine_health
  const oldHealth = await count('engine_health', `recorded_at < NOW() - INTERVAL '7 days'`);
  console.log(`[SAFE] engine_health >7d: ${oldHealth}`);
  if (oldHealth > 0) {
    await pool.query(`DELETE FROM engine_health WHERE recorded_at < NOW() - INTERVAL '7 days'`);
    console.log(`  -> Deleted ${oldHealth} old health records`);
  }

  // Safe cleanup: used OTPs
  const usedOtps = await count('otp_codes', 'used = true');
  console.log(`[SAFE] otp_codes used: ${usedOtps}`);
  if (usedOtps > 0) {
    await pool.query('DELETE FROM otp_codes WHERE used = true');
    console.log(`  -> Deleted ${usedOtps} used OTP codes`);
  }

  console.log('\n=== WHAT CAN BE CLEANED (you choose) ===\n');

  const items = [
    { name: 'signal_audit_log >30d', desc: 'Audit logs for signal events', table: 'signal_audit_log', where: `recorded_at < NOW() - INTERVAL '30 days'` },
    { name: 'user_activity_log >30d', desc: 'User login/action logs', table: 'user_activity_log', where: `created_at < NOW() - INTERVAL '30 days'` },
    { name: 'notifications >30d', desc: 'User notifications', table: 'notifications', where: `created_at < NOW() - INTERVAL '30 days'` },
    { name: 'admin_audit_log >365d', desc: 'Admin action logs', table: 'admin_audit_log', where: `created_at < NOW() - INTERVAL '365 days'` },
    { name: 'broker_account_snapshots >90d', desc: 'Broker account snapshots', table: 'broker_account_snapshots', where: `recorded_at < NOW() - INTERVAL '90 days'` },
    { name: 'forward_predictions >365d', desc: 'ML forward predictions', table: 'forward_predictions', where: `generated_at < NOW() - INTERVAL '365 days'` },
    { name: 'paper_trades >90d', desc: 'Paper trading history', table: 'paper_trades', where: `created_at < NOW() - INTERVAL '90 days'` },
    { name: 'trade_log >90d', desc: 'Actual trade log', table: 'trade_log', where: `executed_at < NOW() - INTERVAL '90 days'` },
    { name: 'signal_history >365d', desc: 'Generated trading signals', table: 'signal_history', where: `generated_at < NOW() - INTERVAL '365 days'` },
    { name: 'prediction_log >90d', desc: 'Signal prediction outcomes', table: 'prediction_log', where: `created_at < NOW() - INTERVAL '90 days'` },
    { name: 'portfolio_value_history >180d', desc: 'Portfolio value snapshots', table: 'portfolio_value_history', where: `snapshot_date < NOW() - INTERVAL '180 days'` },
    { name: 'market_data >90d', desc: 'Historical stock prices (OHLCV)', table: 'market_data', where: `"timestamp" < NOW() - INTERVAL '90 days'` },
    { name: 'financial_statements file_data >30d', desc: 'PDF binary data (keeps metadata)', table: 'financial_statements', where: `uploaded_at < NOW() - INTERVAL '30 days' AND file_data IS NOT NULL`, isUpdate: true },
    { name: 'messages >60d', desc: 'Chat messages', table: 'messages', where: `created_at < NOW() - INTERVAL '60 days'` },
  ];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const c = await count(item.table, item.where);
    const total = await count(item.table);
    console.log(`  ${String(i + 1).padStart(2)}. ${item.name}: ${c} / ${total} rows  -- ${item.desc}`);
  }

  // Total size of these tables
  console.log('\n=== TABLE SIZES ===');
  const sizes = await q(`
    SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
    FROM pg_catalog.pg_statio_user_tables
    WHERE relname IN ('market_data','financial_statements','signal_history','signal_audit_log','prediction_log',
      'user_activity_log','paper_trades','trade_log','engine_health','messages','portfolio_value_history',
      'broker_account_snapshots','forward_predictions','otp_codes','notifications','admin_audit_log')
    ORDER BY pg_total_relation_size(relid) DESC
  `);
  for (const s of sizes) {
    console.log(`  ${s.relname.padEnd(30)} ${s.size}`);
  }

  const sz2 = await q("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
  console.log(`\nCURRENT DATABASE SIZE: ${sz2[0].size}`);
  console.log('\nDone. Decide what to clean and tell me the numbers (e.g. "1,2,5" or "all").');

  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
