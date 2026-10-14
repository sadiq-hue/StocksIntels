// Special Funds — collective investment schemes (unit trusts, CIS, REITs, ETFs)
// research layer. Kenya first. Data-quality first: the table stores the source,
// publication date, observation date and ingestion timestamp for every record so
// the UI can tell genuinely current data from older provider disclosures.
//
// Seeded records carry only stable, publicly-documented METADATA (name, manager,
// category, currency, structure, risk class). Live figures (NAV, yield, AUM,
// returns, minimums, fees) are intentionally left NULL until ingested from an
// official source via ingestFund() — we never fabricate numbers.

const { pool } = require('./db');

const COUNTRY = 'Kenya';
const CURRENCY = 'KES';

// ── Seed universe (metadata only; numeric data pending ingestion) ─────────────
// id is a stable slug used as the primary key.
const SEED = [
  // Money market (shilling) funds
  { id: 'britam-money-market', name: 'Britam Money Market Fund', manager: 'Britam Asset Managers', category: 'Money Market' },
  { id: 'cic-money-market', name: 'CIC Money Market Fund', manager: 'CIC Asset Management', category: 'Money Market' },
  { id: 'icea-lion-money-market', name: 'ICEA Lion Money Market Fund', manager: 'ICEA Lion Asset Management', category: 'Money Market' },
  { id: 'old-mutual-money-market', name: 'Old Mutual Money Market Fund', manager: 'Old Mutual Investment Group', category: 'Money Market' },
  { id: 'sanlam-money-market', name: 'Sanlam Money Market Fund', manager: 'Sanlam Investments East Africa', category: 'Money Market' },
  { id: 'ncba-money-market', name: 'NCBA Money Market Fund', manager: 'NCBA Investment Bank', category: 'Money Market' },
  { id: 'coop-money-market', name: 'Co-op Money Market Fund', manager: 'Co-op Trust Investment Services', category: 'Money Market' },
  { id: 'madison-money-market', name: 'Madison Money Market Fund', manager: 'Madison Investment Managers', category: 'Money Market' },
  { id: 'genafrica-money-market', name: 'GenAfrica Money Market Fund', manager: 'GenAfrica Asset Managers', category: 'Money Market' },
  { id: 'apollo-money-market', name: 'Apollo Money Market Fund', manager: 'Apollo Asset Management', category: 'Money Market' },
  { id: 'cytonn-money-market', name: 'Cytonn Money Market Fund', manager: 'Cytonn Asset Managers', category: 'Money Market' },
  { id: 'etica-money-market', name: 'Etica Money Market Fund', manager: 'Etica Capital', category: 'Money Market' },
  { id: 'absa-shilling', name: 'Absa Shilling Fund', manager: 'Absa Asset Management', category: 'Money Market' },
  { id: 'kcb-money-market', name: 'KCB Money Market Fund', manager: 'KCB Asset Management', category: 'Money Market' },
  { id: 'equity-money-market', name: 'Equity Money Market Fund', manager: 'Equity Investment Bank', category: 'Money Market' },
  { id: 'sc-shilling', name: 'StanChart Shilling Fund', manager: 'Standard Chartered', category: 'Money Market' },
  { id: 'im-money-market', name: 'I&M Money Market Fund', manager: 'I&M Capital', category: 'Money Market' },
  { id: 'kuza-money-market', name: 'Kuza Money Market Fund', manager: 'Kuza Asset Management', category: 'Money Market' },
  { id: 'lofty-corban-money-market', name: 'Lofty-Corban Money Market Fund', manager: 'Lofty-Corban Investment Management', category: 'Money Market' },
  { id: 'dry-associates-money-market', name: 'Dry Associates Money Market Fund', manager: 'Dry Associates', category: 'Money Market' },
  { id: 'aib-axys-money-market', name: 'AIB-AXYS Money Market Fund', manager: 'AIB-AXYS Africa', category: 'Money Market' },
  // Fixed income / bond funds
  { id: 'britam-bond', name: 'Britam Bond Fund', manager: 'Britam Asset Managers', category: 'Fixed Income / Bond' },
  { id: 'cic-bond', name: 'CIC Bond Fund', manager: 'CIC Asset Management', category: 'Fixed Income / Bond' },
  { id: 'icea-lion-bond', name: 'ICEA Lion Bond Fund', manager: 'ICEA Lion Asset Management', category: 'Fixed Income / Bond' },
  { id: 'ncba-bond', name: 'NCBA Bond Fund', manager: 'NCBA Investment Bank', category: 'Fixed Income / Bond' },
  { id: 'coop-bond', name: 'Co-op Bond Fund', manager: 'Co-op Trust Investment Services', category: 'Fixed Income / Bond' },
  { id: 'britam-fixed-income', name: 'Britam Fixed Income Fund', manager: 'Britam Asset Managers', category: 'Fixed Income / Bond' },
  // Equity funds
  { id: 'britam-equity', name: 'Britam Equity Fund', manager: 'Britam Asset Managers', category: 'Equity' },
  { id: 'cic-equity', name: 'CIC Equity Fund', manager: 'CIC Asset Management', category: 'Equity' },
  { id: 'icea-lion-equity', name: 'ICEA Lion Equity Fund', manager: 'ICEA Lion Asset Management', category: 'Equity' },
  { id: 'sanlam-equity', name: 'Sanlam Equity Fund', manager: 'Sanlam Investments East Africa', category: 'Equity' },
  { id: 'genafrica-equity', name: 'GenAfrica Equity Fund', manager: 'GenAfrica Asset Managers', category: 'Equity' },
  // Balanced funds
  { id: 'britam-balanced', name: 'Britam Balanced Fund', manager: 'Britam Asset Managers', category: 'Balanced' },
  { id: 'cic-balanced', name: 'CIC Balanced Fund', manager: 'CIC Asset Management', category: 'Balanced' },
  { id: 'icea-lion-balanced', name: 'ICEA Lion Balanced Fund', manager: 'ICEA Lion Asset Management', category: 'Balanced' },
  { id: 'old-mutual-balanced', name: 'Old Mutual Balanced Fund', manager: 'Old Mutual Investment Group', category: 'Balanced' },
  { id: 'sanlam-balanced', name: 'Sanlam Balanced Fund', manager: 'Sanlam Investments East Africa', category: 'Balanced' },
  { id: 'genafrica-balanced', name: 'GenAfrica Balanced Fund', manager: 'GenAfrica Asset Managers', category: 'Balanced' },
  // Shariah-compliant
  { id: 'britam-sharia', name: 'Britam Sharia Fund', manager: 'Britam Asset Managers', category: 'Shariah' },
  { id: 'genghis-sharia', name: 'Genghis Sharia Fund', manager: 'Genghis Capital', category: 'Shariah' },
  { id: 'takaful-sharia', name: 'Takaful Sharia Fund', manager: 'Takaful Insurance of Africa', category: 'Shariah' },
  // Listed collective schemes (NSE)
  { id: 'ilam-fahari-reit', name: 'ILAM Fahari I-REIT', manager: 'ICEA Lion Asset Management (ILAM)', category: 'REIT', structure: 'REIT', listing: 'NSE:ILAM', riskLevel: 'Medium-High', liquidity: 'Exchange-traded' },
  { id: 'newgold-etf', name: 'NewGold ETF', manager: 'Absa Asset Management', category: 'ETF', structure: 'ETF', listing: 'NSE:GLD', riskLevel: 'Medium-High', liquidity: 'Exchange-traded', assetClass: 'Commodities / Gold' },
];

