// Macro & Country-Level Conditions for the Signal Engine
// Sources: World Bank API, IMF API, OECD Data API (free) + static reference data

const { generic } = require('./apiClient');
const { NSE_SYMBOLS } = require('./stockData');

// ─── Static Reference Data (used when APIs are unavailable) ────────────────
const COUNTRY_MACRO = {
  US: {
    name: 'United States',
    code: 'us',
    currency: 'USD',
    centralBank: 'Federal Reserve (Fed)',
    interestRate: 4.50,
    gdpGrowth: 2.5,
    inflation: 5.1,
    currentAccount: -3.2,
    politicalRisk: 15,
    creditRating: 'AA+',
    creditScore: 90,
    pmi: 48.0,
    newsSentiment: 'neutral'
  },
  KE: {
    name: 'Kenya',
    code: 'ke',
    currency: 'KES',
    centralBank: 'Central Bank of Kenya (CBK)',
    interestRate: 12.0,
    gdpGrowth: 5.0,
    inflation: 5.5,
    currentAccount: -4.5,
    politicalRisk: 45,
    creditRating: 'B+',
    creditScore: 35,
    pmi: 49.5,
    newsSentiment: 'neutral'
  },
  EU: {
    name: 'Eurozone',
    code: 'eu',
    currency: 'EUR',
    centralBank: 'European Central Bank (ECB)',
    interestRate: 3.75,
    gdpGrowth: 1.0,
    inflation: 2.5,
    currentAccount: 2.8,
    politicalRisk: 20,
    creditRating: 'AAA',
    creditScore: 95,
    pmi: 48.5,
    newsSentiment: 'neutral'
  },
  JP: {
    name: 'Japan',
    code: 'jp',
    currency: 'JPY',
    centralBank: 'Bank of Japan (BoJ)',
    interestRate: 0.25,
    gdpGrowth: 1.2,
    inflation: 2.0,
    currentAccount: 3.5,
    politicalRisk: 15,
    creditRating: 'A+',
    creditScore: 75,
    pmi: 49.8,
    newsSentiment: 'neutral'
  },
  UK: {
    name: 'United Kingdom',
    code: 'gb',
    currency: 'GBP',
    centralBank: 'Bank of England (BoE)',
    interestRate: 5.25,
    gdpGrowth: 1.5,
    inflation: 3.5,
    currentAccount: -3.8,
    politicalRisk: 18,
    creditRating: 'AA',
    creditScore: 85,
    pmi: 51.2,
    newsSentiment: 'neutral'
  }
};

const CREDIT_SCORE_MAP = {
  'AAA': 95, 'AA+': 90, 'AA': 85, 'AA-': 80,
  'A+': 75, 'A': 70, 'A-': 65,
  'BBB+': 60, 'BBB': 55, 'BBB-': 50,
  'BB+': 45, 'BB': 40, 'BB-': 35,
  'B+': 30, 'B': 25, 'B-': 20,
  'CCC': 10, 'CC': 5, 'C': 3, 'D': 0
};

// ─── Country Mapping ───────────────────────────────────────────────────────
function getCountryForSymbol(symbol) {
  // Use the canonical NSE universe from stockData so every NSE name (KQ, SCAN,
  // KEGN, BRIT, ...) gets Kenya macro context instead of falling through to US.
  return NSE_SYMBOLS.includes(String(symbol).toUpperCase()) ? 'KE' : 'US';
}

function getMacroBundle(country) {
  const live = liveMacro.get(country);
  if (live) return live;
  const base = COUNTRY_MACRO[country] || COUNTRY_MACRO.US;
  return {
    data: { ...base },
    meta: { live: false, sources: ['Reference estimate'], asOf: {}, referenceFields: ALL_CONDITION_KEYS.slice(), fetchedAt: null },
  };
}

function getMacroData(country) {
  return getMacroBundle(country).data;
}

// ─── Cache ─────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > (hit.ttl || CACHE_TTL)) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
  return data;
}

