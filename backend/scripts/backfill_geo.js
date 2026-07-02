const { pool } = require('../db');
const axios = require('axios');

async function backfillGeo() {
  const { rows } = await pool.query(
    "SELECT id, email, ip_address FROM users WHERE ip_address IS NOT NULL AND ip_address != '' AND ip_address != 'unknown' AND ip_address != '127.0.0.1' AND ip_address != '::1' AND (country IS NULL OR country = '')"
  );
  console.log(`Found ${rows.length} users to backfill`);
  let done = 0, fail = 0;
  for (const u of rows) {
    try {
      const res = await axios.get(`https://ipapi.co/${u.ip_address}/json/`, { timeout: 5000 });
      if (res.data && res.data.error !== true) {
        await pool.query(
          `UPDATE users SET country = $1, city = $2, region = $3, latitude = $4, longitude = $5 WHERE id = $6`,
          [res.data.country_name || null, res.data.city || null, res.data.region || null, res.data.latitude || null, res.data.longitude || null, u.id]
        );
        console.log(`  [${++done}] ${u.email} -> ${[res.data.city, res.data.region, res.data.country_name].filter(Boolean).join(', ') || '?'}`);
      } else {
        console.log(`  [x] ${u.email} -> api error: ${JSON.stringify(res.data)}`);
        fail++;
      }
    } catch (e) {
      console.log(`  [x] ${u.email} -> ${e.message}`);
      fail++;
    }
    if (rows.length > 1) await new Promise(r => setTimeout(r, 200));
  }
  console.log(`\nDone: ${done} updated, ${fail} failed`);
  pool.end();
}

backfillGeo();
