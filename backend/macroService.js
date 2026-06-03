// Macro & Country-Level Conditions for the Signal Engine
// Sources: World Bank API, IMF API, OECD Data API (free) + static reference data

const { generic } = require('./apiClient');

// ─── Static Reference Data (used when APIs are unavailable) ────────────────
const COUNTRY_MACRO = {
  US: {
    name: 'United States',
    code: 'us',
    currency: 'USD',
    centralBank: 'Federal Reserve (Fed)',
    interestRate: 4.50,
    gdpGrowth: 2.5,
    inflation: 3.0,
    currentAccount: -3.2,
    politicalRisk: 15,
    creditRating: 'AA+',
    creditScore: 90,
    pmi: 52.0,
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
  const sym = symbol.toUpperCase();
  const NSE_SYMBOLS = ['SCOM','EQTY','KCB','EABL','BAMB','ABSA','SBIC','KPLC','NMG','CRAY','KLG','OLYM','UMEM','TOTL','STAN','COOP','JUB','KNRE','LKL','CIC','HFCK','IMH'];
  if (NSE_SYMBOLS.includes(sym)) return 'KE';
  return 'US';
}

function getMacroData(country) {
  return COUNTRY_MACRO[country] || COUNTRY_MACRO.US;
}

// ─── Cache ─────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
  return data;
}

// ─── World Bank API ────────────────────────────────────────────────────────
async function worldBankIndicator(countryCode, indicator) {
  const key = `wb_${countryCode}_${indicator}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const { data } = await generic.get(
      `https://api.worldbank.org/v2/country/${countryCode}/indicator/${indicator}?format=json&per_page=5&mrnev=1`,
      { timeout: 10000 }
    );
    if (data && data[1] && data[1].length > 0) {
      const vals = data[1].filter(d => d.value != null).map(d => ({ date: d.date, value: parseFloat(d.value) }));
      if (vals.length > 0) return cacheSet(key, vals, CACHE_TTL);
    }
  } catch (err) {
    /* silently fall back to static data */
  }
  return null;
}

async function fetchWorldBank(countryCode) {
  const [cpi, gdp, interest] = await Promise.all([
    worldBankIndicator(countryCode, 'FP.CPI.TOTL.ZG'),
    worldBankIndicator(countryCode, 'NY.GDP.MKTP.KD.ZG'),
    worldBankIndicator(countryCode, 'FR.INR.LEND'),
  ]);

  return {
    cpiGrowth: cpi?.[0]?.value ?? null,
    gdpGrowth: gdp?.[0]?.value ?? null,
    lendingRate: interest?.[0]?.value ?? null,
  };
}

// ─── IMF API ───────────────────────────────────────────────────────────────
async function fetchIMF(countryCode) {
  const key = `imf_${countryCode}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const imfCode = { KE: 'KEN', US: 'USA', EU: 'EU', JP: 'JPN', UK: 'GBR' }[countryCode];
  if (!imfCode) return null;

  try {
    const { data } = await generic.get(
      `https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/${imfCode}`,
      { timeout: 10000 }
    );
    if (data?.values?.[imfCode]) {
      const years = Object.keys(data.values[imfCode]).sort();
      return cacheSet(key, {
        gdpGrowth: years.length > 0 ? data.values[imfCode][years[years.length - 1]] : null,
        lastYear: years.length > 0 ? years[years.length - 1] : null,
      }, CACHE_TTL);
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
  const data = getMacroData(country);

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
async function refreshCountryData(country) {
  const staticData = { ...COUNTRY_MACRO[country] };
  if (!staticData) return null;

  const wbCode = { KE: 'KE', US: 'US', EU: 'EU', JP: 'JP', UK: 'GB' }[country];

  const [wb, imf] = await Promise.allSettled([
    wbCode ? fetchWorldBank(wbCode) : Promise.resolve(null),
    fetchIMF(country),
  ]);

  const wbData = wb.status === 'fulfilled' ? wb.value : null;
  const imfData = imf.status === 'fulfilled' ? imf.value : null;

  if (wbData?.gdpGrowth != null) staticData.gdpGrowth = wbData.gdpGrowth;
  if (wbData?.cpiGrowth != null) staticData.inflation = wbData.cpiGrowth;
  if (wbData?.lendingRate != null) staticData.interestRate = wbData.lendingRate;
  if (imfData?.gdpGrowth != null) staticData.gdpGrowth = imfData.gdpGrowth;

  return staticData;
}

async function getMacroIndicators() {
  const countries = Object.keys(COUNTRY_MACRO);
  const results = await Promise.allSettled(countries.map(c => refreshCountryData(c)));

  const enriched = {};
  countries.forEach((c, i) => {
    enriched[c] = results[i].status === 'fulfilled' && results[i].value
      ? results[i].value
      : COUNTRY_MACRO[c];
  });

  return {
    countries: enriched,
    scores: Object.fromEntries(
      Object.keys(enriched).map(c => [c, getMacroScore(c)])
    ),
    timestamp: Date.now(),
  };
}

function getCachedIndicators() {
  const snapshot = {};
  for (const [key, val] of cache.entries()) {
    snapshot[key] = val.data;
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
  COUNTRY_MACRO,
};