// ─── Live macro overlay ────────────────────────────────────────────────────
// Official data pulled from the World Bank (no API key); IMF supplies a GDP
// cross-check when the World Bank has no fresh value. Refreshed on boot and
// every 6h. Fields that have no free live source (PMI, sovereign credit
// rating, political risk) keep the curated COUNTRY_MACRO value and are listed
// in `meta.referenceFields` so the UI can label them as reference estimates.
const worldBankCountry = { US: 'US', KE: 'KE', EU: 'XC', JP: 'JP', UK: 'GB' };
const imfCountry = { US: 'USA', KE: 'KEN', EU: 'EU', JP: 'JPN', UK: 'GBR' };

const WB_FIELDS = {
  gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  inflation: 'FP.CPI.TOTL.ZG',
  currentAccount: 'BN.CAB.XOKA.GD.ZS',
  interestRate: 'FR.INR.LEND',
};

// The condition keys that appear in `getMacroScore().conditions`.
const ALL_CONDITION_KEYS = ['interestRateDifferential', 'gdpGrowth', 'inflation', 'currentAccount', 'politicalRisk', 'creditRating', 'pmi'];

const liveMacro = new Map(); // country -> { data, meta }

// ─── World Bank API ────────────────────────────────────────────────────────
async function worldBankIndicator(countryCode, indicator) {
  const key = `wb_${countryCode}_${indicator}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    const { data } = await generic.get(
      `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?format=json&per_page=5&mrnev=1`,
      { timeout: 12000 }
    );
    const rows = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    const hit = rows.find((r) => r && r.value != null);
    if (hit) {
      return cacheSet(key, { value: parseFloat(hit.value), year: String(hit.date) }, CACHE_TTL);
    }
  } catch (err) {
    /* fall back to curated reference data */
  }
  return null;
}

// ─── IMF API (GDP growth cross-check) ──────────────────────────────────────
async function fetchIMFGrowth(countryCode) {
  const key = `imf_${countryCode}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  const imfCode = imfCountry[countryCode];
  if (!imfCode) return null;

  try {
    const { data } = await generic.get(
      'https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH',
      { timeout: 12000 }
    );
    const series = data?.values?.NGDP_RPCH?.[imfCode];
    if (series) {
      const currentYear = new Date().getFullYear();
      // Only use actuals/estimates, never multi-year projections.
      const years = Object.keys(series)
        .filter((y) => series[y] != null && Number(y) <= currentYear)
        .sort();
      if (years.length) {
        const last = years[years.length - 1];
        return cacheSet(key, { value: Number(series[last]), year: last }, CACHE_TTL);
      }
    }
  } catch { /* silent */ }
  return null;
}

// ─── Scoring Functions ─────────────────────────────────────────────────────
// Each returns { score: 0-100, signal: 'BUY'|'SELL'|'NEUTRAL', detail: string }

function scoreInterestRateDifferential(countryData, referenceRate = 4.50) {
  const rate = countryData.interestRate;
  const diff = rate - referenceRate;

  if (diff > 3.0) {
    return { score: 25, signal: 'SELL', detail: `Rate ${rate}% is ${diff.toFixed(1)}pp above Fed — capital outflow risk` };
  } else if (diff > 1.5) {
    return { score: 40, signal: 'NEUTRAL', detail: `Rate ${rate}% is ${diff.toFixed(1)}pp above Fed — moderately unfavorable` };
  } else if (diff > -0.5) {
    return { score: 55, signal: 'NEUTRAL', detail: `Rate ${rate}% aligns with Fed — neutral` };
  } else if (diff > -2.0) {
    return { score: 70, signal: 'BUY', detail: `Rate ${rate}% is ${Math.abs(diff).toFixed(1)}pp below Fed — capital inflow favorable` };
  } else {
    return { score: 85, signal: 'BUY', detail: `Rate ${rate}% is ${Math.abs(diff).toFixed(1)}pp well below Fed — strong capital inflow` };
  }
}

function scoreGDPGrowth(countryData) {
  const gdp = countryData.gdpGrowth;

  if (gdp >= 5.0) {
    return { score: 85, signal: 'BUY', detail: `GDP growth ${gdp}% — rapid expansion` };
  } else if (gdp >= 3.0) {
    return { score: 70, signal: 'BUY', detail: `GDP growth ${gdp}% — above trend` };
  } else if (gdp >= 1.5) {
    return { score: 55, signal: 'NEUTRAL', detail: `GDP growth ${gdp}% — stable` };
  } else if (gdp >= 0) {
    return { score: 40, signal: 'NEUTRAL', detail: `GDP growth ${gdp}% — below potential` };
  } else {
    return { score: 20, signal: 'SELL', detail: `GDP growth ${gdp}% — contraction` };
  }
}

