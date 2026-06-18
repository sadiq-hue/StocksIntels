const { pool } = require('./db');
const { sendPaymentReceiptEmail } = require('./mailer');

async function main() {
  try {
    // Get active starter/nsepro/pro subscribers
    const starters = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.subscription_tier
      FROM users u
      WHERE u.subscription_status = 'active' AND u.subscription_tier IN ('starter', 'nse pro', 'pro', 'institutional')
      ORDER BY u.id
    `);
    console.log('Found', starters.rows.length, 'active paid subscribers');

    // Add duration_months column if missing
    await pool.query(`
      ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS duration_months INTEGER DEFAULT 1
    `);
    console.log('Added duration_months column if missing');

    // Map plan -> KES amount
    const planAmounts = { 'starter': 649, 'nse pro': 1039, 'pro': 1949, 'institutional': 26000 };
    for (const user of starters.rows) {
      try {
        const tier = (user.subscription_tier || 'starter').toLowerCase();
        const amount = planAmounts[tier] || 649;
        const planName = tier === 'nse pro' ? 'NSE Pro' : tier.charAt(0).toUpperCase() + tier.slice(1);
        await sendPaymentReceiptEmail(user.email, {
          userName: user.full_name,
          planName,
          amount,
          currency: 'KES',
          period: 'monthly',
          durationMonths: 1,
          paymentMethod: 'M-Pesa',
          transactionRef: (tier + '-receipt-' + user.id + '-' + Date.now()).toUpperCase(),
          paidAt: new Date(),
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        console.log(`✅ Receipt sent to ${user.email} (${user.full_name}) — ${planName} ${amount} KES`);
      } catch (e) {
        console.error(`❌ Failed to send receipt to ${user.email}:`, e.message);
      }
    }

    console.log('\\nDone sending receipts');
  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}

main();