// Descriptive, non-numeric defaults derived from the category (safe to state).
const CATEGORY_DEFAULTS = {
  'Money Market': { structure: 'Unit Trust', riskLevel: 'Low', liquidity: 'Daily', assetClass: 'Cash & short-term deposits', objective: 'Preserve capital and deliver a competitive, stable shilling yield from short-term money-market instruments.' },
  'Fixed Income / Bond': { structure: 'Unit Trust', riskLevel: 'Low-Medium', liquidity: 'T+2', assetClass: 'Government & corporate bonds', objective: 'Generate regular income and modest capital growth primarily from government and corporate bonds.' },
  'Equity': { structure: 'Unit Trust', riskLevel: 'Medium-High', liquidity: 'T+2', assetClass: 'Listed equities', objective: 'Deliver long-term capital growth by investing mainly in listed East African equities.' },
  'Balanced': { structure: 'Unit Trust', riskLevel: 'Medium', liquidity: 'T+2', assetClass: 'Multi-asset (equities, bonds, cash)', objective: 'Balance capital growth and income by spreading across equities, bonds and cash.' },
  'Shariah': { structure: 'Unit Trust', riskLevel: 'Low-Medium', liquidity: 'T+2', assetClass: 'Shariah-compliant instruments', objective: 'Provide Shariah-compliant returns by investing only in screened, interest-free instruments.' },
  'REIT': { structure: 'REIT', riskLevel: 'Medium-High', liquidity: 'Exchange-traded', assetClass: 'Income-producing real estate', objective: 'Provide income and capital appreciation from a portfolio of income-producing real estate.' },
  'ETF': { structure: 'ETF', riskLevel: 'Medium-High', liquidity: 'Exchange-traded', assetClass: 'Commodities / Gold', objective: 'Track the price of gold, giving exchange-traded exposure to the metal.' },
};

