require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const r = await p.query("SELECT code FROM otp_codes WHERE email = $1 AND type = $2 AND used = FALSE ORDER BY created_at DESC LIMIT 1", ['bathurusadiki01@gmail.com', 'admin_login']);
  console.log('OTP:', r.rows[0]?.code);
  await p.end();
})();
