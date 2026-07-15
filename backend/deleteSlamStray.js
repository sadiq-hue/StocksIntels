require('dotenv').config();
const { pool } = require('./db');
(async () => {
  const r = await pool.query(
    `SELECT fs.id FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.ticker='SLAM' AND fs.period_end_date IS NULL AND fs.status='completed'`
  );
  for (const row of r.rows) {
    await pool.query(`DELETE FROM financial_statements WHERE id=$1`, [row.id]);
    console.log(`Deleted SLAM stray statement id=${row.id} (period=NULL, garbage data)`);
  }
  if (r.rows.length === 0) console.log('No SLAM NULL-period statement found.');
  await pool.end();
})();
