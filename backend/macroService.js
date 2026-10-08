// Macro & Country-Level Conditions for the Signal Engine
// Sources: World Bank API, IMF API, OECD Data API (free) + static reference data

const { generic } = require('./apiClient');
const { NSE_SYMBOLS } = require('./stockData');
const cheerio = require('cheerio');

// ─── Country metadata ──────────────────────────────────────────────────────
// Names / currency / central bank only. Every numeric macro value comes from a
// live source (World Bank / IMF / CBK / BLS / Fed) — there is deliberately NO
// curated numeric fallback, so a country with no live data contributes nothing
// to the macro score instead of a stale estimate.
const COUNTRY_MACRO = {
  US: { name: 'United States', code: 'us', currency: 'USD', centralBank: 'Federal Reserve (Fed)' },
  KE: { name: 'Kenya', code: 'ke', currency: 'KES', centralBank: 'Central Bank of Kenya (CBK)' },
  EU: { name: 'Eurozone', code: 'eu', currency: 'EUR', centralBank: 'European Central Bank (ECB)' },
  JP: { name: 'Japan', code: 'jp', currency: 'JPY', centralBank: 'Bank of Japan (BoJ)' },
  UK: { name: 'United Kingdom', code: 'gb', currency: 'GBP', centralBank: 'Bank of England (BoE)' },
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
  // No live data yet — return metadata only, never a numeric estimate.
  const base = COUNTRY_MACRO[country] || COUNTRY_MACRO.US;
  return {
    data: { ...base },
    meta: { live: false, sources: [], asOf: {}, referenceFields: ALL_CONDITION_KEYS.slice(), fetchedAt: null },
  };
}

function getMacroData(country) {
  return getMacroBundle(country).data;
}

// ─── Cache ─────────────────────────────────────────────────────────────────
const cache = new Map();
// 1 hour: macro data moves monthly/quarterly, but a short TTL keeps the store
// at most ~1h behind a release so the next market-hours signal regeneration
// picks it up within the same session. Sources are keyless and cheap (CBK 2
// requests, World Bank ~4 per refresh), so the extra polling is negligible.
const CACHE_TTL = 60 * 60 * 1000;

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
// cross-check when the World Bank has no fresh value; CBK supplies Kenya's
// monthly CPI and policy rate; BLS/Fed supply the US CPI and policy rate.
// Refreshed on boot and every hour. There is NO curated numeric fallback:
// conditions without a live value are excluded from the score, and the three
// conditions with no free live source (PMI, sovereign credit rating, political
// risk) were removed entirely.
const worldBankCountry = { US: 'US', KE: 'KE', EU: 'XC', JP: 'JP', UK: 'GB' };
const imfCountry = { US: 'USA', KE: 'KEN', EU: 'EU', JP: 'JPN', UK: 'GBR' };

const WB_FIELDS = {
  gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  inflation: 'FP.CPI.TOTL.ZG',
  currentAccount: 'BN.CAB.XOKA.GD.ZS',
  interestRate: 'FR.INR.LEND',
};

// The condition keys that appear in `getMacroScore().conditions`. Only these
// have a live source. Political risk, sovereign credit rating and PMI were
// removed — they were hardcoded reference values, never live data.
const ALL_CONDITION_KEYS = ['interestRateDifferential', 'gdpGrowth', 'inflation', 'currentAccount'];

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

// ─── Central Bank of Kenya (live KE macro) ─────────────────────────────────
// CBK publishes monthly CPI inflation and the policy Central Bank Rate, which
// are far more current than the World Bank annual series. Both pages are plain
// HTML tables; parsed with cheerio and cached for CACHE_TTL.
const CBK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CBK_HOME_URL = 'https://www.centralbank.go.ke/';
const CBK_INFLATION_URL = 'https://www.centralbank.go.ke/inflation-rates/';

