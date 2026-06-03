const axios = require('axios');

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

const KENYAN_BONDS = [
  { id: 'KE-GOV-2028', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 10-Year Government Bond', coupon: 13.50, maturity: '2028-06-15', ytm: 13.80, price: 98.50, currency: 'KES', rating: 'B+', amountIssued: 75000000000, description: 'Benchmark 10-year sovereign bond' },
  { id: 'KE-GOV-2030', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 15-Year Government Bond', coupon: 14.25, maturity: '2030-09-30', ytm: 14.10, price: 101.20, currency: 'KES', rating: 'B+', amountIssued: 50000000000, description: 'Long-term infrastructure development bond' },
  { id: 'KE-GOV-2033', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 20-Year Government Bond', coupon: 14.75, maturity: '2033-12-15', ytm: 14.50, price: 102.80, currency: 'KES', rating: 'B+', amountIssued: 60000000000, description: 'Long-term sovereign development bond' },
  { id: 'KE-GOV-2040', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya 25-Year Government Bond', coupon: 15.00, maturity: '2040-03-01', ytm: 14.80, price: 103.50, currency: 'KES', rating: 'B+', amountIssued: 40000000000, description: 'Long tenor sovereign bond' },
  { id: 'KE-IFB-2027', type: 'Infrastructure', issuer: 'Republic of Kenya', name: 'Kenya Infrastructure Bond 2027', coupon: 13.25, maturity: '2027-11-20', ytm: 13.00, price: 102.30, currency: 'KES', rating: 'B+', amountIssued: 35000000000, description: 'Tax-free infrastructure bond' },
  { id: 'KE-IFB-2029', type: 'Infrastructure', issuer: 'Republic of Kenya', name: 'Kenya Infrastructure Bond 2029', coupon: 13.75, maturity: '2029-05-10', ytm: 13.50, price: 101.90, currency: 'KES', rating: 'B+', amountIssued: 45000000000, description: 'Infrastructure project financing' },
  { id: 'KE-TB-91D', type: 'T-Bill', issuer: 'Republic of Kenya', name: '91-Day Treasury Bill', coupon: 0, maturity: '2026-08-11', ytm: 12.80, price: 96.85, currency: 'KES', rating: 'B+', amountIssued: 25000000000, description: 'Short-term government paper' },
  { id: 'KE-TB-182D', type: 'T-Bill', issuer: 'Republic of Kenya', name: '182-Day Treasury Bill', coupon: 0, maturity: '2026-11-10', ytm: 13.10, price: 93.70, currency: 'KES', rating: 'B+', amountIssued: 30000000000, description: 'Medium-term government paper' },
  { id: 'KE-TB-364D', type: 'T-Bill', issuer: 'Republic of Kenya', name: '364-Day Treasury Bill', coupon: 0, maturity: '2027-05-12', ytm: 13.40, price: 88.40, currency: 'KES', rating: 'B+', amountIssued: 40000000000, description: 'One-year government paper' },
  { id: 'KE-CORP-SAF-2028', type: 'Corporate', issuer: 'Safaricom PLC', name: 'Safaricom Corporate Bond 2028', coupon: 12.50, maturity: '2028-08-20', ytm: 11.80, price: 103.40, currency: 'KES', rating: 'AA-', amountIssued: 15000000000, description: 'Blue-chip telco corporate bond' },
  { id: 'KE-CORP-EQTY-2027', type: 'Corporate', issuer: 'Equity Group Holdings', name: 'Equity Bank Subordinated Bond', coupon: 13.00, maturity: '2027-04-15', ytm: 12.50, price: 102.60, currency: 'KES', rating: 'A+', amountIssued: 12000000000, description: 'Tier II subordinated bank bond' },
  { id: 'KE-CORP-KCB-2029', type: 'Corporate', issuer: 'KCB Group PLC', name: 'KCB Corporate Bond 2029', coupon: 12.75, maturity: '2029-10-30', ytm: 12.30, price: 101.80, currency: 'KES', rating: 'A', amountIssued: 10000000000, description: 'Senior unsecured bank bond' },
  { id: 'KE-CORP-EABL-2026', type: 'Corporate', issuer: 'EABL', name: 'EABL Commercial Paper', coupon: 11.50, maturity: '2026-09-01', ytm: 11.20, price: 100.50, currency: 'KES', rating: 'AA', amountIssued: 5000000000, description: 'Short-term corporate paper' },
  { id: 'KE-CORP-KPLC-2028', type: 'Corporate', issuer: 'Kenya Power', name: 'Kenya Power Infrastructure Bond', coupon: 13.25, maturity: '2028-03-15', ytm: 13.80, price: 97.20, currency: 'KES', rating: 'BB+', amountIssued: 8000000000, description: 'Power sector corporate bond' },
  { id: 'KE-SUK-2027', type: 'Government', issuer: 'Republic of Kenya', name: 'Kenya Sukuk Bond 2027', coupon: 12.75, maturity: '2027-12-20', ytm: 12.60, price: 101.10, currency: 'KES', rating: 'B+', amountIssued: 20000000000, description: 'Islamic sovereign sukuk bond' },
];

const GLOBAL_BONDS = [
  { id: 'US-T-10Y', type: 'Government', issuer: 'US Treasury', name: 'US 10-Year Treasury Note', coupon: 4.25, maturity: '2036-05-15', ytm: 4.38, price: 99.20, currency: 'USD', rating: 'AAA', amountIssued: 450000000000, description: 'Benchmark US 10-year Treasury' },
  { id: 'US-T-30Y', type: 'Government', issuer: 'US Treasury', name: 'US 30-Year Treasury Bond', coupon: 4.50, maturity: '2056-05-15', ytm: 4.65, price: 97.80, currency: 'USD', rating: 'AAA', amountIssued: 350000000000, description: 'Long-term US Treasury bond' },
  { id: 'US-T-2Y', type: 'Government', issuer: 'US Treasury', name: 'US 2-Year Treasury Note', coupon: 4.00, maturity: '2028-05-31', ytm: 4.12, price: 99.80, currency: 'USD', rating: 'AAA', amountIssued: 250000000000, description: 'Short-term US Treasury note' },
  { id: 'UK-GILT-10Y', type: 'Government', issuer: 'UK Government', name: 'UK 10-Year Gilt', coupon: 4.00, maturity: '2036-06-07', ytm: 4.55, price: 96.50, currency: 'GBP', rating: 'AA', amountIssued: 200000000000, description: 'Benchmark UK government gilt' },
  { id: 'DE-BUND-10Y', type: 'Government', issuer: 'German Government', name: 'German 10-Year Bund', coupon: 2.60, maturity: '2036-02-15', ytm: 2.85, price: 97.80, currency: 'EUR', rating: 'AAA', amountIssued: 180000000000, description: 'Benchmark German bund' },
  { id: 'JP-GOV-10Y', type: 'Government', issuer: 'Japan Government', name: 'Japan 10-Year Government Bond', coupon: 0.80, maturity: '2036-03-20', ytm: 1.45, price: 94.20, currency: 'JPY', rating: 'A+', amountIssued: 300000000000, description: 'Japanese government bond' },
  { id: 'IN-GOV-10Y', type: 'Government', issuer: 'India Government', name: 'India 10-Year Government Bond', coupon: 7.10, maturity: '2036-04-15', ytm: 7.30, price: 98.60, currency: 'INR', rating: 'BBB-', amountIssued: 150000000000, description: 'Indian government bond' },
  { id: 'NG-GOV-10Y', type: 'Government', issuer: 'Nigeria Government', name: 'Nigeria 10-Year Government Bond', coupon: 18.50, maturity: '2036-01-30', ytm: 19.20, price: 96.30, currency: 'NGN', rating: 'B-', amountIssued: 20000000000, description: 'Nigerian sovereign bond' },
  { id: 'ZA-GOV-10Y', type: 'Government', issuer: 'South Africa Government', name: 'South Africa 10-Year Government Bond', coupon: 11.50, maturity: '2036-02-28', ytm: 11.80, price: 97.40, currency: 'ZAR', rating: 'BB-', amountIssued: 30000000000, description: 'South African sovereign bond' },
];

function getBonds(market) {
  const bonds = market === 'kenya' ? KENYAN_BONDS : GLOBAL_BONDS;
  // Add synthetic price fluctuations so data feels alive
  const jitter = () => +(Math.random() * 0.5 - 0.25).toFixed(2);
  return bonds.map(b => ({
    ...b,
    price: +(b.price + jitter()).toFixed(2),
    ytm: +(b.ytm + Math.random() * 0.1 - 0.05).toFixed(2),
  }));
}

function getBondById(id) {
  const all = [...KENYAN_BONDS, ...GLOBAL_BONDS];
  return all.find(b => b.id === id) || null;
}

function getBondSummary() {
  const keYields = KENYAN_BONDS.filter(b => b.type === 'Government' && b.maturity.includes('203'));
  const globalYields = GLOBAL_BONDS.filter(b => b.id.endsWith('-10Y'));
  return {
    kenya10Y: keYields.find(b => b.id === 'KE-GOV-2028')?.ytm || 13.80,
    us10Y: GLOBAL_BONDS.find(b => b.id === 'US-T-10Y')?.ytm || 4.38,
    kenyaTbill91D: KENYAN_BONDS.find(b => b.id === 'KE-TB-91D')?.ytm || 12.80,
    yieldCurve: [
      { term: '91d', kenya: 12.80, us: 4.12 },
      { term: '182d', kenya: 13.10, us: 4.05 },
      { term: '1y', kenya: 13.40, us: 3.95 },
      { term: '2y', kenya: 13.60, us: 4.12 },
      { term: '5y', kenya: 13.70, us: 4.25 },
      { term: '10y', kenya: 13.80, us: 4.38 },
      { term: '20y', kenya: 14.50, us: 4.55 },
      { term: '30y', kenya: 14.80, us: 4.65 },
    ],
  };
}

module.exports = { getBonds, getBondById, getBondSummary };
