// Real NSE fundamentals ingestion.
//
// Derives fundamental ratios from parsed corporate filings
// (financial_statements.parsed_data) and writes them to the canonical
// symbol-keyed stock_fundamentals table. This replaces the hardcoded
// NSE_FUNDAMENTALS table as a data source: the coverage gate in signalService
// blocks any NSE symbol whose fundamentals are not filing-derived, so a symbol
// only earns a signal once it appears here (or is served from parsed data via
// financialReportsService.buildLocalNseReport).
//
// Only price-INDEPENDENT ratios are stored (ROE, leverage, liquidity, margins,
// payout, annual growth). Price-dependent ratios (P/E, P/B, dividend yield,
// market cap) are computed at scoring time from the live quote so they never go
// stale in the table.

const { pool } = require('./db');

const FIN_SECTOR = /bank|insur|financ|investment/i;

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

async function ingestNseFundamentals() {
  let rows;
  try {
    ({ rows } = await pool.query(`
      SELECT st.ticker, st.sector, fs.parsed_data, fs.period_end_date, fs.period_type
      FROM stocks st
      JOIN financial_statements fs ON fs.stock_id = st.id
      WHERE st.market = 'NSE' AND fs.status = 'completed' AND fs.parsed_data IS NOT NULL
      ORDER BY st.ticker, fs.period_end_date DESC NULLS LAST
    `));
  } catch (e) {
    console.warn(`[NSE-Fundamentals] ingest query failed: ${e.message}`);
    return 0;
  }

  const byTicker = new Map();
  for (const r of rows) {
    let p;
    try { p = typeof r.parsed_data === 'string' ? JSON.parse(r.parsed_data) : r.parsed_data; }
    catch { continue; }
    if (!p) continue;
    let rec = byTicker.get(r.ticker);
    if (!rec) { rec = { sector: r.sector, periods: [] }; byTicker.set(r.ticker, rec); }
    rec.periods.push({ p, date: r.period_end_date, type: String(r.period_type || '').toLowerCase() });
  }

  let count = 0;
  for (const [ticker, rec] of byTicker) {
    const periods = rec.periods;
    const annuals = periods.filter(x => x.type === 'annual' || x.type === '');
    const pick = annuals[0] || periods[0];
    if (!pick || !pick.p) continue;
    const p = pick.p;

    const equity = n(p.shareholders_equity);
    const ni = n(p.net_income);
    const rev = n(p.total_revenue) ?? n(p.revenue);
    const debt = n(p.total_debt);
    const ca = n(p.current_assets);
    const cl = n(p.current_liabilities);
    const eps = n(p.eps);
    const dps = n(p.dividend_per_share);

    const roe = (equity > 0 && ni != null) ? ni / equity : null;
    const de = (equity > 0 && debt != null) ? debt / equity : null;
    const isFin = FIN_SECTOR.test(rec.sector || '');
    const cr = (!isFin && ca > 0 && cl > 0) ? ca / cl : null;
    const netMargin = (rev > 0 && ni != null) ? ni / rev : null;
    const payout = (eps > 0 && dps != null) ? dps / eps : null;

    // Annual-to-annual growth (fraction). Interims must not be compared to a
    // full year — that corruption is why the scorer previously saw nonsense.
    let rg = null, eg = null;
    if (annuals.length >= 2) {
      const cur = annuals[0].p, prev = annuals[1].p;
      const cRev = n(cur.total_revenue) ?? n(cur.revenue);
      const pRev = n(prev.total_revenue) ?? n(prev.revenue);
      if (cRev > 0 && pRev > 0) rg = (cRev - pRev) / pRev;
      const cEps = n(cur.eps), pEps = n(prev.eps);
      if (cEps > 0 && pEps > 0) eg = (cEps - pEps) / pEps;
    }

    try {
      await pool.query(`
        INSERT INTO stock_fundamentals
          (symbol, roe, debt_to_equity, current_ratio, net_margin, payout_ratio, revenue_growth, eps_growth, period_end_date, data_source, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'filings',NOW())
        ON CONFLICT (symbol) DO UPDATE SET
          roe = EXCLUDED.roe,
          debt_to_equity = EXCLUDED.debt_to_equity,
          current_ratio = EXCLUDED.current_ratio,
          net_margin = EXCLUDED.net_margin,
          payout_ratio = EXCLUDED.payout_ratio,
          revenue_growth = EXCLUDED.revenue_growth,
          eps_growth = EXCLUDED.eps_growth,
          period_end_date = EXCLUDED.period_end_date,
          data_source = 'filings',
          updated_at = NOW()
      `, [ticker, roe, de, cr, netMargin, payout, rg, eg, pick.date]);
      count++;
    } catch (e) {
      console.warn(`[NSE-Fundamentals] upsert ${ticker} failed: ${e.message}`);
    }
  }
  console.log(`[NSE-Fundamentals] Ingested real fundamentals for ${count} NSE symbols from filings`);
  return count;
}

module.exports = { ingestNseFundamentals };
