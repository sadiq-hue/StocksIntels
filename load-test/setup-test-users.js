require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NUM_USERS = parseInt(process.env.LOAD_TEST_USERS || '50', 10);
const PASSWORD = process.env.LOAD_TEST_PASSWORD || 'TestPass123!';
const CSV_PATH = process.env.USERS_CSV || path.join(__dirname, 'users.csv');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'stockintel',
        password: process.env.DB_PASSWORD || 'stockintel',
        database: process.env.DB_NAME || 'stockintel',
      }
);

async function setup() {
  console.log(`Creating ${NUM_USERS} test users...`);
  const users = [];

  for (let i = 1; i <= NUM_USERS; i++) {
    const email = `loadtest${i}@test.com`;
    const fullName = `Load Test User ${i}`;
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    try {
      await pool.query(
        `INSERT INTO users (full_name, email, password_hash, is_verified, role, trial_start_date)
         VALUES ($1, $2, $3, TRUE, 'trader', NOW())
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [fullName, email, passwordHash]
      );

      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      const userId = userResult.rows[0].id;

      await pool.query(
        `INSERT INTO paper_accounts (user_id, cash_balance, initial_capital, cash_balance_usd, initial_capital_usd)
         VALUES ($1, 1000000.00, 1000000.00, 10000.00, 10000.00)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      users.push({ email, password: PASSWORD });
    } catch (err) {
      console.error(`Failed to create user ${i} (${email}):`, err.message);
    }

    if (i % 10 === 0) process.stdout.write(`  ${i}/${NUM_USERS} created\n`);
  }

  const csvDir = path.dirname(CSV_PATH);
  if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir, { recursive: true });

  const csvContent = 'email,password\n' + users.map(u => `${u.email},${u.password}`).join('\n');
  fs.writeFileSync(CSV_PATH, csvContent, 'utf-8');

  console.log(`\nDone! Created ${users.length} test users.`);
  console.log(`CSV written to: ${CSV_PATH}`);
  console.log(`Password for all users: ${PASSWORD}`);

  await pool.end();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
