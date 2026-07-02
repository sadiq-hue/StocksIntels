const { pool } = require('../db');
const axios = require('axios');

async function backfillGeo() {
  const { rows } = await pool.query(
    "SELECT id, email, ip_address FROM users WHERE ip_address IS NOT NULL AND ip_address != '' AND ip_address != 'unknown' AND ip_address != '127.0.0.1' AND ip_address != '::1' AND (country IS NULL OR country = '')"
  );
  console.log(`Found ${rows.length} users to backfill`);
  let done = 0, fail = 0;
  for (const u of rows) {
    let geo = null;
    // Try ip-api.com first
    try {
      const r = await axios.get(`http://ip-api.com/json/${u.ip_address}`, { timeout: 5000 });
      if (r.data && r.data.status === 'success') {
        geo = { country: r.data.country, city: r.data.city, region: r.data.regionName, latitude: r.data.lat, longitude: r.data.lon };
      }
    } catch { /* fall through */ }
    // Fallback to ipapi.co
    if (!geo) {
      try {
        const r = await axios.get(`https://ipapi.co/${u.ip_address}/json/`, { timeout: 5000 });
        if (r.data && r.data.error !== true) {
          geo = { country: r.data.country_name, city: r.data.city, region: r.data.region, latitude: r.data.latitude, longitude: r.data.longitude };
        }
      } catch { /* fall through */ }
    }
    if (geo) {
      await pool.query(
        `UPDATE users SET country = $1, city = $2, region = $3, latitude = $4, longitude = $5 WHERE id = $6`,
        [geo.country, geo.city, geo.region, geo.latitude, geo.longitude, u.id]
      );
      console.log(`  [${++done}] ${u.email} -> ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ') || '?'}`);
    } else {
      console.log(`  [x] ${u.email} -> lookup failed`);
      fail++;
    }
    if (rows.length > 1) await new Promise(r => setTimeout(r, 200));
  }
  console.log(`\nDone: ${done} updated, ${fail} failed`);
  pool.end();
}

backfillGeo();
