const { pool } = require('./db');
pool.query("SELECT 1 AS test")
  .then(r => { console.log('DB connected:', r.rows[0]); return pool.query("SELECT id, full_name, email, sentiment_opt_in FROM users ORDER BY id"); })
  .then(r => { console.log('Users:', JSON.stringify(r.rows, null, 2)); pool.end(); })
  .catch(e => { console.log('Error name:', e.name); console.log('Error message:', e.message); console.log('Error code:', e.code); pool.end(); });
