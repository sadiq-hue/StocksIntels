require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('@localhost')
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

async function run(label, sql) {
  console.log(`\n>> ${label}`);
  try {
    const res = await pool.query(sql);
    if (res.rows && res.rows.length) console.table(res.rows);
    else if (res.rowCount !== undefined) console.log(`   Deleted ${res.rowCount} rows`);
  } catch (e) {
    console.error(`   ERROR: ${e.message}`);
  }
}

async function main() {
  // 1. Database size before
  await run('DATABASE SIZE', "SELECT pg_size_pretty(pg_database_size(current_database())) AS size");

  // 2. Top 15 tables by size
  await run('TOP TABLES BY SIZE', `
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
           pg_size_pretty(pg_relation_size(relid)) AS table_only,
           pg_size_pretty(pg_indexes_size(relid)) AS index_size
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 15
  `);

  // 3. Row counts for key tables
  await run('ROW COUNTS', `
    SELECT 'market_data' AS t, COUNT(*) FROM market_data
    UNION ALL SELECT 'financial_statements', COUNT(*) FROM financial_statements
    UNION ALL SELECT 'signal_history', COUNT(*) FROM signal_history
    UNION ALL SELECT 'signal_audit_log', COUNT(*) FROM signal_audit_log
    UNION ALL SELECT 'prediction_log', COUNT(*) FROM prediction_log
    UNION ALL SELECT 'user_activity_log', COUNT(*) FROM user_activity_log
    UNION ALL SELECT 'paper_trades', COUNT(*) FROM paper_trades
    UNION ALL SELECT 'trade_log', COUNT(*) FROM trade_log
    UNION ALL SELECT 'engine_health', COUNT(*) FROM engine_health
    UNION ALL SELECT 'messages', COUNT(*) FROM messages
    UNION ALL SELECT 'portfolio_value_history', COUNT(*) FROM portfolio_value_history
    UNION ALL SELECT 'broker_account_snapshots', COUNT(*) FROM broker_account_snapshots
    UNION ALL SELECT 'forward_predictions', COUNT(*) FROM forward_predictions
    UNION ALL SELECT 'otp_codes', COUNT(*) FROM otp_codes
    UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
    UNION ALL SELECT 'admin_audit_log', COUNT(*) FROM admin_audit_log
    UNION ALL SELECT 'support_chat_messages', COUNT(*) FROM support_chat_messages
    UNION ALL SELECT 'support_messages', COUNT(*) FROM support_messages
    ORDER BY 2 DESC
  `);

  // 4. Delete old market_data (keep last 90 days)
  await run('DELETE market_data >90 days', `
    DELETE FROM market_data WHERE "timestamp" < NOW() - INTERVAL '90 days'
  `);

  // 5. Delete old financial_statements PDFs (keep metadata, remove file_data for >30 days)
  await run('TRUNCATE old financial_statements file_data >30 days', `
    UPDATE financial_statements SET file_data = NULL
    WHERE uploaded_at < NOW() - INTERVAL '30 days' AND file_data IS NOT NULL
  `);

  // 6. Delete old signal_history (keep last 60 days)
  await run('DELETE signal_history >60 days', `
    DELETE FROM signal_history WHERE generated_at < NOW() - INTERVAL '60 days'
  `);

  // 7. Delete old signal_audit_log (keep last 30 days)
  await run('DELETE signal_audit_log >30 days', `
    DELETE FROM signal_audit_log WHERE recorded_at < NOW() - INTERVAL '30 days'
  `);

  // 8. Delete old prediction_log (keep last 90 days)
  await run('DELETE prediction_log >90 days', `
    DELETE FROM prediction_log WHERE created_at < NOW() - INTERVAL '90 days'
  `);

  // 9. Delete old user_activity_log (keep last 30 days)
  await run('DELETE user_activity_log >30 days', `
    DELETE FROM user_activity_log WHERE created_at < NOW() - INTERVAL '30 days'
  `);

  // 10. Delete old paper_trades (keep last 90 days)
  await run('DELETE paper_trades >90 days', `
    DELETE FROM paper_trades WHERE created_at < NOW() - INTERVAL '90 days'
  `);

  // 11. Delete old trade_log (keep last 90 days)
  await run('DELETE trade_log >90 days', `
    DELETE FROM trade_log WHERE executed_at < NOW() - INTERVAL '90 days'
  `);

  // 12. Delete old engine_health (keep last 7 days)
  await run('DELETE engine_health >7 days', `
    DELETE FROM engine_health WHERE recorded_at < NOW() - INTERVAL '7 days'
  `);

  // 13. Delete old portfolio_value_history (keep last 180 days)
  await run('DELETE portfolio_value_history >180 days', `
    DELETE FROM portfolio_value_history WHERE snapshot_date < NOW() - INTERVAL '180 days'
  `);

  // 14. Delete old broker_account_snapshots (keep last 90 days)
  await run('DELETE broker_account_snapshots >90 days', `
    DELETE FROM broker_account_snapshots WHERE recorded_at < NOW() - INTERVAL '90 days'
  `);

  // 15. Delete old forward_predictions (keep last 90 days)
  await run('DELETE forward_predictions >90 days', `
    DELETE FROM forward_predictions WHERE created_at < NOW() - INTERVAL '90 days'
  `);

  // 16. Delete old OTP codes
  await run('DELETE expired otp_codes', `
    DELETE FROM otp_codes WHERE expires_at < NOW()
  `);

  // 17. Delete old messages (keep last 60 days)
  await run('DELETE messages >60 days', `
    DELETE FROM messages WHERE created_at < NOW() - INTERVAL '60 days'
  `);

  // 18. Delete old notifications
  await run('DELETE notifications >30 days', `
    DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'
  `);

  // 19. Delete old admin_audit_log (keep last 60 days)
  await run('DELETE admin_audit_log >60 days', `
    DELETE FROM admin_audit_log WHERE created_at < NOW() - INTERVAL '60 days'
  `);

  // 20. Run VACUUM on biggest tables
  console.log('\n>> Running VACUUM on cleaned tables...');
  const vacTables = [
    'market_data', 'financial_statements', 'signal_history',
    'signal_audit_log', 'prediction_log', 'user_activity_log',
    'paper_trades', 'trade_log', 'engine_health', 'messages',
    'portfolio_value_history', 'broker_account_snapshots', 'forward_predictions'
  ];
  for (const t of vacTables) {
    try {
      await pool.query(`VACUUM ${t}`);
      process.stdout.write(`  VACUUM ${t} OK\n`);
    } catch (e) {
      // VACUUM cannot run inside a transaction, skip gracefully
    }
  }

  // 21. Database size after
  await run('DATABASE SIZE AFTER CLEANUP', "SELECT pg_size_pretty(pg_database_size(current_database())) AS size");

  await pool.end();
  console.log('\nDone.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
