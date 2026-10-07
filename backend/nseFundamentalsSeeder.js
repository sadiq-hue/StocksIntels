const { pool } = require('./db');
const { NSE_FUNDAMENTALS, KNOWN_FUNDAMENTALS } = require('./stockData');
const { ingestNseFundamentals } = require('./nseFundamentalsIngest');

const SEED_INTERVAL = 4 * 60 * 60 * 1000;
let seedTimer = null;

function toNum(v) { return v != null ? Number(v) : null; }

async function seedFundamentals() {
  try {
    const allSymbols = new Set([
      ...Object.keys(NSE_FUNDAMENTALS),
      ...Object.keys(KNOWN_FUNDAMENTALS).filter(k => {
        const d = KNOWN_FUNDAMENTALS[k];
        return d && d.sector && (NSE_FUNDAMENTALS[k] || d.sector !== 'Technology');
      }),
    ]);

    let count = 0;
    for (const ticker of allSymbols) {
      const staticData = KNOWN_FUNDAMENTALS[ticker] || {};
      const nseData = NSE_FUNDAMENTALS[ticker] || {};

      const pe = toNum(staticData.peRatio || nseData.peRatio);
      const pb = toNum(staticData.pbRatio);
      const mc = toNum(staticData.marketCap);
      const dy = toNum(staticData.dividendYield != null ? staticData.dividendYield : nseData.dividendYield);
      const roe = toNum(staticData.roe);

      const row = {
        pe_ratio: pe > 0 ? pe : null,
        pb_ratio: pb > 0 ? pb : null,
        market_cap: mc > 0 ? mc : null,
        dividend_yield: dy > 0 ? dy / 100 : null,
        roe: roe > 0 ? roe : null,
        revenue_growth: toNum(staticData.revenueGrowth) || null,
        eps_growth: toNum(staticData.epsGrowth) || null,
      };

      const keys = Object.keys(row).filter(k => row[k] != null);
      if (keys.length === 0) continue;

      const vals = keys.map((_, i) => `$${i + 2}`).join(', ');
      const setClause = keys.map(k => `${k} = EXCLUDED.${k}`).join(', ');

      await pool.query(
        `INSERT INTO stock_fundamentals (symbol, ${keys.join(', ')}, data_source)
         VALUES ($1, ${vals}, 'static')
         ON CONFLICT (symbol) DO UPDATE SET ${setClause}, data_source = 'static'
         WHERE stock_fundamentals.data_source IS DISTINCT FROM 'filings'`,
        [ticker, ...keys.map(k => row[k])]
      );
      count++;
    }
    console.log(`[NSE-Fundamentals] Seeded ${count} NSE stock fundamentals from static data`);
  } catch (err) {
    console.error('[NSE-Fundamentals] Seed error:', err.message);
  }
}

function startAutoSeed() {
  const run = async () => {
    // Real filing-derived fundamentals first; the hardcoded table is only a
    // fallback for symbols that still have no filings (and those are now blocked
    // from scoring by the NSE coverage gate anyway).
    try { await ingestNseFundamentals(); } catch (e) { console.warn('[NSE-Fundamentals] ingest failed:', e.message); }
    await seedFundamentals().catch(() => {});
  };
  run();
  if (seedTimer) clearInterval(seedTimer);
  seedTimer = setInterval(() => run().catch(() => {}), SEED_INTERVAL);
  console.log('[NSE-Fundamentals] Real ingest + static fallback every 4 hours');
}

function stopAutoSeed() {
  if (seedTimer) { clearInterval(seedTimer); seedTimer = null; }
}

module.exports = { seedFundamentals, startAutoSeed, stopAutoSeed };
