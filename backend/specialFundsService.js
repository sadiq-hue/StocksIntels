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
  { id: 'ncba-money-market', name: 'NCBA Money Market Fund (KES)', manager: 'NCBA Investment Bank', category: 'Money Market' },
  { id: 'coop-money-market', name: 'Co-op Money Market Fund', manager: 'Co-op Trust Investment Services', category: 'Money Market' },
  { id: 'madison-money-market', name: 'Madison Money Market Fund', manager: 'Madison Investment Managers', category: 'Money Market' },
  { id: 'genafrica-money-market', name: 'GenAfrica Money Market Fund', manager: 'GenAfrica Asset Managers', category: 'Money Market' },
  { id: 'apollo-money-market', name: 'Apollo Money Market Fund', manager: 'Apollo Asset Management', category: 'Money Market' },
  { id: 'cytonn-money-market', name: 'Cytonn Money Market Fund', manager: 'Cytonn Asset Managers', category: 'Money Market' },
  { id: 'etica-money-market', name: 'Etica Money Market Fund', manager: 'Etica Capital', category: 'Money Market' },
  { id: 'absa-shilling', name: 'Absa Shilling Money Market Fund', manager: 'Absa Asset Management', category: 'Money Market' },
  { id: 'kcb-money-market', name: 'KCB Money Market Fund (KES)', manager: 'KCB Asset Management', category: 'Money Market' },
  { id: 'equity-money-market', name: 'Equity Investment Bank Money Market Fund', manager: 'Equity Investment Bank', category: 'Money Market' },
  { id: 'sc-shilling', name: 'StanChart Shilling Fund', manager: 'Standard Chartered', category: 'Money Market' },
  { id: 'im-money-market', name: 'I&M Money Market Fund', manager: 'I&M Capital', category: 'Money Market' },
  { id: 'kuza-money-market', name: 'Kuza Money Market Fund (KES)', manager: 'Kuza Asset Management', category: 'Money Market' },
  { id: 'lofty-corban-money-market', name: 'Lofty Corban Money Market Fund (KES)', manager: 'Lofty-Corban Investment Management', category: 'Money Market' },
  { id: 'dry-associates-money-market', name: 'Dry Associates Money Market Fund (KES)', manager: 'Dry Associates', category: 'Money Market' },
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
  // Additional income / balanced / equity / shariah managers
  { id: 'ndovu-money-market', name: 'Ndovu Money Market Fund', manager: 'Ndovu', category: 'Money Market' },
  { id: 'alpha-africa-money-market', name: 'Alpha Africa Money Market Fund', manager: 'Alpha Africa Asset Managers', category: 'Money Market' },
  { id: 'nabo-money-market', name: 'Nabo Money Market Fund', manager: 'Nabo Capital', category: 'Money Market' },
  { id: 'zamara-money-market', name: 'Zamara Money Market Fund', manager: 'Zamara', category: 'Money Market' },
  { id: 'sentinel-money-market', name: 'Sentinel Money Market Fund', manager: 'Sentinel Asset Management', category: 'Money Market' },
  { id: 'uap-money-market', name: 'UAP Money Market Fund', manager: 'UAP Old Mutual', category: 'Money Market' },
  { id: 'sentinel-bond', name: 'Sentinel Bond Fund', manager: 'Sentinel Asset Management', category: 'Fixed Income / Bond' },
  { id: 'uap-bond', name: 'UAP Bond Fund', manager: 'UAP Old Mutual', category: 'Fixed Income / Bond' },
  { id: 'sentinel-balanced', name: 'Sentinel Balanced Fund', manager: 'Sentinel Asset Management', category: 'Balanced' },
  { id: 'uap-balanced', name: 'UAP Balanced Fund', manager: 'UAP Old Mutual', category: 'Balanced' },
  { id: 'sentinel-equity', name: 'Sentinel Equity Fund', manager: 'Sentinel Asset Management', category: 'Equity' },
  { id: 'uap-equity', name: 'UAP Equity Fund', manager: 'UAP Old Mutual', category: 'Equity' },
  { id: 'amana-sharia-money-market', name: 'Amana Sharia Money Market Fund', manager: 'Amana Capital', category: 'Shariah' },
  { id: 'ziidi-shariah', name: 'Ziidi Shari’ah Fund', manager: 'Safaricom (M-PESA)', category: 'Shariah' },
];

