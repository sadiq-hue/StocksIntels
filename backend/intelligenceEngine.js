// Cross-factor intelligence and hybrid valuation/risk layer.
//
// This module does not replace the existing analytical scorers. It normalises
// the evidence they produce, checks relationships between factors, builds a
// forward-looking valuation/scenario matrix, and exposes the execution rules
// used by the hybrid short-term / long-term output.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, digits = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const pct = (v) => (num(v) == null ? null : v / 100);

function buildAdvancedFundamentals(stock = {}) {
  const marketCap = num(stock.marketCap);
  const price = num(stock.price);
  const pb = num(stock.pbRatio);
  const de = num(stock.debtToEquity);
  const revenue = num(stock.revenue);
  const netIncome = num(stock.netIncome);
  const ebitda = num(stock.ebitda);
  const fcfYield = pct(num(stock.fcfYield));
  const equity = marketCap != null && pb != null && pb > 0 ? marketCap / pb : null;
  const debt = equity != null && de != null ? equity * de : num(stock.totalDebt);
  const cash = num(stock.cash) || 0;
  const assets = equity != null && debt != null ? equity + debt : null;
  const fcf = marketCap != null && fcfYield != null ? marketCap * fcfYield : null;
  const invested = equity != null && debt != null ? equity + debt - cash : null;
  const nopat = ebitda != null ? ebitda * 0.8 * 0.79 : netIncome != null ? netIncome * 0.79 : null;
  return {
    roe: num(stock.roe),
    roa: assets && netIncome != null ? round((netIncome / assets) * 100) : null,
    roic: invested && invested > 0 && nopat != null ? round((nopat / invested) * 100) : null,
    assetTurnover: assets && assets > 0 && revenue != null ? round(revenue / assets) : null,
    cashConversion: fcf != null && netIncome != null && netIncome > 0 ? round(fcf / netIncome) : null,
    grossMargin: num(stock.grossMargin),
    operatingMargin: num(stock.operatingMargin),
    profitMargin: num(stock.profitMargin),
    revenueGrowth: num(stock.revenueGrowth),
    epsGrowth: num(stock.epsGrowth),
    debtToEquity: de,
    currentRatio: num(stock.currentRatio),
    altmanZ: num(stock.altmanZ),
    fcfYield: num(stock.fcfYield),
    netDebt: equity != null && debt != null ? round(debt - cash) : null,
    marketCap,
    price,
    sharesOutstanding: marketCap && price ? round(marketCap / price, 0) : null,
    totalAssets: assets != null ? round(assets, 0) : null,
  };
}

function assessDataIntegrity(stock = {}, fundamental = {}, technical = {}, valuation = null) {
  const flags = [];
  const pe = num(stock.peRatio);
  const fcfYield = num(stock.fcfYield);
  const ev = num(stock.evEbitda);
  const rev = num(stock.revenueGrowth);
  const eps = num(stock.epsGrowth);
  const de = num(stock.debtToEquity);
  const cr = num(stock.currentRatio);
  const roe = num(stock.roe);
  const z = num(stock.altmanZ);
  if (pe != null && pe > 0 && pe < 2) flags.push(`P/E ${pe} is implausibly low — verify EPS/one-off items`);
  if (pe != null && pe > 200) flags.push(`P/E ${pe} is extreme — verify earnings base`);
  if (fcfYield != null && fcfYield > 40) flags.push(`FCF yield ${fcfYield}% is extreme — verify cash flow/denominator`);
  if (ev != null && ev > 0 && ev < 2) flags.push(`EV/EBITDA ${ev} is implausibly low — verify EBITDA/net debt`);
  if (rev != null && (rev > 500 || rev < -90)) flags.push(`Revenue growth ${rev}% is outside a plausible range`);
  if (eps != null && (eps > 1000 || eps < -1000)) flags.push(`EPS growth ${eps}% is outside a plausible range`);
  if (de != null && (de < 0 || de > 10)) flags.push(`D/E ${de} is outside a plausible range`);
  if (cr != null && cr > 20) flags.push(`Current ratio ${cr} is extreme — verify current assets/liabilities`);
  if (roe != null && Math.abs(roe) > 200) flags.push(`ROE ${roe}% is extreme — verify equity base`);
  if (z != null && z < 0) flags.push(`Altman Z ${z} is negative — verify balance-sheet inputs`);
  const fundamentalScore = num(fundamental?.score);
  const technicalScore = num(technical?.score);
  if (fundamentalScore == null || technicalScore == null) flags.push('Missing analytical sub-score');
  if (valuation?.reliable === false) flags.push('Valuation inputs insufficient for a reliable DCF');
  return {
    ok: flags.length === 0,
    severity: flags.length >= 3 ? 'high' : flags.length > 0 ? 'watch' : 'none',
    flags,
  };
}