function scoreInflation(countryData) {
  const inf = countryData.inflation;

  if (inf >= 1.0 && inf <= 3.0) {
    return { score: 80, signal: 'BUY', detail: `Inflation ${inf}% — optimal range` };
  } else if (inf >= 3.0 && inf <= 5.0) {
    return { score: 55, signal: 'NEUTRAL', detail: `Inflation ${inf}% — moderate, within central bank tolerance` };
  } else if (inf >= 5.0 && inf <= 8.0) {
    return { score: 35, signal: 'SELL', detail: `Inflation ${inf}% — elevated, margin pressure` };
  } else if (inf > 8.0) {
    return { score: 15, signal: 'SELL', detail: `Inflation ${inf}% — crisis level, aggressive tightening expected` };
  } else if (inf < 0) {
    return { score: 30, signal: 'SELL', detail: `Inflation ${inf}% — deflationary spiral risk` };
  }
  return { score: 45, signal: 'NEUTRAL', detail: `Inflation ${inf}% — monitor` };
}

function scoreCurrentAccount(countryData) {
  const ca = countryData.currentAccount;

  if (ca > 3.0) {
    return { score: 80, signal: 'BUY', detail: `Current account surplus ${ca}% of GDP — strong external position` };
  } else if (ca > 0) {
    return { score: 65, signal: 'NEUTRAL', detail: `Current account surplus ${ca}% of GDP — stable` };
  } else if (ca > -3.0) {
    return { score: 45, signal: 'NEUTRAL', detail: `Current account deficit ${Math.abs(ca)}% of GDP — manageable` };
  } else if (ca > -6.0) {
    return { score: 30, signal: 'SELL', detail: `Current account deficit ${Math.abs(ca)}% of GDP — currency pressure` };
  } else {
    return { score: 15, signal: 'SELL', detail: `Current account deficit ${Math.abs(ca)}% of GDP — severe imbalance` };
  }
}

function scorePoliticalRisk(countryData) {
  const risk = countryData.politicalRisk;

  if (risk < 20) {
    return { score: 85, signal: 'BUY', detail: `Political risk ${risk}/100 — very stable` };
  } else if (risk < 35) {
    return { score: 65, signal: 'NEUTRAL', detail: `Political risk ${risk}/100 — low` };
  } else if (risk < 50) {
    return { score: 45, signal: 'NEUTRAL', detail: `Political risk ${risk}/100 — moderate, monitor elections` };
  } else if (risk < 70) {
    return { score: 25, signal: 'SELL', detail: `Political risk ${risk}/100 — elevated, instability concerns` };
  } else {
    return { score: 10, signal: 'SELL', detail: `Political risk ${risk}/100 — critical, capital flight risk` };
  }
}

function scoreCreditRating(countryData) {
  const score = countryData.creditScore;
  const rating = countryData.creditRating;

  if (score >= 80) {
    return { score: 85, signal: 'BUY', detail: `Sovereign rating ${rating} — investment grade, safe haven` };
  } else if (score >= 60) {
    return { score: 65, signal: 'NEUTRAL', detail: `Sovereign rating ${rating} — upper investment grade` };
  } else if (score >= 40) {
    return { score: 45, signal: 'NEUTRAL', detail: `Sovereign rating ${rating} — lower investment grade` };
  } else if (score >= 20) {
    return { score: 25, signal: 'SELL', detail: `Sovereign rating ${rating} — speculative, high yield risk` };
  } else {
    return { score: 10, signal: 'SELL', detail: `Sovereign rating ${rating} — distressed, default risk` };
  }
}

