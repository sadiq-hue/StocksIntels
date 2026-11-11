// Lightweight company-profile fallback for markets where Yahoo/TwelveData do
// not provide a company overview (NSE, NGX, JSE). It derives only verifiable
// fields from the tracked listing data (name, sector, exchange, country,
// currency); it never invents a CEO, employee count or business history.

const { resolveStockName, guessSector, KNOWN_FUNDAMENTALS, NSE_FUNDAMENTALS, NSE_SYMBOLS } = require('./stockData');

const EXCHANGES = {
  NSE: { label: 'Nairobi Securities Exchange (NSE)', country: 'Kenya', currency: 'KES' },
  NGX: { label: 'Nigerian Exchange (NGX)', country: 'Nigeria', currency: 'NGN' },
  JSE: { label: 'Johannesburg Stock Exchange (JSE)', country: 'South Africa', currency: 'ZAR' },
  US: { label: 'US equity market', country: 'United States', currency: 'USD' },
};

function marketOf(raw) {
  const s = String(raw || '').toUpperCase();
  if (s.startsWith('NGX:')) return 'NGX';
  if (s.startsWith('JSE:')) return 'JSE';
  if (s.startsWith('NSE:')) return 'NSE';
  const base = s.replace(/\.(KE|NG|ZA)$/i, '');
  if (NSE_SYMBOLS.includes(base)) return 'NSE';
  return 'US';
}

function bare(raw) {
  return String(raw || '').toUpperCase().replace(/^(NSE|NGX|JSE):/i, '').replace(/\.(KE|NG|ZA)$/i, '').trim();
}

function getDerivedProfile(raw) {
  const market = marketOf(raw);
  const ticker = bare(raw);
  if (!ticker) return null;
  const known = KNOWN_FUNDAMENTALS[ticker] || NSE_FUNDAMENTALS[ticker] || null;
  const name = known?.name || resolveStockName(ticker) || ticker;
  const sector = known?.sector || guessSector(ticker) || null;
  const exchange = EXCHANGES[market] || EXCHANGES.US;
  const description = sector
    ? `${name} is a ${String(sector).toLowerCase()} company listed on the ${exchange.label}. It trades in ${exchange.currency} and is tracked by StocksIntels for fundamental, technical and macro analysis.`
    : `${name} is listed on the ${exchange.label} and trades in ${exchange.currency}.`;
  return {
    isAfrican: market !== 'US',
    market,
    companyName: name,
    name,
    sector,
    industry: sector,
    country: exchange.country,
    currency: exchange.currency,
    exchange: exchange.label,
    website: null,
    ceo: null,
    employees: null,
    description,
    marketCap: known?.marketCap || null,
  };
}

function enrichStock(stock, symbol) {
  const derived = getDerivedProfile(symbol);
  if (!derived) return stock;
  return {
    ...stock,
    name: stock?.name || derived.name,
    sector: stock?.sector || derived.sector,
    industry: stock?.industry || derived.industry,
    description: stock?.description || (derived.isAfrican ? derived.description : stock?.description),
    country: stock?.country || derived.country,
    website: stock?.website || null,
    ceo: stock?.ceo || null,
    employees: stock?.employees || null,
  };
}

module.exports = { getDerivedProfile, enrichStock, marketOf };