function dcfValue({ fcf, growth, wacc, terminalGrowth, years, sharesOutstanding, netDebt }) {
  if (!(fcf > 0) || !(wacc > terminalGrowth + 0.01) || !(sharesOutstanding > 0)) return null;
  let cashFlow = fcf;
  let presentValue = 0;
  for (let year = 1; year <= years; year++) {
    const fade = (year - 1) / Math.max(1, years - 1);
    const g = growth + (terminalGrowth - growth) * fade;
    cashFlow *= 1 + g;
    presentValue += cashFlow / (1 + wacc) ** year;
  }
  const terminalValue = (cashFlow * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  presentValue += terminalValue / (1 + wacc) ** years;
  return (presentValue - (netDebt || 0)) / sharesOutstanding;
}

function computeValuation({ stock = {}, currentPrice, sectorValuation = null, advanced = null }) {
  const price = num(currentPrice);
  const marketCap = num(stock.marketCap);
  const shares = advanced?.sharesOutstanding || (marketCap && price ? marketCap / price : null);
  const fcfYield = pct(num(stock.fcfYield));
  const netIncome = num(stock.netIncome);
  const ebitda = num(stock.ebitda);
  const netDebt = advanced?.netDebt != null ? advanced.netDebt : (num(stock.totalDebt) || 0) - (num(stock.cash) || 0);
  const fcf = marketCap != null && fcfYield != null ? marketCap * fcfYield : null;
  const fallbackFcf = fcf > 0 ? fcf : netIncome > 0 ? netIncome * 0.8 : ebitda > 0 ? ebitda * 0.45 : null;
  const rawGrowth = pct(num(stock.revenueGrowth));
  const growth = clamp(rawGrowth == null ? 0.05 : rawGrowth, -0.05, 0.20);
  const beta = 1.1;
  const riskFree = 0.06;
  const equityRiskPremium = 0.055;
  const costEquity = riskFree + beta * equityRiskPremium;
  const costDebt = 0.08;
  const taxRate = 0.21;
  const debt = Math.max(0, num(stock.totalDebt) || 0);
  const equity = marketCap || 1;
  const equityWeight = equity / (equity + debt);
  let wacc = equityWeight * costEquity + (1 - equityWeight) * costDebt * (1 - taxRate);
  wacc = clamp(wacc, 0.08, 0.16);
  const terminalGrowth = 0.025;
  const fairFromDcf = fallbackFcf && shares
    ? dcfValue({ fcf: fallbackFcf, growth, wacc, terminalGrowth, years: 5, sharesOutstanding: shares, netDebt })
    : null;
  const relativeFair = sectorValuation && num(sectorValuation.value) > 0 && num(sectorValuation.benchmark) > 0
    ? price * (sectorValuation.benchmark / sectorValuation.value)
    : null;
  const cap = (v) => v == null ? null : clamp(v, price * 0.4, price * 3);
  const dcf = cap(fairFromDcf);
  const relative = cap(relativeFair);
  const reliable = dcf != null || relative != null;
  let fairValue = null;
  if (dcf != null && relative != null) fairValue = dcf * 0.6 + relative * 0.4;
  else fairValue = dcf != null ? dcf : relative;
  fairValue = cap(fairValue);

  const scenario = (fcfFactor, growthDelta, waccDelta) => {
    const v = fallbackFcf && shares
      ? dcfValue({
        fcf: fallbackFcf * fcfFactor,
        growth: clamp(growth + growthDelta, -0.10, 0.30),
        wacc: clamp(wacc + waccDelta, 0.08, 0.20),
        terminalGrowth,
        years: 5,
        sharesOutstanding: shares,
        netDebt,
      })
      : null;
    return cap(v);
  };
  const bear = scenario(0.7, -0.04, 0.015) || (fairValue != null ? cap(fairValue * 0.78) : null);
  const base = fairValue;
  const bull = scenario(1.2, 0.04, -0.005) || (fairValue != null ? cap(fairValue * 1.25) : null);
  const probabilities = { bear: 0.25, base: 0.5, bull: 0.25 };
  const expected = bear != null && base != null && bull != null
    ? bear * probabilities.bear + base * probabilities.base + bull * probabilities.bull
    : fairValue;

  return {
    reliable,
    fairValue: round(fairValue),
    dcf: round(dcf),
    relative: round(relative),
    bear: round(bear),
    base: round(base),
    bull: round(bull),
    expected: round(expected),
    wacc: round(wacc * 100),
    growth: round(growth * 100),
    terminalGrowth: terminalGrowth * 100,
    probabilities,
    assumptions: {
      method: dcf != null && relative != null ? 'DCF + sector-relative blend' : dcf != null ? 'DCF' : 'sector-relative',
      forecastYears: 5,
      netDebt: round(netDebt),
      fcf: round(fallbackFcf),
    },
  };
}

function analyzeNewsMateriality(news = []) {
  const list = Array.isArray(news) ? news : [];
  const materialPattern = /earnings|guidance|revenue|profit|contract|merger|acquisition|investigation|regulat|recall|fda|approval|dividend|buyback|offering|fraud|ceo|cfo/i;
  const seen = new Set();
  let duplicates = 0;
  let positive = 0;
  let negative = 0;
  let material = 0;
  const sources = new Set();
  for (const item of list) {
    const headline = String(item?.headline || item?.title || '').trim();
    if (!headline) continue;
    const key = headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    if (item?.source || item?.sourceDomain) sources.add(String(item.source || item.sourceDomain));
    if (item?.sentiment === 'positive') positive++;
    else if (item?.sentiment === 'negative') negative++;
    if (materialPattern.test(`${headline} ${item?.excerpt || item?.summary || ''}`)) material++;
  }
  return {
    articleCount: list.length,
    uniqueStories: seen.size,
    duplicates,
    sourceCount: sources.size,
    materialEvents: material,
    positive,
    negative,
    conflict: positive > 0 && negative > 0,
    materiality: material >= 3 ? 'high' : material >= 1 ? 'medium' : 'low',
  };
}

function analyzeCrossFactors({ stock = {}, fundamental = {}, technical = {}, financial = {}, newsSent = null, insider = null, sectorValuation = null, valuation = null, advanced = null, news = [] }) {
  const f = num(fundamental.score);
  const t = num(technical.score);
  const fin = num(financial.score);
  const rev = num(stock.revenueGrowth);
  const contradictions = [];
  const confirmations = [];
  if (f != null && t != null) {
    if (f >= 55 && t < 45) contradictions.push('Strong fundamentals but weak technical structure');
    else if (f < 40 && t >= 60) contradictions.push('Technical strength without fundamental support');
    else if (f >= 55 && t >= 55) confirmations.push('Fundamental and technical evidence agree');
  }
  if (rev != null && rev < 0 && sectorValuation?.label === 'cheap') {
    contradictions.push('Cheap valuation alongside declining revenue — value-trap risk');
  }
  if (rev != null && rev > 20 && sectorValuation?.label === 'expensive') {
    confirmations.push('Premium valuation supported by high growth — verify durability');
  }
  if (insider && insider.netShares != null) {
    if (insider.netShares < 0 && f != null && f >= 55) contradictions.push('Insiders are net sellers while the fundamental score is strong');
    if (insider.netShares > 0 && f != null && f < 40) contradictions.push('Insider buying against weak fundamentals');
  }
  if (newsSent === 'positive' && f != null && f < 40) contradictions.push('Positive news sentiment against weak fundamentals');
  if (newsSent === 'negative' && f != null && f >= 55) contradictions.push('Negative news sentiment against strong fundamentals');
  if (valuation?.fairValue != null && valuation.reliable) {
    const price = num(stock.price);
    if (price != null && valuation.fairValue < price * 0.85) contradictions.push('Valuation is materially below the current price');
    if (price != null && valuation.fairValue > price * 1.2) confirmations.push('Valuation offers meaningful upside to fair value');
  }
  if (advanced?.roic != null && advanced.roic < 5 && rev != null && rev < 0) {
    contradictions.push('Low return on invested capital with shrinking revenue');
  }
  const dataIntegrity = assessDataIntegrity(stock, fundamental, technical, valuation);
  const newsMateriality = analyzeNewsMateriality(news);
  if (newsMateriality.conflict && Math.abs(newsMateriality.positive - newsMateriality.negative) <= 1) {
    contradictions.push('Conflicting positive and negative news coverage');
  }
  const severe = contradictions.filter(Boolean).length;
  const confidenceDelta = clamp(
    (confirmations.length > 0 ? 2 : 0) -
    (severe >= 2 ? 8 : severe === 1 ? 4 : 0) -
    (dataIntegrity.severity === 'high' ? 5 : dataIntegrity.severity === 'watch' ? 2 : 0) -
    (newsMateriality.conflict ? 1 : 0),
    -12,
    3
  );
  return {
    contradictions,
    confirmations,
    dataIntegrity,
    newsMateriality,
    riskLevel: severe >= 2 || dataIntegrity.severity === 'high' ? 'high' : severe === 1 || dataIntegrity.severity === 'watch' ? 'medium' : 'low',
    confidenceDelta,
    summary: contradictions.length
      ? contradictions.join(' · ')
      : confirmations.length
        ? confirmations.join(' · ')
        : 'No material cross-factor conflict detected',
  };
}

function computeHybridRisk({ entry, stop, valuation = null, horizon = null, atrPct = null }) {
  const e = num(entry);
  const s = num(stop);
  const risk = e != null && s != null ? e - s : null;
  const target = num(valuation?.base) ?? num(valuation?.fairValue);
  const reward = e != null && target != null ? target - e : null;
  const rr = risk > 0 && reward != null ? reward / risk : null;
  const atrMultiplier = num(atrPct) != null ? (atrPct >= 0.05 ? 3 : 2) : null;
  return {
    riskPerShare: round(risk),
    analystTarget: round(target),
    rewardPerShare: round(reward),
    riskReward: round(rr),
    atrMultiplier,
    shortTermEligible: horizon === 'short' && rr != null ? rr >= 3 : null,
    rule: horizon === 'short' ? 'short-term alerts require hybrid R:R ≥ 3.0' : 'long-term target uses base fair value',
  };
}

function buildSegmentViews({ horizon, valuation, hybrid, advanced, technical }) {
  return {
    shortTerm: {
      focus: ['technical structure', 'volume confirmation', 'near-term catalysts', 'liquidity'],
      hybridRiskReward: hybrid?.riskReward ?? null,
      eligible: hybrid?.shortTermEligible ?? null,
      atrMultiplier: hybrid?.atrMultiplier ?? null,
      targetUse: 'bull scenario as profit-taking reference',
      relevance: horizon === 'short' ? 'primary' : 'not primary',
    },
    longTerm: {
      focus: ['ROIC', 'cash conversion', 'fair value', 'scenario range'],
      fairValue: valuation?.fairValue ?? null,
      bear: valuation?.bear ?? null,
      base: valuation?.base ?? null,
      bull: valuation?.bull ?? null,
      wacc: valuation?.wacc ?? null,
      growth: valuation?.growth ?? null,
      roic: advanced?.roic ?? null,
      cashConversion: advanced?.cashConversion ?? null,
      relevance: horizon === 'long' ? 'primary' : 'not primary',
    },
  };
}

module.exports = {
  buildAdvancedFundamentals,
  assessDataIntegrity,
  computeValuation,
  analyzeCrossFactors,
  computeHybridRisk,
  buildSegmentViews,
};
