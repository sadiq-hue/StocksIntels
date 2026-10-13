const { generic } = require('./apiClient');

let cachedRate = null;      // USD -> KES (legacy single-rate callers)
let cachedRates = null;     // { USDKES, USDNGN, USDZAR, USDGHS }
let lastFetch = 0;
const CACHE_TTL_MS = parseInt(process.env.FX_CACHE_TTL_MS || '300000', 10); // 5 min default

const FX_API_URLS = [
  process.env.FX_API_URL,
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
].filter(Boolean);

async function fetchRates() {
  const now = Date.now();
  if (cachedRates && (now - lastFetch) < CACHE_TTL_MS) {
    return cachedRates;
  }

  for (const url of FX_API_URLS) {
    try {
      const { data } = await generic.get(url, { timeout: 8000 });
      const r = data && data.rates;
      if (r && r.KES > 0) {
        cachedRates = {
          USDKES: r.KES,
          USDNGN: r.NGN || null,
          USDZAR: r.ZAR || null,
          USDGHS: r.GHS || null,
        };
        cachedRate = r.KES;
        lastFetch = now;
        return cachedRates;
      }
    } catch (err) {
      console.error(`[FXService] Fetch error from ${url}: ${err.message}`);
    }
  }

  if (cachedRates) return cachedRates;
  return { USDKES: cachedRate || 130, USDNGN: null, USDZAR: null, USDGHS: null };
}

async function getRate() {
  const rates = await fetchRates();
  return rates.USDKES;
}

// Rates for every currency the app can hold, so a mixed-currency portfolio
// (KES/NGN/ZAR/GHS/USD) can be aggregated into KES.
async function getRates() {
  return fetchRates();
}

function getCachedRate() {
  if (cachedRates) return cachedRates.USDKES;
  return cachedRate || 130;
}

module.exports = { getRate, getRates, getCachedRate };