function scorePMI(countryData) {
  const pmi = countryData.pmi;

  if (pmi >= 55) {
    return { score: 85, signal: 'BUY', detail: `PMI ${pmi} — strong expansion` };
  } else if (pmi >= 50) {
    return { score: 65, signal: 'NEUTRAL', detail: `PMI ${pmi} — expansion` };
  } else if (pmi >= 45) {
    return { score: 40, signal: 'NEUTRAL', detail: `PMI ${pmi} — contraction, monitor` };
  } else {
    return { score: 20, signal: 'SELL', detail: `PMI ${pmi} — recession territory` };
  }
}

// ─── Composite Macro Score ─────────────────────────────────────────────────
function getGrade(score) {
  if (score >= 85) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 75) return 'A-';
  if (score >= 70) return 'B+';
  if (score >= 65) return 'B';
  if (score >= 60) return 'B-';
  if (score >= 55) return 'C+';
  if (score >= 50) return 'C';
  if (score >= 45) return 'C-';
  if (score >= 40) return 'D+';
  if (score >= 35) return 'D';
  return 'F';
}

function getMacroScore(country) {
  const { data, meta } = getMacroBundle(country);

  const rateDiff = scoreInterestRateDifferential(data);
  const gdp = scoreGDPGrowth(data);
  const inflation = scoreInflation(data);
  const currentAcc = scoreCurrentAccount(data);
  const political = scorePoliticalRisk(data);
  const credit = scoreCreditRating(data);
  const pmiScore = scorePMI(data);

  const conditions = { rateDiff, gdp, inflation, currentAcc, political, credit, pmi: pmiScore };
  const rawScore = Object.values(conditions).reduce((sum, c) => sum + c.score, 0) / Object.values(conditions).length;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  // Count BUY/SELL signals
  const buyCount = Object.values(conditions).filter(c => c.signal === 'BUY').length;
  const sellCount = Object.values(conditions).filter(c => c.signal === 'SELL').length;

  let signal;
  if (buyCount >= 5) signal = 'Bullish';
  else if (buyCount >= 3) signal = 'Favorable';
  else if (sellCount >= 5) signal = 'Bearish';
  else if (sellCount >= 3) signal = 'Caution';
  else if (score >= 60) signal = 'Favorable';
  else if (score <= 40) signal = 'Caution';
  else signal = 'Neutral';

  return {
    score,
    grade: getGrade(score),
    signal,
    country: data.name,
    countryCode: country,
    summary: `${data.name}: ${buyCount} bullish / ${sellCount} bearish macro signals`,
    meta,
    conditions: {
      interestRateDifferential: rateDiff,
      gdpGrowth: gdp,
      inflation,
      currentAccount: currentAcc,
      politicalRisk: political,
      creditRating: credit,
      pmi: pmiScore,
    }
  };
}

// ─── Fetch macro data and merge with static reference ─────────────────────
// Returns { data, meta } — the curated record with live World Bank/IMF values
// merged over it, plus provenance so the UI can show the source and the year
// each figure is from.
async function refreshCountryData(country) {
  const base = COUNTRY_MACRO[country];
  if (!base) return null;

  const data = { ...base };
  const meta = {
    live: false,
    sources: [],
    asOf: {},
    referenceFields: [],
    fetchedAt: Date.now(),
  };

  const wbCode = worldBankCountry[country];
  const [gdp, inflation, currentAccount, interestRate] = wbCode
    ? await Promise.all([
        worldBankIndicator(wbCode, WB_FIELDS.gdpGrowth),
        worldBankIndicator(wbCode, WB_FIELDS.inflation),
        worldBankIndicator(wbCode, WB_FIELDS.currentAccount),
        worldBankIndicator(wbCode, WB_FIELDS.interestRate),
      ])
    : [null, null, null, null];

  // Stale official series (e.g. the US lending rate stops at 2021) are less
  // useful than the curated current figure, so only accept a value published
  // within the last two calendar years.
  const minYear = new Date().getFullYear() - 2;
  const liveConds = new Set();
  const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
  const apply = (field, condKey, res, dp) => {
    if (!res || res.value == null || !isFinite(res.value)) return;
    if (Number(res.year) < minYear) return;
    data[field] = round(res.value, dp);
    meta.asOf[field] = res.year;
    liveConds.add(condKey);
  };
  apply('gdpGrowth', 'gdpGrowth', gdp, 1);
  apply('inflation', 'inflation', inflation, 1);
  apply('currentAccount', 'currentAccount', currentAccount, 1);
  apply('interestRate', 'interestRateDifferential', interestRate, 2);

  if (liveConds.size > 0) {
    meta.sources.push('World Bank');
    meta.live = true;
  }

  // GDP cross-check: use the IMF when the World Bank has no recent value.
  if (!liveConds.has('gdpGrowth')) {
    const imf = await fetchIMFGrowth(country);
    if (imf && imf.value != null && isFinite(imf.value) && Number(imf.year) >= minYear) {
      data.gdpGrowth = round(imf.value, 1);
      meta.asOf.gdpGrowth = imf.year;
      liveConds.add('gdpGrowth');
      if (!meta.sources.includes('IMF')) meta.sources.push('IMF');
      meta.live = true;
    }
  }

  // Every scored condition that did not receive live data is a reference value.
  meta.referenceFields = ALL_CONDITION_KEYS.filter((k) => !liveConds.has(k));
  if (!meta.live) meta.sources.push('Reference estimate');
  return { data, meta };
}