const DATA_SOURCE = 'CMA licensee list / provider factsheets (metadata)';

function seedRow(f) {
  const d = CATEGORY_DEFAULTS[f.category] || {};
  return {
    id: f.id,
    name: f.name,
    manager: f.manager,
    category: f.category,
    structure: f.structure || d.structure || 'Unit Trust',
    currency: f.currency || CURRENCY,
    country: f.country || COUNTRY,
    listing: f.listing || null,
    risk_level: f.riskLevel || d.riskLevel || null,
    liquidity: f.liquidity || d.liquidity || null,
    asset_class: f.assetClass || d.assetClass || null,
    objective: f.objective || d.objective || null,
    data_source: DATA_SOURCE,
    data_status: 'metadata', // metadata only; figures pending ingestion
  };
}

async function ensureTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS special_funds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manager TEXT,
        category TEXT,
        structure TEXT,
        currency TEXT DEFAULT 'KES',
        country TEXT DEFAULT 'Kenya',
        listing TEXT,
        inception_year INT,
        min_investment NUMERIC(18,2),
        management_fee_pct NUMERIC(6,3),
        expense_ratio_pct NUMERIC(6,3),
        other_fees TEXT,
        risk_level TEXT,
        risk_notes TEXT,
        liquidity TEXT,
        asset_class TEXT,
        benchmarks TEXT,
        sharia_compliant BOOLEAN DEFAULT FALSE,
        yield_pct NUMERIC(8,3),
        ytd_return_pct NUMERIC(8,3),
        one_year_return_pct NUMERIC(8,3),
        three_year_return_pct NUMERIC(8,3),
        nav NUMERIC(18,6),
        aum NUMERIC(20,2),
        objective TEXT,
        holdings JSONB,
        documents JSONB,
        data_source TEXT,
        source_url TEXT,
        published_at TIMESTAMPTZ,
        observation_date DATE,
        data_status TEXT DEFAULT 'metadata',
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_special_funds_category ON special_funds(category)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_special_funds_manager ON special_funds(manager)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_special_funds_status ON special_funds(data_status)');
  } catch (e) {
    console.error('[SpecialFunds] ensureTable failed:', e.message);
  }
}