async function fetchCBKInflation() {
  const key = 'cbk_inflation';
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  try {
    const { data: html } = await generic.get(CBK_INFLATION_URL, {
      timeout: 20000,
      headers: { 'User-Agent': CBK_UA },
    });
    const $ = cheerio.load(html);
    let out = null;
    $('table').each((i, t) => {
      if (out) return;
      const header = $(t).find('tr').first().find('td,th')
        .map((k, c) => $(c).text().replace(/\s+/g, ' ').trim()).get().join(' ');
      if (!/12-Month Inflation/i.test(header)) return;
      // Scan for the first genuine data row (a 4-digit year with a numeric
      // 12-month figure) — the CBK table repeats its header across responsive
      // variants, so index-based row picks are unreliable.
      $(t).find('tr').each((j, r) => {
        if (out) return;
        const cells = $(r).find('td,th')
          .map((k, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
        if (cells.length < 4 || !/^\d{4}$/.test(cells[0])) return;
        const twelve = parseFloat(cells[3]);
        if (!isFinite(twelve) || twelve < -20 || twelve > 100) return;
        out = {
          twelveMonth: twelve,
          annualAverage: parseFloat(cells[2]) || null,
          year: cells[0],
          month: cells[1],
          period: `${cells[1]} ${cells[0]}`,
        };
      });
    });
    if (!out) return null;
    return cacheSet(key, out, CACHE_TTL);
  } catch { return null; }
}

async function fetchCBKKeyRates() {
  const key = 'cbk_key_rates';
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  try {
    const { data: html } = await generic.get(CBK_HOME_URL, {
      timeout: 20000,
      headers: { 'User-Agent': CBK_UA },
    });
    const $ = cheerio.load(html);
    const rates = {};
    $('table').each((i, t) => {
      const text = $(t).text();
      if (!/Central Bank Rate/.test(text) || !/Lending Rate/.test(text)) return;
      $(t).find('tr').each((j, r) => {
        const cells = $(r).find('td').map((k, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
        if (cells.length < 2) return;
        const label = cells[0];
        const val = String(cells[1]).match(/(-?\d+(?:\.\d+)?)\s*%?/);
        if (!label || !val) return;
        rates[label] = { value: parseFloat(val[1]), period: cells[2] || null };
      });
    });
    if (Object.keys(rates).length === 0) return null;
    return cacheSet(key, rates, CACHE_TTL);
  } catch { return null; }
}

// ─── United States: BLS CPI (monthly inflation) + NY Fed EFFR (policy rate) ─
// The US equivalent of the CBK source: the BLS monthly CPI gives the current
// 12-month inflation rate, and the New York Fed publishes the effective federal
// funds rate (EFFR) with its target range. Both are keyless.
const BLS_CPI_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const EFFR_URL = 'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json';
const BLS_MONTHS = { M01: 'Jan', M02: 'Feb', M03: 'Mar', M04: 'Apr', M05: 'May', M06: 'Jun', M07: 'Jul', M08: 'Aug', M09: 'Sep', M10: 'Oct', M11: 'Nov', M12: 'Dec' };

async function fetchUSInflationBLS() {
  const key = 'us_bls_cpi';
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  try {
    const year = new Date().getFullYear();
    const { data } = await generic.post(BLS_CPI_URL, {
      seriesid: ['CUUR0000SA0'], // CPI-U, all items, NSA
      startyear: String(year - 2),
      endyear: String(year),
    }, { timeout: 20000, headers: { 'Content-Type': 'application/json' } });
    const series = data?.Results?.series?.[0]?.data;
    if (!Array.isArray(series) || !series.length) return null;
    const byYM = {};
    for (const d of series) byYM[`${d.year}-${d.period}`] = parseFloat(d.value);
    const latest = series[0]; // BLS returns newest first
    const cur = byYM[`${latest.year}-${latest.period}`];
    const prev = byYM[`${Number(latest.year) - 1}-${latest.period}`];
    if (!isFinite(cur) || !isFinite(prev) || prev <= 0) return null;
    const month = BLS_MONTHS[latest.period] || latest.period;
    return cacheSet(key, { inflation: (cur / prev - 1) * 100, period: `${month} ${latest.year}` }, CACHE_TTL);
  } catch { return null; }
}

async function fetchUSPolicyRateFed() {
  const key = 'us_effr';
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  try {
    const { data } = await generic.get(EFFR_URL, { timeout: 20000 });
    const r = data?.refRates?.[0];
    const rate = Number(r?.percentRate);
    if (!r || !isFinite(rate)) return null;
    return cacheSet(key, {
      rate,
      targetFrom: r.targetRateFrom != null ? Number(r.targetRateFrom) : null,
      targetTo: r.targetRateTo != null ? Number(r.targetRateTo) : null,
      period: r.effectiveDate ? `as of ${r.effectiveDate}` : 'latest',
    }, CACHE_TTL);
  } catch { return null; }
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

// scorePoliticalRisk / scoreCreditRating / scorePMI removed: they scored
// hardcoded reference values, never live data. Macro is now built only from
// conditions with a live source (rate differential, GDP, inflation, current
// account).
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

  // Reference rate for the "vs Fed" differential is the live US policy rate. If
  // it is unavailable the differential condition is skipped rather than compared
  // against a hardcoded Fed rate.
  const usRate = getMacroBundle('US').data.interestRate;
  const referenceRate = (isFinite(usRate) && usRate > 0) ? usRate : null;

  // Only conditions with a live value are scored. Anything missing is excluded
  // from the average, never substituted with a reference estimate.
  const conditions = {};
  const add = (key, cond) => { if (cond) conditions[key] = cond; };
  if (isFinite(data.interestRate) && referenceRate != null) add('interestRateDifferential', scoreInterestRateDifferential(data, referenceRate));
  if (isFinite(data.gdpGrowth)) add('gdpGrowth', scoreGDPGrowth(data));
  if (isFinite(data.inflation)) add('inflation', scoreInflation(data));
  if (isFinite(data.currentAccount)) add('currentAccount', scoreCurrentAccount(data));

  const vals = Object.values(conditions);
  if (vals.length === 0) {
    // No live macro for this country — abstain at neutral, never a stale estimate.
    return {
      score: 50, grade: getGrade(50), signal: 'Neutral',
      country: data.name, countryCode: country,
      summary: `${data.name}: no live macro data`,
      meta: { ...meta, live: false, insufficientData: true },
      conditions: {},
    };
  }

  const rawScore = vals.reduce((sum, c) => sum + c.score, 0) / vals.length;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));
  const buyCount = vals.filter(c => c.signal === 'BUY').length;
  const sellCount = vals.filter(c => c.signal === 'SELL').length;

  let signal;
  if (buyCount >= 3) signal = 'Bullish';
  else if (buyCount >= 2) signal = 'Favorable';
  else if (sellCount >= 3) signal = 'Bearish';
  else if (sellCount >= 2) signal = 'Caution';
  else if (score >= 60) signal = 'Favorable';
  else if (score <= 40) signal = 'Caution';
  else signal = 'Neutral';

  return {
    score,
    grade: getGrade(score),
    signal,
    country: data.name,
    countryCode: country,
    summary: `${data.name}: ${buyCount} bullish / ${sellCount} bearish macro signals (${vals.length} live conditions)`,
    meta,
    conditions,
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

  // Kenya: the central bank publishes monthly CPI inflation and the policy CBK
  // Rate, both far more current than the annual World Bank series. Prefer them.
  if (country === 'KE') {
    const [cbkInfl, cbkRates] = await Promise.all([fetchCBKInflation(), fetchCBKKeyRates()]);
    const addCbkSource = (label) => { if (!meta.sources.includes(label)) meta.sources.push(label); };

    const infl = cbkInfl && isFinite(cbkInfl.twelveMonth)
      ? { value: cbkInfl.twelveMonth, period: cbkInfl.period }
      : cbkRates && cbkRates['Inflation Rate']
        ? { value: cbkRates['Inflation Rate'].value, period: cbkRates['Inflation Rate'].period }
        : null;
    if (infl && isFinite(infl.value)) {
      data.inflation = round(infl.value, 2);
      meta.asOf.inflation = infl.period || 'latest';
      liveConds.add('inflation');
      addCbkSource('CBK (KNBS CPI)');
      meta.live = true;
    }

    const cbr = cbkRates && cbkRates['Central Bank Rate'];
    if (cbr && isFinite(cbr.value)) {
      data.interestRate = round(cbr.value, 2);
      meta.asOf.interestRate = cbr.period || 'latest';
      liveConds.add('interestRateDifferential');
      addCbkSource('CBK');
      meta.live = true;
    }
  }

  // United States: BLS monthly CPI for inflation and the NY Fed EFFR for the
  // policy rate, replacing the annual World Bank series and the curated rate.
  if (country === 'US') {
    const addUsSource = (label) => { if (!meta.sources.includes(label)) meta.sources.push(label); };
    const [bls, effr] = await Promise.all([fetchUSInflationBLS(), fetchUSPolicyRateFed()]);
    if (bls && isFinite(bls.inflation)) {
      data.inflation = round(bls.inflation, 2);
      meta.asOf.inflation = bls.period;
      liveConds.add('inflation');
      addUsSource('BLS (CPI)');
      meta.live = true;
    }
    if (effr && isFinite(effr.rate)) {
      data.interestRate = round(effr.rate, 2);
      meta.asOf.interestRate = effr.period;
      liveConds.add('interestRateDifferential');
      addUsSource('NY Fed (EFFR)');
      meta.live = true;
    }
  }

  // Every scored condition that did not receive live data is a reference value.
  meta.referenceFields = ALL_CONDITION_KEYS.filter((k) => !liveConds.has(k));
  if (!meta.live) meta.sources.push('No live macro data');
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
  const cond = macro.conditions || {};
  const push = (c) => { if (c && (c.signal === 'BUY' || c.signal === 'SELL')) reasons.push(c.detail); };

  push(cond.gdpGrowth);
  push(cond.inflation);
  push(cond.interestRateDifferential);
  push(cond.currentAccount);

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