async function refreshMacroData() {
  const countries = Object.keys(COUNTRY_MACRO);
  const results = await Promise.allSettled(countries.map((c) => refreshCountryData(c)));

  let live = 0;
  countries.forEach((c, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      liveMacro.set(c, r.value);
      if (r.value.meta.live) live += 1;
    }
  });
  console.log(`[macroService] live macro refreshed for ${live}/${countries.length} countries`);
  return { countries: countries.length, live };
}

let refreshTimer = null;
function startMacroRefresh() {
  refreshMacroData().catch((e) => console.warn('[macroService] initial refresh failed:', e.message));
  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      refreshMacroData().catch(() => {});
    }, CACHE_TTL);
    if (refreshTimer.unref) refreshTimer.unref();
  }
}

async function getMacroIndicators() {
  await refreshMacroData().catch(() => {});
  const countries = Object.keys(COUNTRY_MACRO);
  return {
    countries: Object.fromEntries(countries.map((c) => [c, getMacroBundle(c).data])),
    meta: Object.fromEntries(countries.map((c) => [c, getMacroBundle(c).meta])),
    scores: Object.fromEntries(countries.map((c) => [c, getMacroScore(c)])),
    timestamp: Date.now(),
  };
}

function getCachedIndicators() {
  const snapshot = {};
  for (const [country, val] of liveMacro.entries()) {
    snapshot[country] = val;
  }
  return snapshot;
}

// ─── Signal integration helpers ────────────────────────────────────────────
function generateMacroReason(macro) {
  if (!macro) return '';
  const reasons = [];
  const cond = macro.conditions;

  if (cond.gdpGrowth.signal === 'BUY') reasons.push(cond.gdpGrowth.detail);
  if (cond.gdpGrowth.signal === 'SELL') reasons.push(cond.gdpGrowth.detail);
  if (cond.inflation.signal === 'BUY') reasons.push(cond.inflation.detail);
  if (cond.inflation.signal === 'SELL') reasons.push(cond.inflation.detail);
  if (cond.pmi.signal === 'BUY') reasons.push(cond.pmi.detail);
  if (cond.pmi.signal === 'SELL') reasons.push(cond.pmi.detail);
  if (cond.interestRateDifferential.signal === 'BUY') reasons.push(cond.interestRateDifferential.detail);
  if (cond.interestRateDifferential.signal === 'SELL') reasons.push(cond.interestRateDifferential.detail);
  if (cond.creditRating.signal === 'BUY') reasons.push(cond.creditRating.detail);
  if (cond.creditRating.signal === 'SELL') reasons.push(cond.creditRating.detail);
  if (cond.politicalRisk.signal === 'SELL') reasons.push(cond.politicalRisk.detail);
  if (cond.currentAccount.signal === 'SELL') reasons.push(cond.currentAccount.detail);

  return reasons.length > 0 ? reasons.slice(0, 3).join('; ') + '.' : '';
}

module.exports = {
  getMacroScore,
  getMacroIndicators,
  getCachedIndicators,
  getCountryForSymbol,
  generateMacroReason,
  refreshMacroData,
  startMacroRefresh,
  COUNTRY_MACRO,
};
