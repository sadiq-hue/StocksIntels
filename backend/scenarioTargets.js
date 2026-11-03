// Scenario-based target construction.
//
// Targets are derived from market structure, volatility, momentum, catalysts
// and (for long horizons) valuation. They are never derived from the stop
// distance. The stop remains an independent downside policy; the target module
// only validates whether the resulting reward is worth the risk.

const { findResistanceLevels } = require('./technicalIndicators');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, digits = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const pathEfficiency = 1 / 3;

function buildScenarioTargets({
  entry,
  stop,
  priceHistory,
  atrPct,
  technical,
  fundamental,
  valuation,
  catalyst,
  horizon,
  regime,
  weeklyTrend,
}) {
  const e = num(entry);
  const s = num(stop);
  const atr = num(atrPct);
  if (!(e > 0) || !(s > 0) || s >= e) {
    return { available: false, reason: 'invalid entry/stop for target construction' };
  }
  const price = e;
  const atrValue = atr != null && atr > 0 ? e * atr : e * 0.02;
  const shortHorizon = horizon === 'short';
  const indicators = technical?.indicators || {};
  const technicalScore = num(technical?.score);
  const resistance = findResistanceLevels(priceHistory || [], price);
  const nearbyResistance = resistance.filter(v => v > price * 1.003);
  const volumeConfirmed = /surge|above average|high volume/i.test(String(indicators.volumeSignal || ''));
  const momentumPositive = /bullish|turning bullish|strong/i.test(String(indicators.macdSignal || '')) || /uptrend/i.test(String(indicators.trendSignal || ''));
  const weeklyBullish = weeklyTrend === 'bullish';
  const riskOn = !/bear|crash/i.test(String(regime || ''));
  const positiveCatalyst = catalyst?.direction === 'positive';
  const fair = valuation?.reliable && num(valuation.fairValue) > price ? valuation.fairValue : null;
  const bullValuation = valuation?.reliable && num(valuation.bull) > price ? valuation.bull : null;
  const evidence = [];

  // Minimum: the first credible objective above entry. Prefer the nearest
  // confirmed resistance; use a one-ATR volatility objective when no structure
  // is available. Never derive it from the stop.
  let minimum = nearbyResistance[0] || price + atrValue;
  if (minimum <= price * 1.003) minimum = price + atrValue;
  if (nearbyResistance[0]) evidence.push('nearest resistance');
  else evidence.push('volatility objective');

  // Base: the central objective. Short-term weights favour structure, ATR and
  // momentum; long-term weights admit valuation.
  const secondResistance = nearbyResistance[1] || null;
  const atrBase = price + atrValue * 2;
  let average;
  if (shortHorizon) {
    average = secondResistance
      ? secondResistance * 0.55 + atrBase * 0.35 + (fair ? fair * 0.10 : atrBase * 0.10)
      : atrBase;
    if (secondResistance) evidence.push('second resistance', 'ATR continuation');
    else evidence.push('ATR continuation');
  } else {
    const structure = secondResistance || nearbyResistance[0] || atrBase;
    const valuationWeight = fair ? 0.55 : 0;
    const structureWeight = fair ? 0.25 : 0.65;
    const atrWeight = fair ? 0.20 : 0.35;
    average = structure * structureWeight + atrBase * atrWeight + (fair || 0) * valuationWeight;
    if (fair) evidence.push('fair-value base');
    if (secondResistance || nearbyResistance[0]) evidence.push('technical structure');
    evidence.push('ATR continuation');
  }
  if (!(average > minimum)) average = Math.max(minimum + atrValue * 0.5, average || 0);

  // Extended: only publish when there is credible supporting evidence. A bare
  // ATR multiple is not enough by itself.
  const thirdResistance = nearbyResistance[2] || nearbyResistance[1] || null;
  const atrExtended = price + atrValue * 3;
  const extendedEvidence = nearbyResistance.length >= 2 || (technicalScore != null && technicalScore >= 60 && volumeConfirmed) || positiveCatalyst || Boolean(bullValuation);
  let extended = null;
  if (extendedEvidence) {
    extended = thirdResistance ? Math.max(thirdResistance, atrExtended) : atrExtended;
    if (bullValuation) extended = Math.max(extended, bullValuation);
    if (extended <= average) extended = average + atrValue;
    evidence.push('bull-case evidence');
  }

  // Probability weights: technical evidence, volatility, volume, regime and
  // catalysts tilt the distribution; they are normalised, never forced equal.
  let baseWeight = shortHorizon ? 0.50 : 0.45;
  if (technicalScore != null && technicalScore >= 60) baseWeight += 0.05;
  if (momentumPositive) baseWeight += 0.03;
  if (volumeConfirmed) baseWeight += 0.03;
  if (weeklyBullish) baseWeight += 0.02;
  if (riskOn) baseWeight += 0.02;
  if (positiveCatalyst) baseWeight += 0.03;
  baseWeight = clamp(baseWeight, 0.30, 0.72);
  let minWeight = shortHorizon ? 0.28 : 0.22;
  let extWeight = extended != null ? Math.max(0.10, 1 - baseWeight - minWeight) : 0;
  if (extended == null) {
    minWeight = clamp(1 - baseWeight, 0.15, 0.70);
    extWeight = 0;
  }
  const total = baseWeight + minWeight + extWeight;
  const probabilities = {
    minimum: round(minWeight / total, 3),
    average: round(baseWeight / total, 3),
    extended: round(extWeight / total, 3),
  };

  const expected = extended != null
    ? minimum * probabilities.minimum + average * probabilities.average + extended * probabilities.extended
    : minimum * probabilities.minimum + average * probabilities.average;
  const risk = e - s;
  const reward = average - e;
  const rewardRisk = risk > 0 ? reward / risk : null;
  const averageDistance = Math.max(0, average - e);
  const targetDays = atrValue > 0 ? Math.ceil(averageDistance / (atrValue * pathEfficiency)) : null;
  const feasible = targetDays == null || (shortHorizon ? targetDays <= 90 : targetDays <= 365);
  if (!feasible) evidence.push('target exceeds holding window');

  if (!(minimum > e) || !(average > minimum)) {
    return { available: false, reason: 'insufficient credible price structure for a target', evidence, probabilities };
  }

  return {
    available: true,
    method: 'scenario',
    minimum: round(minimum),
    average: round(average),
    extended: extended != null ? round(extended) : null,
    expected: round(expected),
    probabilities,
    rewardRiskAverage: round(rewardRisk),
    targetDays,
    feasible,
    evidence,
    assumptions: {
      volatility: atr != null ? round(atr * 100) : null,
      resistanceLevels: nearbyResistance.slice(0, 4).map(round),
      valuationUsed: fair != null,
      catalyst: catalyst?.type || null,
      regime: regime || null,
    },
  };
}

module.exports = { buildScenarioTargets };