// ── Special Funds ────────────────────────────────────────────────────────────
// Every "Special Fund" (and Alternative Investment Fund) sub-fund on the CMA
// register of Approved Collective Investment Schemes. Source:
// https://licensees.cma.or.ke/licenses/15/  (Capital Markets Authority, Kenya).
// Metadata only; figures pending ingestion.
const SPECIAL_FUNDS = [
  { name: 'African Alliance Kenya Enhanced Yield Fund', manager: 'African Alliance' },
  { name: 'Britam Special Fixed Income Fund', manager: 'Britam Asset Managers' },
  { name: 'Britam Multi-Asset Special Fund', manager: 'Britam Asset Managers' },
  { name: 'Britam Enhanced Global Equities Special Fund', manager: 'Britam Asset Managers' },
  { name: 'NCBA Global Special Equity Fund', manager: 'NCBA Investment Bank' },
  { name: 'NCBA Global Special Fixed Income Fund', manager: 'NCBA Investment Bank' },
  { name: 'CIC Global Special Fund', manager: 'CIC Asset Management' },
  { name: 'Dyer & Blair Special Global Strategies Fund (KES)', manager: 'Dyer & Blair' },
  { name: 'Dyer & Blair Special Global Strategies Fund (USD)', manager: 'Dyer & Blair', currency: 'USD' },
  { name: 'Gencap NSE25 Index Tracker', manager: 'Genghis Capital' },
  { name: 'Gencap Financial Services Fund', manager: 'Genghis Capital' },
  { name: 'Sanlam Special GBP Fixed Income Fund', manager: 'Sanlam Investments East Africa', currency: 'GBP' },
  { name: 'Sanlam Special Fund (KES)', manager: 'Sanlam Investments East Africa' },
  { name: 'Nabo Ubuntu Multi Asset Strategy Special Fund', manager: 'Nabo Capital' },
  { name: 'Old Mutual Special Fixed Income Fund', manager: 'Old Mutual Investment Group' },
  { name: 'Dry Associates Special High Yield Fund (KES)', manager: 'Dry Associates' },
  { name: 'Dry Associates Euro Special Fixed Income Fund', manager: 'Dry Associates', currency: 'EUR' },
  { name: 'Dry Associates Sterling Special Fixed Income Fund', manager: 'Dry Associates', currency: 'GBP' },
  { name: 'Cytonn High Yield Fund', manager: 'Cytonn Asset Managers' },
  { name: 'Absa Global Multi-Asset Special Fund (KES)', manager: 'Absa Asset Management' },
  { name: 'Absa Global Multi-Asset Special Fund (USD)', manager: 'Absa Asset Management', currency: 'USD' },
  { name: 'Jubilee Enhanced Fixed Income Special Fund', manager: 'Jubilee Insurance' },
  { name: 'Etica Special Multi Asset Special Fund', manager: 'Etica Capital' },
  { name: 'Lofty-Corban Private Debt Special Fund', manager: 'Lofty-Corban Investment Management' },
  { name: 'Lofty-Corban Global Asset Special Fund', manager: 'Lofty-Corban Investment Management' },
  { name: 'Lofty-Corban Special Money Market Fund', manager: 'Lofty-Corban Investment Management' },
  { name: 'Mansa X Special Fund (KES)', manager: 'Standard Investment Bank' },
  { name: 'Mansa X Special Fund (USD)', manager: 'Standard Investment Bank', currency: 'USD' },
  { name: 'Mansa X Shariah Special Fund (KES)', manager: 'Standard Investment Bank', sharia: true },
  { name: 'Mansa X Shariah Special Fund (USD)', manager: 'Standard Investment Bank', currency: 'USD', sharia: true },
  { name: 'Oak Multi Asset Special Fund (KES)', manager: 'Faida Investment Bank' },
  { name: 'Oak Multi Assets Special USD Fund', manager: 'Faida Investment Bank', currency: 'USD' },
  { name: 'Spearhead Africa Infrastructure (Special) Fund', manager: 'Spearhead Capital' },
  { name: 'Investcent Multi Asset Special Fund (KES)', manager: 'Investcent Partners' },
  { name: 'Investcent Multi Asset Special Fund (USD)', manager: 'Investcent Partners', currency: 'USD' },
  { name: 'Investcent Shariah Multi Asset Special Fund (KES)', manager: 'Investcent Partners', sharia: true },
  { name: 'Investcent Shariah Multi Asset Special Fund (USD)', manager: 'Investcent Partners', currency: 'USD', sharia: true },
  { name: 'Investcent Green Special Fund (KES)', manager: 'Investcent Partners' },
  { name: 'Investcent Green Special Fund (USD)', manager: 'Investcent Partners', currency: 'USD' },
  { name: 'GCIB Multi-Asset Special Fund', manager: 'GCIB' },
  { name: 'GCIB Shariah Multi-Asset Special Fund', manager: 'GCIB', sharia: true },
  { name: 'CPF Multi-Asset Special Fund (KES)', manager: 'CPF' },
  { name: 'Arvocap Eurofix Fixed Income Special Fund', manager: 'Arvocap', currency: 'EUR' },
  { name: 'Arvocap Africa Equity Special Fund', manager: 'Arvocap' },
  { name: 'Arvocap Global Equity Special Fund', manager: 'Arvocap' },
  { name: 'Arvocap Multi Asset Strategy Special Fund (USD)', manager: 'Arvocap', currency: 'USD' },
  { name: 'Arvocap Global Sharia Equity Special Fund (USD)', manager: 'Arvocap', currency: 'USD', sharia: true },
  { name: 'Arvocap Mabruk Sharia Special Fund (KES)', manager: 'Arvocap', sharia: true },
  { name: 'XENO Kenya International Equity Special Fund (USD)', manager: 'Xeno' , currency: 'USD' },
  { name: 'VCG Offshore Equities Megatrends Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Offshore Diversified Special Fund of Funds (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Offshore Fixed Income Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Offshore Technology Revolution Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Diversified Commodities Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Offshore Multi-Asset Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Managed Oil Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'VCG Managed Agriculture Special Fund (USD)', manager: 'VCG', currency: 'USD' },
  { name: 'Capital A Multi Asset Strategy Special Fund (KES)', manager: 'Capital A' },
  { name: 'Capital A Multi Asset Strategy Special Fund (USD)', manager: 'Capital A', currency: 'USD' },
  { name: 'Globetec Multi-Asset Special Fund', manager: 'Globetec Asset Managers' },
  { name: 'Globetec Dollar Multi-Asset Special Fund', manager: 'Globetec Asset Managers', currency: 'USD' },
  { name: 'Zamara Global Balanced Special Fund (USD)', manager: 'Zamara', currency: 'USD' },
  { name: 'Kibaba Multi-Asset Special Fund (KES)', manager: 'Kibaba' },
  { name: 'Kibaba Multi-Asset Special Fund (USD)', manager: 'Kibaba', currency: 'USD' },
  { name: 'Pergamon Special Diversified Income Fund (KES)', manager: 'Pergamon (PIB Africa)' },
  { name: 'Selective Alpha Multi Asset Special Fund', manager: 'Meridian Asset Management' },
  { name: 'Cinemark KES Special Fixed Income Fund', manager: 'Cinemark' },
  { name: 'Cinemark USD Special Fixed Income Fund', manager: 'Cinemark', currency: 'USD' },
  { name: 'Cinemark KES Multi-asset Special Fund', manager: 'Cinemark' },
  { name: 'Cinemark USD Multi-asset Special Fund', manager: 'Cinemark', currency: 'USD' },
  { name: 'Zubari KES Multi-Asset Special Fund', manager: 'Karsis' },
  { name: 'Zubari USD Multi-Asset Special Fund', manager: 'Karsis', currency: 'USD' },
  { name: 'Zubari EUR Multi-Asset Special Fund', manager: 'Karsis', currency: 'EUR' },
  { name: 'Zubari GBP Multi-Asset Special Fund', manager: 'Karsis', currency: 'GBP' },
  { name: 'Zubari KES Private-Debt Special Fund', manager: 'Karsis' },
  { name: 'Zubari USD Private-Debt Special Fund', manager: 'Karsis', currency: 'USD' },
  { name: 'Zubari EUR Private-Debt Special Fund', manager: 'Karsis', currency: 'EUR' },
  { name: 'Zubari GBP Private-Debt Special Fund', manager: 'Karsis', currency: 'GBP' },
  // Alternative Investment Funds (the alternative/"special" class on the register)
  { name: 'Enwealth Impact Debt Fund (AIF)', manager: 'Enwealth Capital' },
  { name: 'Investcent Hedge Fund (KES)', manager: 'Investcent Partners' },
  { name: 'Investcent Hedge Fund (USD)', manager: 'Investcent Partners', currency: 'USD' },
  { name: 'ICEA LION Multi Strategy Bond Fund (AIF)', manager: 'ICEA Lion Asset Management' },
  { name: 'Green Investment Fund (AIF)', manager: 'Green Investment Fund' },
].map(f => ({ ...f, id: slugify(f.name), category: 'Special Funds' }));

function slugify(name) {
  return 'sf-' + String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// ── Full CMA register (all non-Special sub-funds) ─────────────────────────────
// Every other sub-fund on the CMA register of Approved Collective Investment
// Schemes (https://licensees.cma.or.ke/licenses/15/). Tuple:
// [name, manager, category, currency?, sharia?]
const REGISTER_FUNDS = [
  // African Alliance
  ['African Alliance Kenya Money Market Fund', 'African Alliance', 'Money Market'],
  ['African Alliance Kenya Fixed Income Fund', 'African Alliance', 'Fixed Income / Bond'],
  ['African Alliance Kenya Balanced Fund', 'African Alliance', 'Balanced'],
  ['African Alliance Kenya Equity Fund', 'African Alliance', 'Equity'],
  // Britam
  ['Britam Income Fund', 'Britam Asset Managers', 'Fixed Income / Bond'],
  ['Britam Money Market Fund (USD)', 'Britam Asset Managers', 'Money Market', 'USD'],
  ['Britam Bond Plus Fund', 'Britam Asset Managers', 'Fixed Income / Bond'],
  ['Britam USD Fixed Income Fund', 'Britam Asset Managers', 'Fixed Income / Bond', 'USD'],
  // NCBA
  ['NCBA Fixed Income Fund', 'NCBA Investment Bank', 'Fixed Income / Bond'],
  ['NCBA Equity Fund', 'NCBA Investment Bank', 'Equity'],
  ['NCBA Dollar Fixed Income Fund', 'NCBA Investment Bank', 'Fixed Income / Bond', 'USD'],
  ['NCBA Fixed Income Basket Note (KES Fund)', 'NCBA Investment Bank', 'Fixed Income / Bond'],
  ['NCBA Fixed Income Basket Note (USD Fund)', 'NCBA Investment Bank', 'Fixed Income / Bond', 'USD'],
  ['NCBA Money Market Fund (KES)', 'NCBA Investment Bank', 'Money Market'],
  ['NCBA Money Market Fund (USD)', 'NCBA Investment Bank', 'Money Market', 'USD'],
  // Zimele
  ['Zimele USD Money Market Fund', 'Zimele Asset Management', 'Money Market', 'USD'],
  ['Zimele USD Fixed Income Fund', 'Zimele Asset Management', 'Fixed Income / Bond', 'USD'],
  ['Zimele Fixed Income Fund', 'Zimele Asset Management', 'Fixed Income / Bond'],
  ['Zimele Education Plan', 'Zimele Asset Management', 'Balanced'],
  ['Zimele Saving Plan', 'Zimele Asset Management', 'Balanced'],
  // ICEA
  ['ICEA Money Market Fund', 'ICEA', 'Money Market'],
  ['ICEA Equity Fund', 'ICEA', 'Equity'],
  ['ICEA Balanced Fund', 'ICEA', 'Balanced'],
  ['ICEA Bond Fund', 'ICEA', 'Fixed Income / Bond'],
  ['ICEA Fixed Income Fund (USD)', 'ICEA', 'Fixed Income / Bond', 'USD'],
  // CIC
  ['CIC Money Market Fund', 'CIC Asset Management', 'Money Market'],
  ['CIC Balanced Fund', 'CIC Asset Management', 'Balanced'],
  ['CIC Fixed Income Fund', 'CIC Asset Management', 'Fixed Income / Bond'],
  ['CIC Equity Fund', 'CIC Asset Management', 'Equity'],
  ['CIC Wealth Fund', 'CIC Asset Management', 'Balanced'],
  ['CIC Dollar Fund', 'CIC Asset Management', 'Money Market', 'USD'],
  // Madison
  ['Madison Money Market Fund', 'Madison Investment Managers', 'Money Market'],
  ['Madison Fixed Income Fund', 'Madison Investment Managers', 'Fixed Income / Bond'],
  ['Madison Wealth Fund', 'Madison Investment Managers', 'Balanced'],
  // Dyer & Blair
  ['Dyer & Blair Fixed Income Fund (USD)', 'Dyer & Blair', 'Fixed Income / Bond', 'USD'],
  // Amana
  ['Amana Money Market Fund', 'Amana Capital', 'Money Market'],
  ['Amana Balanced Fund', 'Amana Capital', 'Balanced'],
  ['Amana Equity Fund', 'Amana Capital', 'Equity'],
  // Diaspora
  ['Diaspora Money Market Fund', 'Diaspora Investment Club', 'Money Market'],
  ['Diaspora Bond Fund', 'Diaspora Investment Club', 'Fixed Income / Bond'],
  ['Diaspora Equity Fund', 'Diaspora Investment Club', 'Equity'],
  // First Ethical
  ['First Ethical Opportunities Fund', 'First Ethical', 'Shariah', 'KES', true],
  // Genghis
  ['GenCap Hazina Fund (Bond Fund)', 'Genghis Capital', 'Fixed Income / Bond'],
  ['GenCap Eneza Fund (Diversified Fund)', 'Genghis Capital', 'Balanced'],
  ['GenCap Hela Fund (Money Market Fund)', 'Genghis Capital', 'Money Market'],
  ['GenCap Iman Fund (Shariah Compliant Fund)', 'Genghis Capital', 'Shariah', 'KES', true],
  ['GenCap Hisa Fund (Equity Fund)', 'Genghis Capital', 'Equity'],
  ['GenCap Hela Imara Fund (Money Market Fund)', 'Genghis Capital', 'Money Market'],
  ['Gencap Eneza Imara Fund', 'Genghis Capital', 'Balanced'],
  ['Gencap Hisa Imara Fund', 'Genghis Capital', 'Equity'],
  ['Gencap Iman Imara Fund', 'Genghis Capital', 'Shariah', 'KES', true],
  ['Gencap Fixed Income Fund', 'Genghis Capital', 'Fixed Income / Bond'],
  // Mali
  ['Mali Money Market Fund', 'Safaricom (M-PESA)', 'Money Market'],
  // Sanlam
  ['Sanlam Money Market Fund', 'Sanlam Investments East Africa', 'Money Market'],
  ['Sanlam Balanced Fund', 'Sanlam Investments East Africa', 'Balanced'],
  ['Sanlam Fixed Income Fund', 'Sanlam Investments East Africa', 'Fixed Income / Bond'],
  ['Sanlam USD Fixed Income Fund', 'Sanlam Investments East Africa', 'Fixed Income / Bond', 'USD'],
  // Nabo
  ['Nabo Africa Money Market Fund', 'Nabo Capital', 'Money Market'],
  ['Nabo Africa Balanced Fund', 'Nabo Capital', 'Balanced'],
  ['Nabo Africa Fixed Income Fund', 'Nabo Capital', 'Fixed Income / Bond'],
  ['Nabo Africa Equity Fund', 'Nabo Capital', 'Equity'],
  ['Nabo Capital Money Market Fund (USD)', 'Nabo Capital', 'Money Market', 'USD'],
  // Old Mutual
  ['Old Mutual Equity Fund', 'Old Mutual Investment Group', 'Equity'],
  ['Old Mutual Money Market Fund', 'Old Mutual Investment Group', 'Money Market'],
  ['Old Mutual Balanced Fund', 'Old Mutual Investment Group', 'Balanced'],
  ['Old Mutual East Africa Fund', 'Old Mutual Investment Group', 'Equity'],
  ['Old Mutual Bond Fund', 'Old Mutual Investment Group', 'Fixed Income / Bond'],
  ['Old Mutual Faulu Money Market Fund', 'Old Mutual Investment Group', 'Money Market'],
  ['Old Mutual Dollar Money Market Fund', 'Old Mutual Investment Group', 'Money Market', 'USD'],
  // Equity
  ['Equity Investment Bank Money Market Fund', 'Equity Investment Bank', 'Money Market'],
  ['Equity Investment Bank Balanced Fund', 'Equity Investment Bank', 'Balanced'],
  // Dry Associates (non-special)
  ['Dry Associates Money Market Fund (KES)', 'Dry Associates', 'Money Market'],
  ['Dry Associates Money Market Fund (USD)', 'Dry Associates', 'Money Market', 'USD'],
  ['Dry Associate Small and Medium Enterprise Impact Debt Fund', 'Dry Associates', 'Special Funds'],
  // Co-op
  ['Co-op Balanced Fund', 'Co-op Trust Investment Services', 'Balanced'],
  ['Co-op Equity Fund', 'Co-op Trust Investment Services', 'Equity'],
  ['Co-op Bond Fund', 'Co-op Trust Investment Services', 'Fixed Income / Bond'],
  ['Co-op Money Market Fund', 'Co-op Trust Investment Services', 'Money Market'],
  ['Co-op Fixed Income Gratuity Fund', 'Co-op Trust Investment Services', 'Fixed Income / Bond'],
  // Apollo
  ['Apollo Money Market Fund', 'Apollo Asset Management', 'Money Market'],
  ['Apollo Balanced Fund', 'Apollo Asset Management', 'Balanced'],
  ['Apollo Aggressive Growth Fund', 'Apollo Asset Management', 'Equity'],
  ['Apollo Equity Fund', 'Apollo Asset Management', 'Equity'],
  ['Apollo East Africa Fund', 'Apollo Asset Management', 'Equity'],
  ['Apollo Bond Fund', 'Apollo Asset Management', 'Fixed Income / Bond'],
  // Cytonn
  ['Cytonn Money Market Fund', 'Cytonn Asset Managers', 'Money Market'],
  ['Cytonn Balanced Fund', 'Cytonn Asset Managers', 'Balanced'],
  ['Cytonn Equity Fund', 'Cytonn Asset Managers', 'Equity'],
  ['Cytonn Africa Financial Services Fund', 'Cytonn Asset Managers', 'Equity'],
  ['Cytonn Money Market Fund (USD)', 'Cytonn Asset Managers', 'Money Market', 'USD'],
  // Orient
  ['Orient Hifadhi Fixed Income Fund', 'Orient Asset Management', 'Fixed Income / Bond'],
  ['Orient Kasha Money Market Fund', 'Orient Asset Management', 'Money Market'],
  ['Orient Dollar Money Market Fund', 'Orient Asset Management', 'Money Market', 'USD'],
  // Wanafunzi
  ['Wanafunzi Investment Unit Trust Fund', 'Wanafunzi', 'Balanced'],
  // Absa
  ['Absa Balanced Fund', 'Absa Asset Management', 'Balanced'],
  ['Absa Fixed Income Fund', 'Absa Asset Management', 'Fixed Income / Bond'],
  ['Absa Bond Fund', 'Absa Asset Management', 'Fixed Income / Bond'],
  ['Absa Dollar Money Market Fund', 'Absa Asset Management', 'Money Market', 'USD'],
  ['Absa USD Money Market Fund', 'Absa Asset Management', 'Money Market', 'USD'],
  ['Absa Equity Fund', 'Absa Asset Management', 'Equity'],
  ['Absa Shilling Money Market Fund', 'Absa Asset Management', 'Money Market'],
  // Jaza / Masaru / ADAM
  ['Jaza Premier Money Market Fund', 'Adam Capital', 'Money Market'],
  ['Masaru Wealth Management Fund', 'Synesis', 'Balanced'],
  ['Masaru Money Market Fund', 'Synesis', 'Money Market'],
  ['ADAM Balanced Fund', 'Adam Capital', 'Balanced'],
  ['ADAM Equities Fund', 'Adam Capital', 'Equity'],
  ['ADAM Fixed Income Fund', 'Adam Capital', 'Fixed Income / Bond'],
  ['ADAM Money Market Fund', 'Adam Capital', 'Money Market'],
  // KCB
  ['KCB Money Market Fund (KES)', 'KCB Asset Management', 'Money Market'],
  ['KCB Fixed Income Fund', 'KCB Asset Management', 'Fixed Income / Bond'],
  ['KCB Balanced Fund', 'KCB Asset Management', 'Balanced'],
  ['KCB Equity Fund', 'KCB Asset Management', 'Equity'],
  ['KCB Money Market Fund (USD)', 'KCB Asset Management', 'Money Market', 'USD'],
  // GenAfrica
  ['GenAfrica Money Market Fund', 'GenAfrica Asset Managers', 'Money Market'],
  ['GenAfrica Equity Fund', 'GenAfrica Asset Managers', 'Equity'],
  ['GenAfrica Fixed Income Fund', 'GenAfrica Asset Managers', 'Fixed Income / Bond'],
  // Amaka
  ['Amaka HOSP Fixed Income Fund', 'Amaka', 'Fixed Income / Bond'],
  ['Amaka Qualified Investor Tenant Purchase Scheme Fund', 'Amaka', 'Special Funds'],
  // Jubilee
  ['Jubilee Balanced Fund', 'Jubilee Insurance', 'Balanced'],
  ['Jubilee Equity Fund', 'Jubilee Insurance', 'Equity'],
  ['Jubilee Fixed Income (KES) Fund', 'Jubilee Insurance', 'Fixed Income / Bond'],
  ['Jubilee Fixed Income (USD) Fund', 'Jubilee Insurance', 'Fixed Income / Bond', 'USD'],
  ['Jubilee Money Market Fund (KES)', 'Jubilee Insurance', 'Money Market'],
  ['Jubilee Money Market Fund (USD)', 'Jubilee Insurance', 'Money Market', 'USD'],
  // Enwealth
  ['Enwealth Balanced Fund', 'Enwealth Capital', 'Balanced'],
  ['Enwealth Equity Fund', 'Enwealth Capital', 'Equity'],
  ['Enwealth Money Market Fund', 'Enwealth Capital', 'Money Market'],
  ['Enwealth Dollar Money Market Fund', 'Enwealth Capital', 'Money Market', 'USD'],
  ['Enwealth Fixed Income Fund', 'Enwealth Capital', 'Fixed Income / Bond'],
  // Kuza
  ['Kuza Fixed Income Fund', 'Kuza Asset Management', 'Fixed Income / Bond'],
  ['Kuza Money Market Fund (KES)', 'Kuza Asset Management', 'Money Market'],
  ['Kuza Money Market Fund (USD)', 'Kuza Asset Management', 'Money Market', 'USD'],
  ['Kuza Momentum Fund', 'Kuza Asset Management', 'Equity'],
  ['Kuza Shariah Momentum Fund', 'Kuza Asset Management', 'Shariah', 'KES', true],
  // Etica
  ['Etica Money Market Fund', 'Etica Capital', 'Money Market'],
  ['Etica Money Market Fund (USD)', 'Etica Capital', 'Money Market', 'USD'],
  ['Etica Fixed Income Fund', 'Etica Capital', 'Fixed Income / Bond'],
  ['Etica Fixed Income Fund (USD)', 'Etica Capital', 'Fixed Income / Bond', 'USD'],
  ['Etica Shariah Fund', 'Etica Capital', 'Shariah', 'KES', true],
  ['Etica Shariah Fund (USD)', 'Etica Capital', 'Shariah', 'USD', true],
  ['Etica Wealth Fund', 'Etica Capital', 'Balanced'],
  ['Etica Wealth Fund (USD)', 'Etica Capital', 'Balanced', 'USD'],
  // Lofty-Corban
  ['Lofty Corban Equity Fund', 'Lofty-Corban Investment Management', 'Equity'],
  ['Lofty Corban Money Market Fund (KES)', 'Lofty-Corban Investment Management', 'Money Market'],
  ['Lofty Corban Money Market Fund (USD)', 'Lofty-Corban Investment Management', 'Money Market', 'USD'],
  ['Lofty Corban Bond Fund (USD)', 'Lofty-Corban Investment Management', 'Fixed Income / Bond', 'USD'],
  ['Lofty Corban Bond Fund (KES)', 'Lofty-Corban Investment Management', 'Fixed Income / Bond'],
  // Standard Investment
  ['Standard Investment Equity Growth Fund', 'Standard Investment Bank', 'Equity'],
  ['Standard Investment Fixed Income Fund', 'Standard Investment Bank', 'Fixed Income / Bond'],
  ['Standard Investment Balanced Fund', 'Standard Investment Bank', 'Balanced'],
  // Faida
  ['Hazina Bond Fund', 'Faida Investment Bank', 'Fixed Income / Bond'],
  ['Angaza Money Market Fund', 'Faida Investment Bank', 'Money Market'],
  // Taifa
  ['Taifa Money Market Fund (KES)', 'Taifa', 'Money Market'],
  ['Taifa Money Market Fund (USD)', 'Taifa', 'Money Market', 'USD'],
  // Stanbic
  ['Stanbic Money Market Fund', 'Stanbic', 'Money Market'],
  ['Stanbic Fixed Income Fund', 'Stanbic', 'Fixed Income / Bond'],
  ['Stanbic Fixed Income Fund (USD)', 'Stanbic', 'Fixed Income / Bond', 'USD'],
  ['Stanbic Balanced Fund', 'Stanbic', 'Balanced'],
  ['Stanbic Equity Fund', 'Stanbic', 'Equity'],
  // Rencap
  ['Rencap Money Market Fund (KES)', 'Renaissance Capital', 'Money Market'],
  ['Rencap Money Market Fund (USD)', 'Renaissance Capital', 'Money Market', 'USD'],
  ['Rencap Balanced Fund (KES)', 'Renaissance Capital', 'Balanced'],
  ['Rencap Fixed Income Fund (KES)', 'Renaissance Capital', 'Fixed Income / Bond'],
  ['Rencap Fixed Income Fund (USD)', 'Renaissance Capital', 'Fixed Income / Bond', 'USD'],
  // Mayfair
  ['Mayfair Money Market Fund', 'Mayfair', 'Money Market'],
  ['Mayfair Fixed Income Fund', 'Mayfair', 'Fixed Income / Bond'],
  ['Mayfair Balanced Fund', 'Mayfair', 'Balanced'],
  ['Mayfair Equity Fund', 'Mayfair', 'Equity'],
  // Investcent
  ['Investcent Money Market Fund (KES)', 'Investcent Partners', 'Money Market'],
  ['Investcent Money Market Fund (USD)', 'Investcent Partners', 'Money Market', 'USD'],
  // ICEA LION
  ['ICEA LION Money Market Fund', 'ICEA Lion Asset Management', 'Money Market'],
  ['ICEA LION Equity Fund', 'ICEA Lion Asset Management', 'Equity'],
  ['ICEA LION Balanced Fund', 'ICEA Lion Asset Management', 'Balanced'],
  ['ICEA LION Bond Fund', 'ICEA Lion Asset Management', 'Fixed Income / Bond'],
  ['ICEA LION USD Fixed Income Fund', 'ICEA Lion Asset Management', 'Fixed Income / Bond', 'USD'],
  ['ICEA Fixed Income Fund KES', 'ICEA Lion Asset Management', 'Fixed Income / Bond'],
  // GCIB
  ['GCIB Money Market Fund', 'GCIB', 'Money Market'],
  ['GCIB Fixed Income Fund', 'GCIB', 'Fixed Income / Bond'],
  ['GCIB Shariah Fixed Income Fund', 'GCIB', 'Shariah', 'KES', true],
  ['GulfCap Fixed Income Fund', 'GCIB', 'Fixed Income / Bond'],
  ['GulfCap Money Market Fund', 'GCIB', 'Money Market'],
  // CPF
  ['CPF Money Market Fund', 'CPF', 'Money Market'],
  ['CPF Bond Fund', 'CPF', 'Fixed Income / Bond'],
  ['CPF USD Money Market Fund', 'CPF', 'Money Market', 'USD'],
  ['CPOF Balanced Fund', 'CPF', 'Balanced'],
  // Arvocap
  ['Arvocap Money Market Fund', 'Arvocap', 'Money Market'],
  ['Arvocap Ngao Fixed Income Distribution Fund', 'Arvocap', 'Fixed Income / Bond'],
  ['Arvocap Almasi Fixed Income Accumulation Fund', 'Arvocap', 'Fixed Income / Bond'],
  ['Arvocap Thamani Equity Fund', 'Arvocap', 'Equity'],
  // XENO
  ['Xeno Kenya Money Market Fund', 'Xeno', 'Money Market'],
  ['Xeno Kenya Bond Fund', 'Xeno', 'Fixed Income / Bond'],
  ['Xeno Kenya Regional East Africa Equity Fund', 'Xeno', 'Equity'],
  ['XENO Kenya East Africa Equity Fund (KES)', 'Xeno', 'Equity'],
  ['XENO Kenya Money Market Fund (USD)', 'Xeno', 'Money Market', 'USD'],
  ['XENO Kenya Fixed Income Fund (USD)', 'Xeno', 'Fixed Income / Bond', 'USD'],
  // Octagon
  ['Octagon Money Market Fund', 'Octagon', 'Money Market'],
  ['Octagon Balanced Fund', 'Octagon', 'Balanced'],
  ['Octagon Equity Fund', 'Octagon', 'Equity'],
  ['Octagon Fixed Income Fund', 'Octagon', 'Fixed Income / Bond'],
  ['Octagon USD Dollar Money Market Fund', 'Octagon', 'Money Market', 'USD'],
  // Ziidi
  ['Ziidi Money Market Fund', 'Safaricom (M-PESA)', 'Money Market'],
  ['Ziidi Biashara Money Market Fund', 'Safaricom (M-PESA)', 'Money Market'],
  // Capital A
  ['Capital A Rejesha Money Market Fund (KES)', 'Capital A', 'Money Market'],
  ['Capital A Rejesha Money Market Fund (USD)', 'Capital A', 'Money Market', 'USD'],
  ['Capital A Rejesha Fixed Income Fund (KES)', 'Capital A', 'Fixed Income / Bond'],
  ['Capital A Rejesha Fixed Income Fund (USD)', 'Capital A', 'Fixed Income / Bond', 'USD'],
  ['Capital A Rejesha Balanced Fund (KES)', 'Capital A', 'Balanced'],
  ['Capital A Rejesha Balanced Fund (USD)', 'Capital A', 'Balanced', 'USD'],
  ['Capital A Rejesha Equity Fund (KES)', 'Capital A', 'Equity'],
  ['Capital A Rejesha Equity Fund (USD)', 'Capital A', 'Equity', 'USD'],
  // Swala
  ['Swala Money Market Fund', 'Swala Capital', 'Money Market'],
  ['Swala Balanced Fund', 'Swala Capital', 'Balanced'],
  ['Swala Equity Fund', 'Swala Capital', 'Equity'],
  // Globetec
  ['Globetec Money Market Fund', 'Globetec Asset Managers', 'Money Market'],
  ['Globetec Equity Fund', 'Globetec Asset Managers', 'Equity'],
  ['Globetec Fixed Income Fund', 'Globetec Asset Managers', 'Fixed Income / Bond'],
  ['Globetec Dollar Fixed Income Fund', 'Globetec Asset Managers', 'Fixed Income / Bond', 'USD'],
  // Tradiam
  ['Wekeza Money Market Fund (KES)', 'Tradiam', 'Money Market'],
  ['Tradiam Fixed Income Fund (KES)', 'Tradiam', 'Fixed Income / Bond'],
  ['Tradiam Fixed Income Fund (USD)', 'Tradiam', 'Fixed Income / Bond', 'USD'],
  ['Mfalme Money Market Fund (KES)', 'Tradiam', 'Money Market'],
  ['Wekeza Fixed Income Fund (KES)', 'Tradiam', 'Fixed Income / Bond'],
  ['Tau Fixed Income Fund (USD)', 'Tradiam', 'Fixed Income / Bond', 'USD'],
  // Zamara
  ['Zamara Money Market Fund (KES)', 'Zamara', 'Money Market'],
  ['Zamara Money Market Fund (USD)', 'Zamara', 'Money Market', 'USD'],
  ['Zamara Fixed Income Fund (KES)', 'Zamara', 'Fixed Income / Bond'],
  // Pergamon
  ['Pergamon Money Market Fund (KES)', 'Pergamon (PIB Africa)', 'Money Market'],
  ['Pergamon Money Market Fund (USD)', 'Pergamon (PIB Africa)', 'Money Market', 'USD'],
  ['Pergamon Equity Fund', 'Pergamon (PIB Africa)', 'Equity'],
  ['Pergamon Fixed Income Fund', 'Pergamon (PIB Africa)', 'Fixed Income / Bond'],
  ['Pergamon Balanced Fund', 'Pergamon (PIB Africa)', 'Balanced'],
  // EDC Kenya
  ['EDC Kenya Balanced Fund', 'EDC Kenya', 'Balanced'],
  ['EDC Kenya KES Fixed Income Fund', 'EDC Kenya', 'Fixed Income / Bond'],
  ['EDC Kenya Dollar Fixed Income Fund', 'EDC Kenya', 'Fixed Income / Bond', 'USD'],
  ['EDC Kenya Equity Fund', 'EDC Kenya', 'Equity'],
  ['EDC Kenya Money Market Fund', 'EDC Kenya', 'Money Market'],
  // Cinemark
  ['Cinemark KES Money Market Fund', 'Cinemark', 'Money Market'],
  ['Cinemark KES Fixed Income Fund', 'Cinemark', 'Fixed Income / Bond'],
  ['Cinemark USD Fixed Income Fund', 'Cinemark', 'Fixed Income / Bond', 'USD'],
  // Karsis (Zubari)
  ['Zubari KES Money Market Fund', 'Karsis', 'Money Market'],
  ['Zubari USD Money Market Fund', 'Karsis', 'Money Market', 'USD'],
  ['Zubari KES Fixed Income Fund', 'Karsis', 'Fixed Income / Bond'],
  ['Zubari USD Fixed Income Fund', 'Karsis', 'Fixed Income / Bond', 'USD'],
];

// Special Funds come from SPECIAL_FUNDS above; non-special from REGISTER_FUNDS.
// Extra listed NSE schemes not on the CIS register:
const EXTRA_FUNDS = [
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
  'Special Funds': { structure: 'Collective Investment Scheme', riskLevel: 'Medium-High', liquidity: 'Fund terms (T+2)', assetClass: 'Alternative fixed income / structured', objective: 'Pursue enhanced, less-correlated returns through alternative income and structured strategies under the scheme’s disclosed terms.' },
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
    sharia_compliant: !!f.sharia,
    data_source: DATA_SOURCE,
    data_status: 'metadata',
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
    const ALL = [
      ...SEED,
      ...SPECIAL_FUNDS,
      ...REGISTER_FUNDS.map(([name, manager, category, currency, sharia]) => ({ name, manager, category, currency, sharia })),
      ...EXTRA_FUNDS,
    ];
    const ids = [];
    for (const f of ALL) {
      const r = seedRow(f);
      r.id = slugify(r.name); // key everything by name so overlaps dedupe
      ids.push(r.id);
      await pool.query(
        `INSERT INTO special_funds
           (id, name, manager, category, structure, currency, country, listing, risk_level, liquidity, asset_class, objective, sharia_compliant, data_source, data_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           manager = EXCLUDED.manager,
           category = EXCLUDED.category,
           structure = EXCLUDED.structure,
           currency = EXCLUDED.currency,
           country = EXCLUDED.country,
           listing = EXCLUDED.listing,
           risk_level = EXCLUDED.risk_level,
           liquidity = EXCLUDED.liquidity,
           asset_class = EXCLUDED.asset_class,
           objective = EXCLUDED.objective,
           sharia_compliant = EXCLUDED.sharia_compliant,
           data_source = EXCLUDED.data_source,
           updated_at = NOW()`,
        [r.id, r.name, r.manager, r.category, r.structure, r.currency, r.country, r.listing, r.risk_level, r.liquidity, r.asset_class, r.objective, r.sharia_compliant, r.data_source, r.data_status]
      );
    }
    // Prune stale seeded rows that are no longer in the source list (e.g. a fund
    // renamed/re-categorised). Only touches pure-metadata rows — never an
    // ingested/verified record.
    try {
      await pool.query(
        `DELETE FROM special_funds WHERE data_status = 'metadata' AND NOT (id = ANY($1::text[]))`,
        [ids]
      );
    } catch (e) { console.warn('[SpecialFunds] prune skipped:', e.message); }
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

// ── Bulk / CSV ingestion ─────────────────────────────────────────────────────
// Header aliases so a provider spreadsheet maps onto our columns regardless of
// exact wording. Keys are lower-cased header cells.
const CSV_ALIASES = {
  id: 'id', fund_id: 'id', slug: 'id',
  name: 'name', fund: 'name', 'fund name': 'name',
  manager: 'manager', 'fund manager': 'manager',
  category: 'category', type: 'category', structure: 'structure', currency: 'currency',
  listing: 'listing', ticker: 'listing',
  yield: 'yield_pct', 'yield %': 'yield_pct', 'yield_pct': 'yield_pct',
  ytd: 'ytd_return_pct', 'ytd return': 'ytd_return_pct', ytd_return_pct: 'ytd_return_pct',
  '1y return': 'one_year_return_pct', '1-year return': 'one_year_return_pct', one_year_return_pct: 'one_year_return_pct', '1yr': 'one_year_return_pct',
  '3y return': 'three_year_return_pct', '3-year return': 'three_year_return_pct', three_year_return_pct: 'three_year_return_pct',
  nav: 'nav', 'nav per unit': 'nav', aum: 'aum', 'assets under management': 'aum',
  'min investment': 'min_investment', min_investment: 'min_investment', minimum: 'min_investment',
  'management fee': 'management_fee_pct', management_fee_pct: 'management_fee_pct', 'mgmt fee': 'management_fee_pct',
  'expense ratio': 'expense_ratio_pct', expense_ratio_pct: 'expense_ratio_pct', ter: 'expense_ratio_pct',
  'other fees': 'other_fees', other_fees: 'other_fees',
  risk: 'risk_level', risk_level: 'risk_level', 'risk classification': 'risk_level',
  risk_notes: 'risk_notes', 'risk notes': 'risk_notes', liquidity: 'liquidity',
  asset_class: 'asset_class', 'asset class': 'asset_class',
  benchmarks: 'benchmarks', benchmark: 'benchmarks', objective: 'objective',
  source: 'data_source', data_source: 'data_source', source_url: 'source_url', url: 'source_url',
  published_at: 'published_at', 'published date': 'published_at',
  observation_date: 'observation_date', 'as of': 'observation_date', as_of: 'observation_date', date: 'observation_date',
  sharia: 'sharia_compliant', 'sharia compliant': 'sharia_compliant', sharia_compliant: 'sharia_compliant',
  inception_year: 'inception_year', 'inception year': 'inception_year',
};

// RFC-4180-ish CSV parser (handles quotes, embedded commas/newlines).
function parseCsv(text) {
  const s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h).trim().toLowerCase());
  return rows.slice(1)
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => {
      const obj = {};
      header.forEach((h, i) => { obj[CSV_ALIASES[h] || h] = r[i] !== undefined ? String(r[i]).trim() : ''; });
      return obj;
    });
}

