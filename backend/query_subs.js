const { pool } = require('./db');
const { sendPaymentReceiptEmail } = require('./mailer');

async function main() {
  try {
    // Check if duration_months column exists
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'payment_transactions' AND column_name = 'duration_months'
    `);
    console.log('duration_months column exists:', colCheck.rows.length > 0);

    // Get all active subscribers
    const result = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.subscription_tier, u.subscription_status,
             u.subscription_start_date, u.subscription_end_date
      FROM users u
      WHERE u.subscription_status = 'active' AND u.subscription_tier != 'free'
      ORDER BY u.id
    `);
    console.log('Found', result.rows.length, 'active subscribers');

    // Also check if bathurusadiki@gmail.com exists
    const sadiq = await pool.query(`
      SELECT id, full_name, email, subscription_tier, subscription_status
      FROM users WHERE email = 'bathurusadiki@gmail.com'
    `);
    console.log('bathurusadiki@gmail.com found:', sadiq.rows.length > 0);
    if (sadiq.rows.length > 0) {
      console.log(JSON.stringify(sadiq.rows[0]));
    }

  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}

main();