async function seedFunds() {
  try {
    for (const f of SEED) {
      const r = seedRow(f);
      await pool.query(
        `INSERT INTO special_funds
           (id, name, manager, category, structure, currency, country, listing, risk_level, liquidity, asset_class, objective, data_source, data_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, r.manager, r.category, r.structure, r.currency, r.country, r.listing, r.risk_level, r.liquidity, r.asset_class, r.objective, r.data_source, r.data_status]
      );
    }
    const { rows } = await pool.query('SELECT COUNT(*)::int n FROM special_funds');
    console.log(`[SpecialFunds] ${rows[0].n} funds in directory`);
  } catch (e) {
    console.error('[SpecialFunds] seedFunds failed:', e.message);
  }
}

const NUMERIC_FIELDS = ['inception_year', 'min_investment', 'management_fee_pct', 'expense_ratio_pct', 'yield_pct', 'ytd_return_pct', 'one_year_return_pct', 'three_year_return_pct', 'nav', 'aum'];
const TEXT_FIELDS = ['name', 'manager', 'category', 'structure', 'currency', 'country', 'listing', 'risk_level', 'risk_notes', 'liquidity', 'asset_class', 'benchmarks', 'other_fees', 'objective', 'data_source', 'source_url', 'data_status'];
const DATE_FIELDS = ['published_at', 'observation_date'];

// Upsert one fund from an official source. `data` may include any subset of the
// columns above plus holdings/documents arrays. Records the ingestion time.
async function ingestFund(id, data = {}) {
  if (!id) throw new Error('id required');
  const cols = ['id'];
  const vals = [id];
  const sets = [];
  const push = (col, val) => { cols.push(col); vals.push(val); sets.push(`${col} = EXCLUDED.${col}`); };
  for (const f of TEXT_FIELDS) if (data[f] !== undefined) push(f, data[f]);
  for (const f of NUMERIC_FIELDS) if (data[f] !== undefined) push(f, data[f] === null ? null : Number(data[f]));
  for (const f of DATE_FIELDS) if (data[f] !== undefined) push(f, data[f]);
  if (data.sharia_compliant !== undefined) push('sharia_compliant', !!data.sharia_compliant);
  if (data.holdings !== undefined) push('holdings', JSON.stringify(data.holdings));
  if (data.documents !== undefined) push('documents', JSON.stringify(data.documents));
  if (data.data_status === undefined) push('data_status', 'verified');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `INSERT INTO special_funds (${cols.join(',')}, ingested_at, updated_at)
     VALUES (${placeholders}, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET ${sets.join(', ')}, ingested_at = NOW(), updated_at = NOW()
     RETURNING *`,
    vals
  );
  return normalize(rows[0]);
}

function normalize(row) {
  if (!row) return null;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: row.id,
    name: row.name,
    manager: row.manager,
    category: row.category,
    structure: row.structure,
    currency: row.currency,
    country: row.country,
    listing: row.listing,
    inceptionYear: row.inception_year != null ? Number(row.inception_year) : null,
    minInvestment: num(row.min_investment),
    managementFeePct: num(row.management_fee_pct),
    expenseRatioPct: num(row.expense_ratio_pct),
    otherFees: row.other_fees,
    riskLevel: row.risk_level,
    riskNotes: row.risk_notes,
    liquidity: row.liquidity,
    assetClass: row.asset_class,
    benchmarks: row.benchmarks,
    shariaCompliant: !!row.sharia_compliant,
    yieldPct: num(row.yield_pct),
    ytdReturnPct: num(row.ytd_return_pct),
    oneYearReturnPct: num(row.one_year_return_pct),
    threeYearReturnPct: num(row.three_year_return_pct),
    nav: num(row.nav),
    aum: num(row.aum),
    objective: row.objective,
    holdings: row.holdings || null,
    documents: row.documents || null,
    dataSource: row.data_source,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    observationDate: row.observation_date,
    dataStatus: row.data_status,
    ingestedAt: row.ingested_at,
    updatedAt: row.updated_at,
  };
}

async function listFunds({ search, category, manager, currency, riskLevel, sharia, minInvestmentMax, sort = 'name', limit = 200 } = {}) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (search) {
    const like = p(`%${search}%`);
    where.push(`(name ILIKE ${like} OR manager ILIKE ${like} OR category ILIKE ${like})`);
  }
  if (category && category !== 'all') where.push(`category = ${p(category)}`);
  if (manager && manager !== 'all') where.push(`manager = ${p(manager)}`);
  if (currency && currency !== 'all') where.push(`currency = ${p(currency)}`);
  if (riskLevel && riskLevel !== 'all') where.push(`risk_level = ${p(riskLevel)}`);
  if (sharia === true || sharia === 'true') where.push('sharia_compliant = TRUE');
  if (minInvestmentMax != null && minInvestmentMax !== '') where.push(`(min_investment IS NULL OR min_investment <= ${p(Number(minInvestmentMax))})`);

  const orderMap = {
    name: 'name ASC',
    yield: 'yield_pct DESC NULLS LAST',
    oneYear: 'one_year_return_pct DESC NULLS LAST',
    fees: 'management_fee_pct ASC NULLS LAST',
    min: 'min_investment ASC NULLS LAST',
    aum: 'aum DESC NULLS LAST',
    updated: 'COALESCE(observation_date, ingested_at) DESC',
  };
  const order = orderMap[sort] || orderMap.name;
  const sql = `SELECT * FROM special_funds ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${Math.min(Number(limit) || 200, 500)}`;
  const { rows } = await pool.query(sql, params);
  return rows.map(normalize);
}

async function getFund(id) {
  const { rows } = await pool.query('SELECT * FROM special_funds WHERE id = $1', [id]);
  return normalize(rows[0] || null);
}

async function getFacets() {
  const [cats, mgrs, currencies] = await Promise.all([
    pool.query('SELECT category, COUNT(*)::int n FROM special_funds WHERE category IS NOT NULL GROUP BY category ORDER BY category'),
    pool.query('SELECT manager, COUNT(*)::int n FROM special_funds WHERE manager IS NOT NULL GROUP BY manager ORDER BY manager'),
    pool.query('SELECT DISTINCT currency FROM special_funds WHERE currency IS NOT NULL ORDER BY currency'),
  ]);
  return {
    categories: cats.rows.map(r => ({ value: r.category, count: r.n })),
    managers: mgrs.rows.map(r => ({ value: r.manager, count: r.n })),
    currencies: currencies.rows.map(r => r.currency),
  };
}

async function getSummary() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int total,
      COUNT(DISTINCT category)::int categories,
      COUNT(DISTINCT manager)::int managers,
      COUNT(DISTINCT currency)::int currencies,
      COUNT(*) FILTER (WHERE data_status = 'verified')::int verified,
      COUNT(*) FILTER (WHERE yield_pct IS NOT NULL)::int withYield,
      MAX(COALESCE(observation_date, ingested_at)) AS latest_date
    FROM special_funds`);
  const r = rows[0] || {};
  return {
    totalFunds: r.total || 0,
    categories: r.categories || 0,
    managers: r.managers || 0,
    currencies: r.currencies || 0,
    verifiedFunds: r.verified || 0,
    fundsWithYield: r.withYield || 0,
    latestDataDate: r.latest_date || null,
    country: COUNTRY,
    primaryCurrency: CURRENCY,
  };
}

// Metric definitions used by the comparison table; `missing` is reported so the
// UI can explain gaps instead of implying funds are directly comparable.
const COMPARE_ROWS = [
  { key: 'manager', label: 'Fund manager' },
  { key: 'category', label: 'Category' },
  { key: 'structure', label: 'Structure' },
  { key: 'currency', label: 'Currency' },
  { key: 'riskLevel', label: 'Risk classification' },
  { key: 'liquidity', label: 'Liquidity' },
  { key: 'minInvestment', label: 'Minimum investment', fmt: 'money' },
  { key: 'managementFeePct', label: 'Management fee', fmt: 'pct' },
  { key: 'expenseRatioPct', label: 'Expense ratio', fmt: 'pct' },
  { key: 'yieldPct', label: 'Published yield', fmt: 'pct' },
  { key: 'oneYearReturnPct', label: '1-year return', fmt: 'pct' },
  { key: 'threeYearReturnPct', label: '3-year return', fmt: 'pct' },
  { key: 'aum', label: 'Assets under management', fmt: 'money' },
  { key: 'observationDate', label: 'Data as of' },
];

async function compareFunds(ids = []) {
  const clean = [...new Set((ids || []).filter(Boolean))].slice(0, 5);
  if (clean.length < 2) return { funds: [], rows: COMPARE_ROWS, notices: [] };
  const funds = [];
  for (const id of clean) {
    const f = await getFund(id);
    if (f) funds.push(f);
  }
  const notices = [];
  const currencies = new Set(funds.map(f => f.currency).filter(Boolean));
  if (currencies.size > 1) notices.push(`These funds are denominated in different currencies (${[...currencies].join(', ')}); figures are not directly comparable.`);
  if (funds.some(f => f.oneYearReturnPct == null && f.yieldPct == null)) notices.push('Some funds have no published performance figure yet — shown as "—" rather than zero.');
  const risks = new Set(funds.map(f => f.riskLevel).filter(Boolean));
  if (risks.size > 1) notices.push(`Risk classifications differ (${[...risks].join(', ')}); a higher headline return on a higher-risk fund is not a like-for-like comparison.`);
  return { funds, rows: COMPARE_ROWS, notices };
}

module.exports = {
  ensureTable,
  seedFunds,
  listFunds,
  getFund,
  getFacets,
  getSummary,
  compareFunds,
  ingestFund,
  COMPARE_ROWS,
};