function parseAmount(v) {
  const s = String(v).toUpperCase();
  const m = s.match(/(-?\d[\d,]*\.?\d*)\s*([KMBT])?/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] || 1;
  return n * mult;
}

const AMOUNT_FIELDS = new Set(['aum', 'min_investment']);

function cleanRecord(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === '' || v === undefined || v === null) continue;
    out[k] = v;
  }
  for (const f of NUMERIC_FIELDS) {
    if (out[f] === undefined) continue;
    if (AMOUNT_FIELDS.has(f)) {
      out[f] = parseAmount(out[f]);
    } else {
      const stripped = String(out[f]).replace(/[^0-9.\-]/g, '');
      const n = stripped === '' || stripped === '-' ? NaN : Number(stripped);
      out[f] = Number.isFinite(n) ? n : null;
    }
  }
  if (out.inception_year !== undefined && out.inception_year !== null) out.inception_year = Math.round(out.inception_year);
  if (out.sharia_compliant !== undefined) out.sharia_compliant = /^(true|yes|1|y)$/i.test(String(out.sharia_compliant));
  return out;
}

// Resolve a CSV/API row to a target fund id: exact id, then case-insensitive
// name, else create (id if supplied, otherwise a slug of the name).
async function resolveFundId({ id, name }) {
  if (id) {
    const { rows } = await pool.query('SELECT id FROM special_funds WHERE id = $1', [id]);
    if (rows.length) return rows[0].id;
  }
  if (name) {
    const { rows } = await pool.query('SELECT id FROM special_funds WHERE lower(name) = lower($1) ORDER BY id LIMIT 1', [name]);
    if (rows.length) return rows[0].id;
  }
  if (id) return String(id).slice(0, 120);
  if (name) return slugify(name);
  return null;
}

