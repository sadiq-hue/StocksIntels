require('dotenv').config({ path: 'C:/Users/user/Downloads/StocksIntels/backend/.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000, query_timeout: 30000 });
const now = new Date();
(async () => {
  console.log('=== 1. SIGNAL HISTORY (real-time generation) ===');
  const h1 = await pool.query(`SELECT COUNT(*)::int AS c, MAX(generated_at) AS last_gen FROM signal_history`);
  console.log('total rows:', h1.rows[0].c, '| last generated:', h1.rows[0].last_gen ? h1.rows[0].last_gen.toISOString() : '-', '| ago:', h1.rows[0].last_gen ? ((now - h1.rows[0].last_gen)/3600000).toFixed(2) + 'h' : '-');
  const h2 = await pool.query(`SELECT signal, COUNT(*)::int AS c FROM signal_history WHERE generated_at > NOW() - interval '2 hours' GROUP BY signal ORDER BY c DESC`);
  console.log('last 2h by signal:', h2.rows.map(r => `${r.signal}=${r.c}`).join(', ') || '(none)');
  const h3 = await pool.query(`SELECT COUNT(*)::int AS c, COUNT(DISTINCT (ticker, signal_bucket)) AS buckets FROM signal_history WHERE generated_at > NOW() - interval '2 hours'`);
  console.log('last 2h rows vs unique buckets (dedup check):', h3.rows[0].c, '/', h3.rows[0].buckets);
  const h4 = await pool.query(`SELECT ticker, signal, confidence, price, generated_at FROM signal_history WHERE generated_at > NOW() - interval '2 hours' ORDER BY generated_at DESC LIMIT 5`);
  console.log('latest 5 signals:');
  for (const r of h4.rows) console.log(' ', r.ticker, r.signal, 'conf=' + r.confidence, 'price=' + r.price, r.generated_at.toISOString());

  console.log('\n=== 2. SIGNAL OUTCOMES (resolutions) ===');
  const o1 = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE result='win') AS wins, COUNT(*) FILTER (WHERE result='loss') AS losses, MAX(recorded_at) AS last_rec FROM signal_outcomes`);
  const t = o1.rows[0];
  console.log(`total=${t.total} wins=${t.wins} losses=${t.losses} winRate=${t.total ? (t.wins/t.total*100).toFixed(1)+'%' : '-'} | last recorded: ${t.last_rec ? t.last_rec.toISOString() : '-'} ago=${t.last_rec ? ((now-t.last_rec)/3600000).toFixed(2)+'h' : '-'}`);
  const o2 = await pool.query(`SELECT
      COUNT(*) FILTER (WHERE signal_generated_at < recorded_at) AS real_resolutions,
      COUNT(*) FILTER (WHERE signal_generated_at IS NOT DISTINCT FROM recorded_at) AS synthetic
    FROM signal_outcomes`);
  console.log('real resolutions (gen<rec):', o2.rows[0].real_resolutions, '| synthetic (gen==rec):', o2.rows[0].synthetic);
  const o3 = await pool.query(`SELECT ticker, signal, entry_price, exit_price, result, signal_generated_at, recorded_at FROM signal_outcomes WHERE signal_generated_at < recorded_at ORDER BY recorded_at DESC LIMIT 8`);
  console.log('latest REAL live resolutions:');
  for (const r of o3.rows) console.log(' ', r.ticker, r.signal, `entry=${r.entry_price} exit=${r.exit_price}`, r.result, '| gen=', r.signal_generated_at.toISOString(), 'rec=', r.recorded_at.toISOString());
  const o4 = await pool.query(`SELECT COUNT(*)::int AS c FROM signal_outcomes WHERE recorded_at > NOW() - interval '2 hours'`);
  console.log('outcomes written in last 2h:', o4.rows[0].c);

  console.log('\n=== 3. FORWARD PREDICTIONS (forward test) ===');
  const f1 = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE resolved) AS resolved, MAX(generated_at) AS last_gen FROM forward_predictions`);
  console.log(`total=${f1.rows[0].total} resolved=${f1.rows[0].resolved} | last generated: ${f1.rows[0].last_gen ? f1.rows[0].last_gen.toISOString() : '-'} ago=${f1.rows[0].last_gen ? ((now-f1.rows[0].last_gen)/3600000).toFixed(2)+'h' : '-'}`);
  const f2 = await pool.query(`SELECT symbol, signal, confidence, price, generated_at, resolved, correct FROM forward_predictions ORDER BY generated_at DESC LIMIT 5`);
  console.log('latest 5 predictions:');
  for (const r of f2.rows) console.log(' ', r.symbol, r.signal, 'conf=' + r.confidence, 'price=' + r.price, 'resolved=' + r.resolved, 'correct=' + r.correct, r.generated_at.toISOString());
  const f3 = await pool.query(`SELECT COUNT(*)::int AS c FROM forward_predictions WHERE generated_at > NOW() - interval '2 hours'`);
  console.log('predictions generated in last 2h:', f3.rows[0].c);

  console.log('\n=== 4. DASHBOARD METRIC QUERIES (what health/live use) ===');
  const m1 = await pool.query(`SELECT result, COUNT(*)::int AS cnt FROM signal_outcomes WHERE COALESCE(signal_generated_at, recorded_at) > NOW() - INTERVAL '30 days' AND result IS NOT NULL GROUP BY result`);
  const wins = m1.rows.find(r => r.result==='win')?.cnt || 0, losses = m1.rows.find(r => r.result==='loss')?.cnt || 0;
  console.log(`Health 30d: wins=${wins} losses=${losses} total=${wins+losses} winRate=${wins+losses ? (wins/(wins+losses)*100).toFixed(1)+'%' : '-'}`);
  const m2 = await pool.query(`SELECT COUNT(*)::int AS c FROM signal_outcomes WHERE COALESCE(signal_generated_at, recorded_at) > NOW() - interval '1 day' AND result IS NOT NULL`);
  console.log('Live path 1d outcomes:', m2.rows[0].c);
  const m3 = await pool.query(`SELECT COUNT(*)::int AS c FROM signal_history`);
  console.log('Health signalCount (=signal_history rows):', m3.rows[0].c);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
