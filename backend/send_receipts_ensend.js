require('dotenv').config();
const { pool } = require('./db');
const { sendPaymentReceiptEmail } = require('./mailer');

async function main() {
  try {
    // Get all active starter subscribers
    const starters = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.subscription_tier
      FROM users u
      WHERE u.subscription_status = 'active' AND u.subscription_tier = 'starter'
      ORDER BY u.id
    `);
    console.log('Found', starters.rows.length, 'active starter subscribers');

    // Send receipts to all active starters
    for (const user of starters.rows) {
      try {
        await sendPaymentReceiptEmail(user.email, {
          userName: user.full_name,
          planName: 'Starter',
          amount: 130,
          currency: 'KES',
          period: 'monthly',
          durationMonths: 1,
          paymentMethod: 'M-Pesa',
          transactionRef: 'STARTER-RECEIPT-' + user.id + '-' + Date.now(),
          paidAt: new Date(),
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        console.log('✅ Receipt sent to', user.email, '(', user.full_name, ')');
      } catch (e) {
        console.error('❌ Failed to send receipt to', user.email, ':', e.message);
      }
    }

    // Also send to bathurusadiki@gmail.com as requested
    const sadiqUsers = await pool.query(`
      SELECT id, full_name, email, subscription_tier FROM users
      WHERE email = 'bathurusadiki@gmail.com'
    `);
    for (const user of sadiqUsers.rows) {
      try {
        await sendPaymentReceiptEmail(user.email, {
          userName: user.full_name,
          planName: 'Starter',
          amount: 130,
          currency: 'KES',
          period: 'monthly',
          durationMonths: 1,
          paymentMethod: 'M-Pesa',
          transactionRef: 'STARTER-RECEIPT-' + user.id + '-' + Date.now(),
          paidAt: new Date(),
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        console.log('✅ Receipt sent to', user.email, '(', user.full_name, ')');
      } catch (e) {
        console.error('❌ Failed to send receipt to', user.email, ':', e.message);
      }
    }

    console.log('Done sending receipts');
  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}

main();
