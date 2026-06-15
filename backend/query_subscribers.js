const { pool } = require('./db');

async function getActiveSubscribers() {
  try {
    const result = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.subscription_tier, u.subscription_status,
             u.subscription_start_date, u.subscription_end_date
      FROM users u
      WHERE u.subscription_status = 'active' AND u.subscription_tier != 'free'
      ORDER BY u.id
    `);
    console.log('Found', result.rows.length, 'active subscribers');
    result.rows.forEach(row => {
      console.log(JSON.stringify(row));
    });
  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}

getActiveSubscribers();
