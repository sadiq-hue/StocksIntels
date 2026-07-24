require('dotenv').config();
const { Pool } = require('pg');
const readline = require('readline');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('@localhost')
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function query(sql) {
  const res = await pool.query(sql);
  return res.rows;
}

async function count(tableName, whereClause = '') {
  const w = whereClause ? ` WHERE ${whereClause}` : '';
  const res = await pool.query(`SELECT COUNT(*) AS count FROM ${tableName}${w}`);
  return Number(res.rows[0].count);
}

async function main() {
  console.log('=== SAFE CLEANUP (no confirmation needed) ===\n');

  // 1. Expired OTP codes - definitely safe
  const expiredOtps = await count('otp_codes', 'expires_at < NOW()');
  console.log(`otp_codes: ${expiredOtps} expired codes`);
  if (expiredOtps > 0) {
    await pool.query('DELETE FROM otp_codes WHERE expires_at < NOW()');
    console.log(`  -> Deleted ${expiredOtps} expired OTP codes\n`);
  }

  // 2. Old engine_health - just monitoring noise
  const oldHealth = await count('engine_health', 'recorded_at < NOW() - INTERVAL \'7 days\'');
  console.log(`engine_health: ${oldHealth} rows older than 7 days`);
  if (oldHealth > 0) {
    await pool.query('DELETE FROM engine_health WHERE recorded_at < NOW() - INTERVAL \'7 days\'');
    console.log(`  -> Deleted ${oldHealth} old health records\n`);
  }

  console.log('\n=== NEEDS YOUR INPUT (showing what CAN be cleaned) ===\n');

  const items = [
    {
      name: 'signal_audit_log',
      days: 30,
      desc: 'Audit logs for signal events',
      check: async () => {
        const old = await count('signal_audit_log', 'recorded_at < NOW() - INTERVAL \'30 days\'');
        const total = await count('signal_audit_log');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM signal_audit_log WHERE recorded_at < NOW() - INTERVAL \'30 days\'')
    },
    {
      name: 'user_activity_log',
      days: 30,
      desc: 'User login/action logs',
      check: async () => {
        const old = await count('user_activity_log', 'created_at < NOW() - INTERVAL \'30 days\'');
        const total = await count('user_activity_log');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM user_activity_log WHERE created_at < NOW() - INTERVAL \'30 days\'')
    },
    {
      name: 'otp_codes (all)',
      days: 0,
      desc: 'All OTP codes (used or expired)',
      check: async () => {
        const used = await count('otp_codes', 'used = true');
        const total = await count('otp_codes');
        return { old: used, total };
      },
      clean: () => pool.query('DELETE FROM otp_codes WHERE used = true')
    },
    {
      name: 'notifications',
      days: 30,
      desc: 'User notifications',
      check: async () => {
        const old = await count('notifications', 'created_at < NOW() - INTERVAL \'30 days\'');
        const total = await count('notifications');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM notifications WHERE created_at < NOW() - INTERVAL \'30 days\'')
    },
    {
      name: 'admin_audit_log',
      days: 60,
      desc: 'Admin action logs',
      check: async () => {
        const old = await count('admin_audit_log', 'created_at < NOW() - INTERVAL \'60 days\'');
        const total = await count('admin_audit_log');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM admin_audit_log WHERE created_at < NOW() - INTERVAL \'60 days\'')
    },
    {
      name: 'broker_account_snapshots',
      days: 90,
      desc: 'Broker account snapshots',
      check: async () => {
        const old = await count('broker_account_snapshots', 'recorded_at < NOW() - INTERVAL \'90 days\'');
        const total = await count('broker_account_snapshots');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM broker_account_snapshots WHERE recorded_at < NOW() - INTERVAL \'90 days\'')
    },
    {
      name: 'forward_predictions',
      days: 90,
      desc: 'ML forward predictions',
      check: async () => {
        const old = await count('forward_predictions', 'created_at < NOW() - INTERVAL \'90 days\'');
        const total = await count('forward_predictions');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM forward_predictions WHERE created_at < NOW() - INTERVAL \'90 days\'')
    },
    {
      name: 'paper_trades',
      days: 90,
      desc: 'Paper trading history',
      check: async () => {
        const old = await count('paper_trades', 'created_at < NOW() - INTERVAL \'90 days\'');
        const total = await count('paper_trades');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM paper_trades WHERE created_at < NOW() - INTERVAL \'90 days\'')
    },
    {
      name: 'trade_log',
      days: 90,
      desc: 'Actual trade log',
      check: async () => {
        const old = await count('trade_log', 'executed_at < NOW() - INTERVAL \'90 days\'');
        const total = await count('trade_log');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM trade_log WHERE executed_at < NOW() - INTERVAL \'90 days\'')
    },
    {
      name: 'signal_history',
      days: 60,
      desc: 'Generated trading signals',
      check: async () => {
        const old = await count('signal_history', 'generated_at < NOW() - INTERVAL \'60 days\'');
        const total = await count('signal_history');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM signal_history WHERE generated_at < NOW() - INTERVAL \'60 days\'')
    },
    {
      name: 'prediction_log',
      days: 90,
      desc: 'Signal prediction outcomes',
      check: async () => {
        const old = await count('prediction_log', 'created_at < NOW() - INTERVAL \'90 days\'');
        const total = await count('prediction_log');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM prediction_log WHERE created_at < NOW() - INTERVAL \'90 days\'')
    },
    {
      name: 'portfolio_value_history',
      days: 180,
      desc: 'Portfolio value snapshots',
      check: async () => {
        const old = await count('portfolio_value_history', 'snapshot_date < NOW() - INTERVAL \'180 days\'');
        const total = await count('portfolio_value_history');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM portfolio_value_history WHERE snapshot_date < NOW() - INTERVAL \'180 days\'')
    },
    {
      name: 'market_data',
      days: 90,
      desc: 'Historical stock prices (OHLCV)',
      check: async () => {
        const old = await count('market_data', '"timestamp" < NOW() - INTERVAL \'90 days\'');
        const total = await count('market_data');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM market_data WHERE "timestamp" < NOW() - INTERVAL \'90 days\'')
    },
    {
      name: 'financial_statements (file_data only)',
      days: 30,
      desc: 'PDF binary data (>30 days old, keeps metadata)',
      check: async () => {
        const rows = await query(`SELECT COUNT(*) AS count FROM financial_statements WHERE uploaded_at < NOW() - INTERVAL '30 days' AND file_data IS NOT NULL`);
        const total = await count('financial_statements');
        return { old: Number(rows[0].count), total };
      },
      clean: () => pool.query('UPDATE financial_statements SET file_data = NULL WHERE uploaded_at < NOW() - INTERVAL \'30 days\' AND file_data IS NOT NULL')
    },
    {
      name: 'messages',
      days: 60,
      desc: 'Chat messages',
      check: async () => {
        const old = await count('messages', 'created_at < NOW() - INTERVAL \'60 days\'');
        const total = await count('messages');
        return { old, total };
      },
      clean: () => pool.query('DELETE FROM messages WHERE created_at < NOW() - INTERVAL \'60 days\'')
    },
  ];

  for (const item of items) {
    const { old, total } = await item.check();
    console.log(`${item.name}: ${old} / ${total} rows deletable (${item.desc})`);
  }

  console.log('\n--- Which to clean? ---');
  console.log('Enter numbers separated by commas (e.g. 1,2,5)');
  console.log('Or "all" to clean everything above');
  console.log('Or "none" to skip');
  console.log('');

  const answer = await ask('Your choice: ');
  const choices = answer.trim().toLowerCase();

  if (choices === 'none') {
    console.log('Nothing cleaned.');
  } else {
    let indices;
    if (choices === 'all') {
      indices = items.map((_, i) => i);
    } else {
      indices = choices.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < items.length);
    }

    for (const i of indices) {
      const item = items[i];
      const { old } = await item.check();
      if (old > 0) {
        await item.clean();
        console.log(`  Cleaned ${item.name}: removed ${old} rows`);
      } else {
        console.log(`  Skipped ${item.name}: nothing to clean`);
      }
    }
  }

  console.log('\n=== FINAL DATABASE SIZE ===');
  const size = await query("SELECT pg_size_pretty(pg_database_size(current_database())) AS size");
  console.log(`Database size: ${size[0].size}`);

  rl.close();
  await pool.end();
  console.log('Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
