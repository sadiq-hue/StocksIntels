require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const since = process.argv[2] || '30 minutes';
  const r = await pool.query(`
    SELECT signal, COUNT(*)::int AS cnt
    FROM signal_history
    WHERE generated_at > NOW() - interval '${since}'
    GROUP BY signal ORDER BY cnt DESC`);
  console.log(`signal_history (last ${since}):`);
  for (const x of r.rows) console.log(`  ${x.signal}: ${x.cnt}`);
  const tot = r.rows.reduce((s, x) => s + x.cnt, 0);
  console.log(`  TOTAL: ${tot}`);

  if (tot > 0) {
    const ss = await pool.query(`
      SELECT ticker, analysis_data, generated_at
      FROM signal_history
      WHERE signal IN ('Sell','Strong Sell')
        AND generated_at > NOW() - interval '${since}'
      ORDER BY generated_at DESC`);
    console.log(`\nSell/Strong Sell breakdown (last ${since}):`);
    for (const x of ss.rows) {
      const a = x.analysis_data || {};
      console.log(`  ${x.ticker} ${x.signal} overall=${a.overall?.score} fund=${a.fundamental?.score} tech=${a.technical?.score} fin=${a.financial?.score} alt=${a.fundamental?.metrics?.altSignal} ${x.generated_at.toISOString()}`);
    }

    const fp = await pool.query(`
      SELECT symbol, signal, price, bench_price, generated_at
      FROM forward_predictions
      WHERE generated_at > NOW() - interval '${since}' AND action='sell'
      ORDER BY generated_at DESC LIMIT 15`);
    if (fp.rows.length) {
      console.log(`\nforward_predictions sells (last ${since}) with bench_price:`);
      for (const x of fp.rows) console.log(`  ${x.symbol} ${x.signal} price=${x.price} bench=${x.bench_price} ${x.generated_at.toISOString()}`);
    }
  }
  await pool.end();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
