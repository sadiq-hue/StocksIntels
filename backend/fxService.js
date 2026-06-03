const { generic } = require('./apiClient');

let cachedRate = null;
let lastFetch = 0;
const CACHE_TTL_MS = parseInt(process.env.FX_CACHE_TTL_MS || '300000', 10); // 5 min default

const FX_API_URLS = [
  process.env.FX_API_URL,
  'https://open.er-api.com/v6/latest/USD',
  'https://api.exchangerate-api.com/v4/latest/USD',
].filter(Boolean);

async function fetchFromUrl(url) {
  const { data } = await generic.get(url, { timeout: 8000 });
  const rate = data?.rates?.KES;
  if (rate && rate > 0) return rate;
  return null;
}

async function fetchRate() {
  const now = Date.now();
  if (cachedRate && (now - lastFetch) < CACHE_TTL_MS) {
    return cachedRate;
  }

  for (const url of FX_API_URLS) {
    try {
      const rate = await fetchFromUrl(url);
      if (rate && rate > 0) {
        cachedRate = rate;
        lastFetch = now;
        return rate;
      }
    } catch (err) {
      console.error(`[FXService] Fetch error from ${url}: ${err.message}`);
    }
  }

  if (cachedRate) return cachedRate;
  return 130; // ultimate fallback
}

async function getRate() {
  return fetchRate();
}

function getCachedRate() {
  return cachedRate || 130;
}

module.exports = { getRate, getCachedRate };