// Ingest many funds in one call. `defaults` (e.g. { data_source, observation_date,
// source_url }) are merged under every row so an import carries one provenance.
async function bulkIngest(records = [], defaults = {}) {
  const summary = { total: Array.isArray(records) ? records.length : 0, updated: 0, created: 0, skipped: 0, errors: [] };
  for (let i = 0; i < (records || []).length; i++) {
    try {
      const rec = cleanRecord({ ...defaults, ...(records[i] || {}) });
      if (!rec.id && !rec.name) { summary.skipped++; summary.errors.push({ row: i + 1, reason: 'missing id/name' }); continue; }
      const targetId = await resolveFundId({ id: rec.id, name: rec.name });
      if (!targetId) { summary.skipped++; summary.errors.push({ row: i + 1, reason: 'unresolved' }); continue; }
      const existed = (await pool.query('SELECT 1 FROM special_funds WHERE id = $1', [targetId])).rows.length > 0;
      const { id: _omitId, ...fields } = rec;
      await ingestFund(targetId, fields);
      if (existed) summary.updated++; else summary.created++;
    } catch (e) {
      summary.skipped++;
      summary.errors.push({ row: i + 1, reason: e.message });
    }
  }
  return summary;
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

async function listFunds({ search, category, manager, currency, riskLevel, sharia, country, minInvestmentMax, sort = 'name', limit = 200 } = {}) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (country && country !== 'all') where.push(`COALESCE(country, 'Kenya') = ${p(country)}`);
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

const MARKET_CURRENCY = { Kenya: 'KES', 'South Africa': 'ZAR', Nigeria: 'NGN' };

async function getSummary({ country } = {}) {
  const params = [];
  let where = '';
  if (country && country !== 'all') { params.push(country); where = `WHERE COALESCE(country, 'Kenya') = $1`; }
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int total,
      COUNT(DISTINCT category)::int categories,
      COUNT(DISTINCT manager)::int managers,
      COUNT(DISTINCT currency)::int currencies,
      COUNT(*) FILTER (WHERE data_status = 'verified')::int verified,
      COUNT(*) FILTER (WHERE yield_pct IS NOT NULL)::int AS with_yield,
      MAX(COALESCE(observation_date, ingested_at)) AS latest_date
    FROM special_funds ${where}`, params);
  const r = rows[0] || {};
  const market = (country && country !== 'all') ? country : COUNTRY;
  return {
    totalFunds: r.total || 0,
    categories: r.categories || 0,
    managers: r.managers || 0,
    currencies: r.currencies || 0,
    verifiedFunds: r.verified || 0,
    fundsWithYield: r.with_yield || 0,
    latestDataDate: r.latest_date || null,
    country: market,
    primaryCurrency: MARKET_CURRENCY[market] || CURRENCY,
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
  bulkIngest,
  parseCsv,
  COMPARE_ROWS,
};
