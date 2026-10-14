// Published profile data for Special Funds (multi-asset / AIF family) whose
// managers disclose terms on their own pages or fact sheets — as opposed to the
// exchange-traded CIS whose rates the fund-rate scraper handles.
//
// These figures are quoted verbatim from each manager's published fact sheet /
// product page and carry full provenance (source, source_url, observation_date).
// They are NOT synthesised: any figure we cannot source is simply omitted so the
// fund keeps showing "—". Re-run refreshes on boot and on demand (admin route).

const specialFunds = require('./specialFundsService');

const MANSAX_FACTSHEET = 'https://sib.co.ke/wp-content/uploads/2026/10/MansaX-Fund-Factsheet-Q3-2026-vf.pdf';
const KIBABA_KES_SHEET = 'https://ndovu.co/funds/kibaba/kibaba-kes-fact-sheet-q2.pdf';
const KIBABA_USD_SHEET = 'https://ndovu.co/funds/kibaba/kibaba-usd-fact-sheet-q2.pdf';

const MANSAX_OBJECTIVE = 'Multi-asset strategy fund using a long/short trading model across local and global markets (200+ asset classes), designed to optimise returns in all market conditions while protecting capital. Operated under the Standard Investment Trust Funds (SITF) umbrella and regulated by the Capital Markets Authority.';
const KIBABA_OBJECTIVE = 'Multi-asset special fund giving investors diversified global and local exposure across equities, fixed income, commodities and cash, with active allocation and FX-aware risk management.';

const PROFILES = [
  {
    name: 'Mansa X Special Fund (KES)',
    inception_year: 2019,
    aum: 196280000000,
    min_investment: 250000,
    management_fee_pct: 5,
    one_year_return_pct: 18.13,
    benchmarks: 'Hurdle rate 25% (KES)',
    other_fees: '0% initial fee; 0% redemption; 5% p.a. financial services charge (pro-rated daily over 365 days); 10% performance charge on returns above the 25% hurdle rate; minimum top-up KES 100,000; 6-month lock-in.',
    objective: MANSAX_OBJECTIVE,
    data_source: 'Mansa-X Special Fund fact sheet Q3 2026 (Standard Investment Bank)',
    source_url: MANSAX_FACTSHEET,
    observation_date: '2026-09-30',
  },
  {
    name: 'Mansa X Special Fund (USD)',
    inception_year: 2022,
    aum: 186400000,
    min_investment: 2500,
    management_fee_pct: 5,
    benchmarks: 'Hurdle rate 15% (USD)',
    other_fees: '0% initial fee; 0% redemption; 5% p.a. financial services charge (pro-rated daily over 365 days); 10% performance charge on returns above the 15% hurdle rate; minimum top-up USD 1,000; 6-month lock-in.',
    objective: MANSAX_OBJECTIVE,
    data_source: 'Mansa-X Special Fund fact sheet Q3 2026 (Standard Investment Bank)',
    source_url: MANSAX_FACTSHEET,
    observation_date: '2026-09-30',
  },
  {
    name: 'Kibaba Multi-Asset Special Fund (KES)',
    min_investment: 250000,
    management_fee_pct: 5,
    one_year_return_pct: 20,
    benchmarks: 'Hurdle rate 20% (KES)',
    other_fees: '5% p.a. management fee (pro-rated); 10% performance fee on returns above the 20% hurdle rate; minimum top-up KES 100,000; minimum withdrawal KES 50,000; 6-month lock-in.',
    objective: KIBABA_OBJECTIVE,
    data_source: 'Kibaba Special Fund fact sheet Q2 2026 (Ndovu)',
    source_url: KIBABA_KES_SHEET,
    observation_date: '2026-06-30',
  },
  {
    name: 'Kibaba Multi-Asset Special Fund (USD)',
    min_investment: 2500,
    management_fee_pct: 5,
    one_year_return_pct: 18,
    benchmarks: 'Hurdle rate 15% (USD)',
    other_fees: '5% p.a. management fee (pro-rated); 15% performance fee on returns above the 15% hurdle rate; minimum top-up USD 1,000; minimum withdrawal USD 500; 6-month lock-in.',
    objective: KIBABA_OBJECTIVE,
    data_source: 'Kibaba Special Fund fact sheet Q2 2026 (Ndovu)',
    source_url: KIBABA_USD_SHEET,
    observation_date: '2026-06-30',
  },
];

// Ingest the published profiles. Each row carries its own data_source / source_url
// / observation_date so the provenance survives even when rungs are grouped.
async function refreshProfiles() {
  const rows = PROFILES.map(p => ({ ...p }));
  const summary = await specialFunds.bulkIngest(rows);
  const applied = rows.length - summary.skipped;
  console.log(`[FundProfiles] applied ${applied}/${rows.length} published special-fund profiles`);
  return { applied, total: rows.length, ...summary };
}

module.exports = { PROFILES, refreshProfiles };
