// Analysis engine — pure scoring, grading, and signal determination functions.
// All functions are stateless and take all required data as parameters.
const { SECTOR_AVG_PE, INDUSTRY_MEDIAN_EV_EBITDA, TBILI_RATE } = require('./stockData');
const { calculateRSI, calculateEMASeries, calculateMACD, calculateBollingerBands, calculateSMA } = require('./technicalIndicators');
const engineConfig = require('./engineConfig');

function getScoring(path, fallback) {
  const cfg = engineConfig.getConfig().scoring;
  const parts = path.split('.');
  let val = cfg;
  for (const p of parts) {
    if (val == null || typeof val !== 'object') return fallback;
    val = val[p];
  }
  return val != null ? val : fallback;
}

function getEffectiveSectorPE(dynamicSectorPE, sector) {
  if (dynamicSectorPE && dynamicSectorPE[sector]) return dynamicSectorPE[sector];
  return SECTOR_AVG_PE[sector] || 18;
}

function getGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  if (score >= 50) return 'C-';
  if (score >= 45) return 'D+';
  if (score >= 40) return 'D';
  return 'F';
}

function determineSignal(overallScore) {
  if (overallScore >= 68) return { signal: 'Strong Buy', action: 'buy', strength: 'strong' };
  if (overallScore >= 60) return { signal: 'Buy', action: 'buy', strength: 'moderate' };
  if (overallScore >= 50) return { signal: 'Accumulate', action: 'buy', strength: 'weak' };
  if (overallScore >= 40) return { signal: 'Hold', action: 'hold', strength: 'neutral' };
  if (overallScore >= 30) return { signal: 'Reduce', action: 'sell', strength: 'weak' };
  if (overallScore >= 18) return { signal: 'Sell', action: 'sell', strength: 'moderate' };
  return { signal: 'Strong Sell', action: 'sell', strength: 'strong' };
}

function determineTradeType(technicalScore, fundamentalScore) {
  const tt = getScoring('trade_type', {});
  const abTech = tt.aggressive_buy_tech_min ?? 65;
  const abFund = tt.aggressive_buy_fund_min ?? 65;
  const mtTech = tt.momentum_tech_min ?? 65;
  const mtFundMax = tt.momentum_fund_max ?? 50;
  const stTech = tt.swing_tech_min ?? 65;
  const ltvFund = tt.long_term_value_fund_min ?? 65;
  const ltvTechMax = tt.long_term_value_tech_max ?? 50;
  const ltFund = tt.long_term_fund_min ?? 65;
  const swTech = tt.swing_min_tech ?? 50;
  const swFund = tt.swing_min_fund ?? 50;

  if (technicalScore >= abTech && fundamentalScore >= abFund) {
    return 'Aggressive Buy';
  }
  if (technicalScore >= mtTech && fundamentalScore < mtFundMax) {
    return 'Momentum Trade';
  }
  if (technicalScore >= stTech) {
    return 'Swing Trade';
  }
  if (fundamentalScore >= ltvFund && technicalScore < ltvTechMax) {
    return 'Long Term Value';
  }
  if (fundamentalScore >= ltFund) {
    return 'Long Term';
  }
  if (technicalScore >= swTech || fundamentalScore >= swFund) {
    return 'Swing Trade';
  }
  return 'Avoid';
}

function getSectorMacroAdjustment(sector, country, baseMacroScore) {
  const adj = { delta: 0, reasons: [] };
  if (!sector) return adj;
  const s = sector.toLowerCase();
  if (['banking', 'financial', 'insurance', 'real estate'].some(k => s.includes(k))) {
    if (baseMacroScore >= 70) { adj.delta += 5; adj.reasons.push('Rate-sensitive sector benefiting from stable macro'); }
    else if (baseMacroScore < 40) { adj.delta -= 8; adj.reasons.push('Rate-sensitive sector pressured by weak macro'); }
  }
  if (['healthcare', 'utilities', 'telecommunications', 'consumer staples', 'agricultural'].some(k => s.includes(k))) {
    if (baseMacroScore < 40) { adj.delta += 8; adj.reasons.push('Defensive sector resilient in weak macro'); }
    if (baseMacroScore >= 70) { adj.delta -= 3; adj.reasons.push('Defensive sector lags in strong macro'); }
  }
  if (['technology', 'semiconductors', 'software', 'manufacturing', 'automobiles', 'construction', 'materials', 'energy'].some(k => s.includes(k))) {
    if (baseMacroScore >= 70) { adj.delta += 5; adj.reasons.push('Cyclical sector amplified by strong macro'); }
    else if (baseMacroScore < 40) { adj.delta -= 5; adj.reasons.push('Cyclical sector amplified by weak macro'); }
  }
  return adj;
}

function analyzeFundamentals(stock, currentPrice, overrideNewsSentiment = null, dynamicSectorPE = null) {
  if (!stock) return { score: 40, metrics: {}, fundamentalGrade: 'D', suppressed: false };
  const FUND_BASELINE = getScoring('fundamentals.baseline', 40);
  const FUND_CAP = getScoring('fundamentals.cap', 25);
  const dq = getScoring('fundamentals.data_quality', { very_sparse: -14, sparse: -8, partial: -3 });
  const peCfg = getScoring('fundamentals.pe', { discount_mult: 20, discount_cap: 12, premium_mult: -10, premium_cap: -8 });
  const evCfg = getScoring('fundamentals.ev_ebitda', { good_delta: 10, median_fallback: 12 });
  const pbCfg = getScoring('fundamentals.pb', { low_threshold: 1.0, low_delta: 15, high_threshold: 5, high_delta: -5 });
  const altmanCfg = getScoring('fundamentals.altman_z', { distress_threshold: 1.81, suppressed_cap: 40 });

  let score = FUND_BASELINE;
  const metrics = {};
  let suppressed = false;

  // Data completeness penalty — penalize stocks with sparse fundamental data
  const dataPoints = [stock.peRatio, stock.evEbitda, stock.pbRatio, stock.dividendYield,
    stock.revenueGrowth, stock.epsSurprise, stock.marginChange,
    stock.fcfYield, stock.debtToEquity, stock.currentRatio,
    stock.roe, stock.altmanZ].filter(d => d != null && d !== '').length;
  if (dataPoints < 4) { score += (dq.very_sparse || -14); metrics.dataQuality = 'Very sparse data'; }
  else if (dataPoints < 7) { score += (dq.sparse || -8); metrics.dataQuality = 'Sparse data'; }
  else if (dataPoints < 10) { score += (dq.partial || -3); metrics.dataQuality = 'Partial data'; }
  else { metrics.dataQuality = 'Rich data'; }

  if (stock.peRatio > 0) {
    const sectorAvg = getEffectiveSectorPE(dynamicSectorPE, stock.sector);
    const peRatio = stock.peRatio / sectorAvg;
    if (peRatio < 0.7) {
      const discount = 1 - peRatio;
      const cappedScore = Math.round(Math.min(discount * (peCfg.discount_mult || 20), peCfg.discount_cap || 12));
      score += cappedScore;
      metrics.peSignal = 'BUY';
      metrics.peRating = `P/E ${stock.peRatio} is ${Math.round(discount * 100)}% below sector avg ${sectorAvg}`;
    } else if (peRatio > 1.8) {
      const premium = peRatio - 1;
      const cappedScore = Math.round(Math.min(premium * (peCfg.premium_mult || 20), peCfg.premium_cap || 8));
      score -= cappedScore;
      metrics.peSignal = 'SELL';
      metrics.peRating = `P/E ${stock.peRatio} is ${Math.round(premium * 100)}% above sector avg ${sectorAvg}`;
    } else {
      metrics.peSignal = 'NEUTRAL';
      metrics.peRating = `P/E ${stock.peRatio} in line with sector avg ${sectorAvg}`;
    }
  }

  if (stock.evEbitda > 0) {
    const median = INDUSTRY_MEDIAN_EV_EBITDA[stock.sector] || (evCfg.median_fallback || 12);
    if (stock.evEbitda < median) {
      score += (evCfg.good_delta || 10);
      metrics.evSignal = 'BUY';
      metrics.evRating = `EV/EBITDA ${stock.evEbitda} below industry median ${median}`;
    } else {
      metrics.evSignal = 'NEUTRAL';
      metrics.evRating = `EV/EBITDA ${stock.evEbitda} at or above median ${median}`;
    }
  }

  if (stock.pbRatio > 0 && stock.pbRatio < (pbCfg.low_threshold || 1.0) && stock.roe > 0) {
    score += (pbCfg.low_delta || 15);
    metrics.pbSignal = 'BUY';
    metrics.pbRating = `Deep value: P/B ${stock.pbRatio} < ${pbCfg.low_threshold || 1.0} with positive ROE ${stock.roe}%`;
  } else if (stock.pbRatio > (pbCfg.high_threshold || 5)) {
    score += (pbCfg.high_delta || -5);
    metrics.pbSignal = 'NEUTRAL';
    metrics.pbRating = `P/B ${stock.pbRatio} elevated`;
  }

  if (stock.dividendYield > 0) {
    const tbillThreshold = TBILI_RATE * 100 * 2;
    if (stock.dividendYield > tbillThreshold && (stock.payoutRatio < 80 || stock.payoutRatio === 0)) {
      score += 10;
      metrics.divSignal = 'BUY';
      metrics.divRating = `Income BUY: yield ${stock.dividendYield}% > 2x T-bill rate, payout ${stock.payoutRatio}%`;
    } else if (stock.dividendYield > TBILI_RATE * 100) {
      score += 5;
      metrics.divSignal = 'NEUTRAL';
      metrics.divRating = `Dividend ${stock.dividendYield}% above T-bill rate`;
    } else {
      metrics.divSignal = 'NEUTRAL';
      metrics.divRating = `Dividend yield ${stock.dividendYield}%`;
    }
  } else if (stock.dividendYield === 0) {
    metrics.divSignal = 'NEUTRAL';
    metrics.divRating = 'No dividend';
  }

  const revCfg = getScoring('fundamentals.revenue', { strong_threshold: 15, strong_delta: 12, moderate_threshold: 10, moderate_delta: 8, slight_threshold: 5, slight_delta: 3, decline_delta: -5 });
  if (stock.revenueGrowth > revCfg.strong_threshold) {
    score += revCfg.strong_delta;
    metrics.revSignal = 'BUY';
    metrics.revRating = `Strong revenue growth ${stock.revenueGrowth}% > ${revCfg.strong_threshold}%`;
  } else if (stock.revenueGrowth > revCfg.moderate_threshold) {
    score += revCfg.moderate_delta;
    metrics.revSignal = 'BUY';
    metrics.revRating = `Moderate revenue growth ${stock.revenueGrowth}%`;
  } else if (stock.revenueGrowth > revCfg.slight_threshold) {
    score += revCfg.slight_delta;
    metrics.revSignal = 'NEUTRAL';
    metrics.revRating = `Moderate revenue growth ${stock.revenueGrowth}%`;
  } else if (stock.revenueGrowth < 0) {
    score += revCfg.decline_delta;
    metrics.revSignal = 'SELL';
    metrics.revRating = `Declining revenue ${stock.revenueGrowth}%`;
  } else {
    metrics.revSignal = 'NEUTRAL';
    metrics.revRating = `Revenue growth ${stock.revenueGrowth}%`;
  }

  const epsCfg = getScoring('fundamentals.eps', { beat_threshold: 10, beat_delta: 10, miss_threshold: -10, miss_delta: -10, slight_beat_delta: 3 });
  if (stock.epsSurprise == null) {
    metrics.epsSignal = 'NEUTRAL';
    metrics.epsRating = 'No analyst estimates available';
  } else if (stock.epsSurprise > epsCfg.beat_threshold) {
    score += epsCfg.beat_delta;
    metrics.epsSignal = 'BUY';
    metrics.epsRating = `Earnings beat estimates by ${stock.epsSurprise}% - momentum`;
  } else if (stock.epsSurprise < epsCfg.miss_threshold) {
    score += epsCfg.miss_delta;
    metrics.epsSignal = 'SELL';
    metrics.epsRating = `Earnings miss by ${stock.epsSurprise}%`;
  } else if (stock.epsSurprise > 0) {
    score += epsCfg.slight_beat_delta;
    metrics.epsSignal = 'NEUTRAL';
    metrics.epsRating = `Positive earnings surprise ${stock.epsSurprise}%`;
  } else {
    metrics.epsSignal = 'NEUTRAL';
    metrics.epsRating = stock.epsSurprise !== 0 ? `EPS surprise ${stock.epsSurprise}%` : 'EPS in line';
  }

  const mgnCfg = getScoring('fundamentals.margin', { expansion_threshold: 2, expansion_delta: 10, contraction_threshold: -3, contraction_delta: -5, slight_expansion_delta: 3 });
  if (stock.marginChange > mgnCfg.expansion_threshold) {
    score += mgnCfg.expansion_delta;
    metrics.mgnSignal = 'BUY';
    metrics.mgnRating = `Margin expanded ${stock.marginChange}pp YoY - efficiency gain`;
  } else if (stock.marginChange < mgnCfg.contraction_threshold) {
    score += mgnCfg.contraction_delta;
    metrics.mgnSignal = 'WATCH';
    metrics.mgnRating = `Margin contracted ${stock.marginChange}pp YoY - caution`;
  } else if (stock.marginChange > 0) {
    score += mgnCfg.slight_expansion_delta;
    metrics.mgnSignal = 'NEUTRAL';
    metrics.mgnRating = `Margin improved ${stock.marginChange}pp YoY`;
  } else {
    metrics.mgnSignal = 'NEUTRAL';
    metrics.mgnRating = stock.marginChange !== 0 ? `Margin -${Math.abs(stock.marginChange)}pp YoY` : 'Margin stable';
  }

  const fcfCfg = getScoring('fundamentals.fcf', { strong_threshold: 5, strong_delta: 10, positive_delta: 3, negative_delta: -8 });
  if (stock.fcfYield > fcfCfg.strong_threshold) {
    score += fcfCfg.strong_delta;
    metrics.fcfSignal = 'BUY';
    metrics.fcfRating = `Strong FCF yield ${stock.fcfYield}% > ${fcfCfg.strong_threshold}%`;
  } else if (stock.fcfYield > 0) {
    score += fcfCfg.positive_delta;
    metrics.fcfSignal = 'NEUTRAL';
    metrics.fcfRating = `FCF yield ${stock.fcfYield}%`;
  } else if (stock.fcfYield < 0) {
    score += fcfCfg.negative_delta;
    metrics.fcfSignal = 'SELL';
    metrics.fcfRating = `Negative FCF yield ${stock.fcfYield}%`;
  }

  const deCfg = getScoring('fundamentals.de', { low_threshold: 0.5, low_delta: 8, high_threshold: 3.0, high_delta: -8, moderate_threshold: 1.0, moderate_delta: 3 });
  if (stock.debtToEquity != null && stock.debtToEquity < deCfg.low_threshold) {
    score += deCfg.low_delta;
    metrics.deSignal = 'BUY';
    metrics.debtRating = `Low leverage D/E ${stock.debtToEquity} < ${deCfg.low_threshold}`;
  } else if (stock.debtToEquity != null && stock.debtToEquity > deCfg.high_threshold) {
    score += deCfg.high_delta;
    metrics.deSignal = 'SELL';
    metrics.debtRating = `High debt risk D/E ${stock.debtToEquity} > ${deCfg.high_threshold}`;
  } else if (stock.debtToEquity != null && stock.debtToEquity < deCfg.moderate_threshold) {
    score += deCfg.moderate_delta;
    metrics.deSignal = 'NEUTRAL';
    metrics.debtRating = `Manageable debt D/E ${stock.debtToEquity}`;
  } else {
    metrics.deSignal = 'NEUTRAL';
    metrics.debtRating = stock.debtToEquity != null ? `Elevated debt D/E ${stock.debtToEquity}` : 'No debt data';
  }

  const crCfg = getScoring('fundamentals.cr', { healthy_threshold: 1.5, healthy_delta: 5, low_threshold: 1.0, low_delta: -5 });
  if (stock.currentRatio != null && stock.currentRatio > crCfg.healthy_threshold) {
    score += crCfg.healthy_delta;
    metrics.crSignal = 'BUY';
    metrics.crRating = `Healthy liquidity CR ${stock.currentRatio} > ${crCfg.healthy_threshold}`;
  } else if (stock.currentRatio != null && stock.currentRatio < crCfg.low_threshold) {
    score += crCfg.low_delta;
    metrics.crSignal = 'WATCH';
    metrics.crRating = `Low liquidity CR ${stock.currentRatio} < ${crCfg.low_threshold}`;
  } else {
    metrics.crSignal = 'NEUTRAL';
    metrics.crRating = stock.currentRatio != null ? `Current ratio ${stock.currentRatio}` : 'No liquidity data';
  }

  const roeCfg = getScoring('fundamentals.roe', { good_threshold: 15, good_delta: 8, poor_threshold: 5, poor_delta: -5 });
  if (stock.roe != null && stock.roe > roeCfg.good_threshold) {
    score += roeCfg.good_delta;
    metrics.roeSignal = 'BUY';
    metrics.roeRating = `Strong ROE ${stock.roe}% > ${roeCfg.good_threshold}%`;
  } else if (stock.roe != null && stock.roe < roeCfg.poor_threshold) {
    score += roeCfg.poor_delta;
    metrics.roeSignal = 'SELL';
    metrics.roeRating = `Weak ROE ${stock.roe}% < ${roeCfg.poor_threshold}%`;
  } else {
    metrics.roeSignal = 'NEUTRAL';
    metrics.roeRating = stock.roe != null ? `ROE ${stock.roe}%` : 'No ROE data';
  }

  if (stock.altmanZ != null && stock.altmanZ < (altmanCfg.distress_threshold || 1.81)) {
    suppressed = true;
    metrics.altSignal = 'SUPPRESS';
    metrics.altRating = `Altman Z ${stock.altmanZ} < ${altmanCfg.distress_threshold || 1.81} - financial distress - BUY suppressed`;
  } else if (stock.altmanZ > (altmanCfg.safe_zone_threshold || 3.0)) {
    score += (altmanCfg.safe_zone_delta || 5);
    metrics.altSignal = 'NEUTRAL';
    metrics.altRating = `Altman Z ${stock.altmanZ} > ${altmanCfg.safe_zone_threshold || 3.0} - safe zone`;
  } else {
    metrics.altSignal = 'NEUTRAL';
    metrics.altRating = `Altman Z ${stock.altmanZ} - grey zone`;
  }

  const newsCfg = getScoring('fundamentals.news_sentiment', { positive_delta: 5, negative_delta: -5 });
  const newsSent = overrideNewsSentiment || stock.newsSentiment;
  if (newsSent === 'positive') {
    score += newsCfg.positive_delta;
    metrics.newsSignal = 'BUY';
    metrics.newsRating = 'Positive news sentiment';
  } else if (newsSent === 'negative') {
    score += newsCfg.negative_delta;
    metrics.newsSignal = 'SELL';
    metrics.newsRating = 'Negative news sentiment';
  } else {
    metrics.newsSignal = 'NEUTRAL';
    metrics.newsRating = 'Neutral news sentiment';
  }

  // Cap net additive bonus at ±cap from fundamental baseline
  score = Math.min(score, FUND_BASELINE + FUND_CAP);
  score = Math.max(score, FUND_BASELINE - FUND_CAP);

  if (suppressed) {
    score = Math.min(score, 50);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, metrics, fundamentalGrade: getGrade(score), suppressed };
}

function analyzeTechnicals(symbol, currentPrice, priceHistory = null, volume = null, indicatorParams = null) {
  const ip = indicatorParams || {};
  const rsiPeriod = ip.rsi_period || 14;
  const macdFast = ip.macd_fast || 12;
  const macdSlow = ip.macd_slow || 26;
  const macdSignal = ip.macd_signal || 9;
  const bbPeriod = ip.bb_period || 20;
  const bbStdDev = ip.bb_std_dev || 2.0;
  const smaTrendFast = ip.sma_trend_fast || 20;
  const smaTrendSlow = ip.sma_trend_slow || 50;
  const volLookback = ip.vol_lookback || 10;

  // Scoring deltas from config
  const TECH_BASELINE = getScoring('technicals.baseline', 50);
  const TECH_CAP = getScoring('technicals.cap', 25);
  const dq = getScoring('technicals.data_quality', { insufficient_bars: 20, insufficient_delta: -12, limited_bars: 50, limited_delta: -5 });
  const rsiCfg = getScoring('technicals.rsi', { oversold: 15, approaching_oversold: 5, overbought: -5, approaching_overbought: -3 });
  const macdCfg = getScoring('technicals.macd', { bullish: 15, turning_bullish: 5, bearish: -15, turning_bearish: -5 });
  const trendCfg = getScoring('technicals.trend', { golden_cross: 20, death_cross: -15, strong_uptrend: 15, uptrend: 5, strong_downtrend: -10, downtrend: -3 });
  const bbCfg = getScoring('technicals.bb', { near_lower: 10, near_upper: -10, below_middle: 3 });
  const volCfg = getScoring('technicals.volume', { surge_2x: 10, above_avg: 5, below_avg: -3 });
  const momCfg = getScoring('technicals.momentum', { strong_positive: 15, positive: 10, slight_positive: 5, strong_negative: -10, negative: -5, slight_negative: -3 });

  let score = TECH_BASELINE;
  const indicators = {};
  const totalBars = priceHistory ? priceHistory.length : 0;
  indicators.dataPoints = totalBars;

  // Penalize insufficient price history
  const insuffBars = dq.insufficient_bars || 20;
  const limitedBars = dq.limited_bars || 50;
  if (totalBars < insuffBars) { score += (dq.insufficient_delta || -12); indicators.dataQuality = 'Insufficient history'; }
  else if (totalBars < limitedBars) { score += (dq.limited_delta || -5); indicators.dataQuality = 'Limited history'; }
  else { indicators.dataQuality = 'Adequate history'; }

  if (!priceHistory || totalBars < 2) {
    indicators.rsiSignal = 'No Data';
    indicators.macdSignal = 'No Data';
    indicators.trendSignal = 'No Data';
    indicators.bbSignal = 'No Data';
    indicators.volume = 'No Data';
    indicators.volumeSignal = 'No Data';
    indicators.momentum = '0.0%';
    indicators.momentumSignal = 'No Data';
    indicators.note = 'Technical analysis skipped — no real price history available';
    return { score, indicators, technicalGrade: getGrade(score) };
  }

  if (totalBars >= rsiPeriod + 1) {
    const rsi = calculateRSI(priceHistory, rsiPeriod);
    indicators.rsi = rsi.toFixed(1);
    if (rsi < 30) {
      score += (rsiCfg.oversold || 15);
      indicators.rsiSignal = 'Oversold - Bullish';
    } else if (rsi < 40) {
      score += (rsiCfg.approaching_oversold || 5);
      indicators.rsiSignal = 'Approaching Oversold';
    } else if (rsi > 75) {
      score += (rsiCfg.overbought || -5);
      indicators.rsiSignal = 'Overbought - Bearish';
    } else if (rsi > 60) {
      score += (rsiCfg.approaching_overbought || -3);
      indicators.rsiSignal = 'Approaching Overbought';
    } else {
      indicators.rsiSignal = 'Neutral';
    }
  } else {
    indicators.rsi = 'N/A';
    indicators.rsiSignal = 'Insufficient Data';
  }

  if (totalBars >= macdSlow + macdSignal) {
    const macd = calculateMACD(priceHistory, macdFast, macdSlow, macdSignal);
    indicators.macd = macd.macd.toFixed(3);
    if (macd.histogram > 0 && macd.macd > 0) {
      score += (macdCfg.bullish || 15);
      indicators.macdSignal = 'Bullish';
    } else if (macd.histogram > 0) {
      score += (macdCfg.turning_bullish || 5);
      indicators.macdSignal = 'Turning Bullish';
    } else if (macd.histogram < 0 && macd.macd < 0) {
      score += (macdCfg.bearish || -15);
      indicators.macdSignal = 'Bearish';
    } else if (macd.histogram < 0) {
      score += (macdCfg.turning_bearish || -5);
      indicators.macdSignal = 'Turning Bearish';
    } else {
      indicators.macdSignal = 'Neutral';
    }
  } else {
    indicators.macd = 'N/A';
    indicators.macdSignal = 'Insufficient Data';
  }

  if (totalBars >= smaTrendSlow + 1) {
    const smaFastVal = calculateSMA(priceHistory, smaTrendFast);
    const smaSlowVal = calculateSMA(priceHistory, smaTrendSlow);
    const prevSmaFast = calculateSMA(priceHistory.slice(0, -1), smaTrendFast);
    const prevSmaSlow = calculateSMA(priceHistory.slice(0, -1), smaTrendSlow);
    indicators.smaFastPeriod = smaTrendFast;
    indicators.smaSlowPeriod = smaTrendSlow;
    indicators.smaFast = smaFastVal.toFixed(2);
    indicators.smaSlow = smaSlowVal.toFixed(2);

    const goldenCross = prevSmaFast <= prevSmaSlow && smaFastVal > smaSlowVal;
    const deathCross = prevSmaFast >= prevSmaSlow && smaFastVal < smaSlowVal;
    indicators.goldenCross = goldenCross;
    indicators.deathCross = deathCross;

    if (goldenCross) {
      score += (trendCfg.golden_cross || 20);
      indicators.trendSignal = 'Golden Cross - Strong Bullish';
    } else if (deathCross) {
      score += (trendCfg.death_cross || -15);
      indicators.trendSignal = 'Death Cross - Strong Bearish';
    } else if (currentPrice > smaFastVal && smaFastVal > smaSlowVal) {
      score += (trendCfg.strong_uptrend || 15);
      indicators.trendSignal = 'Strong Uptrend';
    } else if (currentPrice > smaFastVal) {
      score += (trendCfg.uptrend || 5);
      indicators.trendSignal = 'Uptrend';
    } else if (currentPrice < smaSlowVal && smaFastVal < smaSlowVal) {
      score += (trendCfg.strong_downtrend || -10);
      indicators.trendSignal = 'Strong Downtrend';
    } else if (currentPrice < smaFastVal) {
      score += (trendCfg.downtrend || -3);
      indicators.trendSignal = 'Downtrend';
    } else {
      indicators.trendSignal = 'Sideways';
    }
  } else if (totalBars >= smaTrendFast) {
    const smaFastVal = calculateSMA(priceHistory, smaTrendFast);
    indicators.smaFast = smaFastVal.toFixed(2);
    indicators.smaSlow = 'N/A';
    if (currentPrice > smaFastVal) {
      score += (trendCfg.uptrend || 5);
      indicators.trendSignal = `Above ${smaTrendFast}-day SMA`;
    } else {
      score += (trendCfg.downtrend || -3);
      indicators.trendSignal = `Below ${smaTrendFast}-day SMA`;
    }
  } else {
    indicators.smaFast = 'N/A';
    indicators.smaSlow = 'N/A';
    indicators.trendSignal = 'Insufficient Data';
  }

  if (totalBars >= bbPeriod) {
    const bb = calculateBollingerBands(priceHistory, bbPeriod, bbStdDev);
    indicators.bbUpper = bb.upper.toFixed(2);
    indicators.bbLower = bb.lower.toFixed(2);
    if (currentPrice <= bb.lower) {
      score += (bbCfg.near_lower || 10);
      indicators.bbSignal = 'Near Lower Band - Potential Reversal';
    } else if (currentPrice >= bb.upper) {
      score += (bbCfg.near_upper || -10);
      indicators.bbSignal = 'Near Upper Band - Potential Pullback';
    } else if (currentPrice <= bb.middle) {
      score += (bbCfg.below_middle || 3);
      indicators.bbSignal = 'Below Middle Band';
    } else {
      indicators.bbSignal = 'Above Middle Band';
    }
  } else {
    indicators.bbUpper = 'N/A';
    indicators.bbLower = 'N/A';
    indicators.bbSignal = 'Insufficient Data';
  }

  if (volume != null) {
    const formattedVolume = volume >= 1000000 ? (volume / 1000000).toFixed(1) + 'M' : (volume / 1000).toFixed(1) + 'K';
    indicators.volume = formattedVolume;
    if (priceHistory.volumes && priceHistory.volumes.length >= volLookback) {
      const avgVolume = priceHistory.volumes.slice(-volLookback).reduce((a, b) => a + b, 0) / volLookback;
      const volRatio = avgVolume > 0 ? volume / avgVolume : 1;
      indicators.avgVolume = avgVolume >= 1000000 ? (avgVolume / 1000000).toFixed(1) + 'M' : (avgVolume / 1000).toFixed(1) + 'K';
      indicators.volRatio = volRatio.toFixed(1);
      if (volRatio > 2) {
        score += (volCfg.surge_2x || 10);
        indicators.volumeSignal = 'Unusual Volume Surge (>2x avg)';
      } else if (volRatio > 1.5) {
        score += (volCfg.above_avg || 5);
        indicators.volumeSignal = 'Above Average Volume';
      } else if (volRatio < 0.5) {
        score += (volCfg.below_avg || -3);
        indicators.volumeSignal = 'Below Average Volume';
      } else {
        indicators.volumeSignal = 'Average Volume';
      }
    } else {
      indicators.volumeSignal = 'No Historical Baseline';
    }
  } else {
    indicators.volume = 'N/A';
    indicators.avgVolume = 'N/A';
    indicators.volumeSignal = 'No Data';
  }

  const priceChange = ((currentPrice - priceHistory[0]) / priceHistory[0]) * 100;
  indicators.momentum = priceChange.toFixed(1) + '%';
  if (priceChange > 20) {
    score += (momCfg.strong_positive || 15);
    indicators.momentumSignal = 'Strong Positive';
  } else if (priceChange > 10) {
    score += (momCfg.positive || 10);
    indicators.momentumSignal = 'Positive';
  } else if (priceChange > 5) {
    score += (momCfg.slight_positive || 5);
    indicators.momentumSignal = 'Slight Positive';
  } else if (priceChange < -20) {
    score += (momCfg.strong_negative || -10);
    indicators.momentumSignal = 'Strong Negative';
  } else if (priceChange < -10) {
    score += (momCfg.negative || -5);
    indicators.momentumSignal = 'Negative';
  } else if (priceChange < -5) {
    score += (momCfg.slight_negative || -3);
    indicators.momentumSignal = 'Slight Negative';
  } else {
    indicators.momentumSignal = 'Neutral';
  }

  // Cap net additive bonus at ±cap from technical baseline
  score = Math.min(score, TECH_BASELINE + TECH_CAP);
  score = Math.max(score, TECH_BASELINE - TECH_CAP);
  score = Math.max(0, Math.min(100, score));

  return { score, indicators, technicalGrade: getGrade(score) };
}

function analyzeFinancials(stock, fundamentalResult = null) {
  const finCfg = getScoring('financials', {});
  const fBaseline = finCfg.baseline ?? 50;
  const fCap = finCfg.cap ?? 25;
  const deCfg = finCfg.de || {};
  const crCfg = finCfg.cr || {};
  const roeCfg = finCfg.roe || {};

  if (!stock) return { score: fBaseline, analysis: {}, financialGrade: 'C' };

  let score = fBaseline;
  const analysis = {};

  let strengthScore = 0;
  if (stock.debtToEquity != null && stock.debtToEquity < (deCfg.low_threshold || 0.5)) strengthScore += (deCfg.low_delta || 2);
  else if (stock.debtToEquity != null && stock.debtToEquity > (deCfg.high_threshold || 3.0)) strengthScore += (deCfg.high_delta || -2);
  if (stock.currentRatio != null && stock.currentRatio > (crCfg.good_threshold || 2.0)) strengthScore += (crCfg.good_delta || 2);
  else if (stock.currentRatio != null && stock.currentRatio < (crCfg.poor_threshold || 0.8)) strengthScore += (crCfg.poor_delta || -2);
  if (stock.altmanZ != null && stock.altmanZ > 3.5) strengthScore += 2;
  else if (stock.altmanZ != null && stock.altmanZ < 1.5) strengthScore -= 3;
  if (stock.roe != null && stock.roe > (roeCfg.good_threshold || 20)) strengthScore += (roeCfg.good_delta || 2);
  else if (stock.roe != null && stock.roe < (roeCfg.poor_threshold || 3)) strengthScore += (roeCfg.poor_delta || -1);

  // Penalize sparse financial data
  const finDataCount = [stock.debtToEquity, stock.currentRatio, stock.altmanZ, stock.roe].filter(d => d != null).length;
  if (finDataCount < 2) { score += (finCfg.sparse_penalty || -8); analysis.financialHealth = 'Limited financial data'; }

  if (strengthScore >= 4) {
    score += 15;
    analysis.financialHealth = 'Excellent financial strength';
  } else if (strengthScore >= 2) {
    score += 8;
    analysis.financialHealth = 'Good financial strength';
  } else if (strengthScore <= -2) {
    score += (finCfg.weak_strength_delta || -12);
    analysis.financialHealth = 'Weak financial strength';
  } else if (strengthScore <= -4) {
    score += (finCfg.poor_strength_delta || -20);
    analysis.financialHealth = 'Poor financial strength - high risk';
  } else {
    analysis.financialHealth = 'Adequate financial strength';
  }

  let buySignals = 0;
  let sellSignals = 0;
  if (fundamentalResult && fundamentalResult.metrics) {
    const m = fundamentalResult.metrics;
    if (m.peSignal === 'BUY') buySignals++; else if (m.peSignal === 'SELL') sellSignals++;
    if (m.evSignal === 'BUY') buySignals++;
    if (m.pbSignal === 'BUY') buySignals++;
    if (m.divSignal === 'BUY') buySignals++;
    if (m.revSignal === 'BUY') buySignals++; else if (m.revSignal === 'SELL') sellSignals++;
    if (m.epsSignal === 'BUY') buySignals++; else if (m.epsSignal === 'SELL') sellSignals++;
    if (m.mgnSignal === 'BUY') buySignals++; else if (m.mgnSignal === 'SELL' || m.mgnSignal === 'WATCH') sellSignals++;
    if (m.fcfSignal === 'BUY') buySignals++; else if (m.fcfSignal === 'SELL') sellSignals++;
    if (m.deSignal === 'BUY') buySignals++; else if (m.deSignal === 'SELL') sellSignals++;
    if (m.crSignal === 'BUY') buySignals++; else if (m.crSignal === 'WATCH') sellSignals++;
    if (m.roeSignal === 'BUY') buySignals++; else if (m.roeSignal === 'SELL') sellSignals++;
  }
  const totalSignals = buySignals + sellSignals;
  if (totalSignals >= 3) {
    const agreementRatio = buySignals / totalSignals;
    if (agreementRatio >= 0.7) {
      score += 10;
      analysis.signalConsistency = 'Strong agreement across metrics';
    } else if (agreementRatio <= 0.3) {
      score += (finCfg.bearish_consistency_delta || -10);
      analysis.signalConsistency = 'Predominantly bearish signals';
    } else {
      analysis.signalConsistency = 'Mixed signals';
    }
  } else {
    analysis.signalConsistency = 'Limited signal data';
  }

  // Cap net additive bonus at ±cap from financial baseline
  score = Math.min(score, fBaseline + fCap);
  score = Math.max(score, fBaseline - fCap);

  if (stock.altmanZ != null && stock.altmanZ < 1.81) {
    score = Math.min(score, 40);
    analysis.financialHealth = 'FINANCIAL DISTRESS - BUY suppressed';
  }

  score = Math.max(0, Math.min(100, score));

  return { score, analysis, financialGrade: getGrade(score) };
}

function generateReason(symbol, fundamental, technical, financial, signal, macroReason = '') {
  const reasons = [];
  const m = fundamental.metrics || {};

  if (m.peSignal === 'BUY') reasons.push(m.peRating);
  else if (m.peSignal === 'SELL') reasons.push(m.peRating);
  if (m.evSignal === 'BUY') reasons.push(m.evRating);
  if (m.pbSignal === 'BUY') reasons.push(m.pbRating);

  if (m.revSignal === 'BUY') reasons.push(m.revRating);
  else if (m.revSignal === 'SELL') reasons.push(m.revRating);
  if (m.epsSignal === 'BUY') reasons.push(m.epsRating);
  if (m.mgnSignal === 'BUY') reasons.push(m.mgnRating);
  else if (m.mgnSignal === 'WATCH') reasons.push(m.mgnRating);
  if (m.fcfSignal === 'BUY') reasons.push(m.fcfRating);

  if (m.deSignal === 'BUY') reasons.push(m.debtRating);
  else if (m.deSignal === 'SELL') reasons.push(m.debtRating);
  if (m.roeSignal === 'BUY') reasons.push(m.roeRating);

  if (m.altSignal === 'SUPPRESS') reasons.push(m.altRating);

  if (m.newsSignal === 'BUY') reasons.push(m.newsRating);
  else if (m.newsSignal === 'SELL') reasons.push(m.newsRating);

  if (technical.score >= 75) {
    reasons.push('bullish technical setup');
    if (technical.indicators.rsiSignal && technical.indicators.rsiSignal.includes('Oversold')) {
      reasons.push('oversold conditions');
    }
    if (technical.indicators.macdSignal && technical.indicators.macdSignal.includes('Bullish')) {
      reasons.push('positive MACD momentum');
    }
  } else if (technical.score <= 40) {
    reasons.push('bearish technical indicators');
    if (technical.indicators.rsiSignal && technical.indicators.rsiSignal.includes('Overbought')) {
      reasons.push('overbought conditions');
    }
  }

  if (signal.signal === 'Strong Buy') {
    reasons.push('high conviction setup');
  } else if (signal.signal === 'Strong Sell') {
    reasons.push('significant downside risks');
  }

  if (macroReason) {
    reasons.push(`Macro: ${macroReason}`);
  }

  return reasons.length > 0 ? reasons.join(', ') + '.' : 'Based on comprehensive analysis of fundamental, technical, and financial factors.';
}

// Extract raw indicator values for ML model consumption
function extractIndicatorFeatures(technicalResult) {
  if (!technicalResult || !technicalResult.indicators) {
    return { rsi: 50, macdHist: 0, bollingerPctB: 0.5, smaRatio: 1, volRatio: 1, momentum: 0, goldenCross: false, deathCross: false };
  }
  const ind = technicalResult.indicators;
  const bbLow = parseFloat(ind.bbLower) || 0;
  const bbHigh = parseFloat(ind.bbUpper) || 1;
  const bbMid = (bbLow + bbHigh) / 2;
  const bollingerPctB = (bbHigh - bbLow) > 0 ? Math.max(0, Math.min(1, (parseFloat(ind.sma20) - bbLow) / (bbHigh - bbLow))) : 0.5;
  const sma20 = parseFloat(ind.sma20) || 0;
  const sma50 = parseFloat(ind.sma50) || 1;
  return {
    rsi: parseFloat(ind.rsi) || 50,
    macdHist: parseFloat(ind.macd) || 0,
    bollingerPctB,
    smaRatio: sma50 > 0 ? sma20 / sma50 : 1,
    volRatio: parseFloat(ind.volRatio) || 1,
    momentum: parseFloat(ind.momentum) || 0,
    goldenCross: ind.goldenCross || false,
    deathCross: ind.deathCross || false,
  };
}

// Extract fundamental feature values for ML model
function extractFundamentalFeatures(fundamentalResult) {
  if (!fundamentalResult || !fundamentalResult.metrics) {
    return { peRatio: 18, revenueGrowth: 0, debtToEquity: 0.5, roe: 10, fcfYield: 0, dataQuality: 0 };
  }
  const m = fundamentalResult.metrics;
  const peMatch = m.peRating ? m.peRating.match(/P\/E ([\d.]+)/) : null;
  const revMatch = m.revRating ? m.revRating.match(/growth ([\d.]+)/) : null;
  return {
    peRatio: peMatch ? parseFloat(peMatch[1]) : 18,
    revenueGrowth: revMatch ? parseFloat(revMatch[1]) : 0,
    debtToEquity: m.debtRating ? (m.debtRating.includes('Low') ? 0.3 : m.debtRating.includes('High') ? 2.0 : 0.8) : 0.5,
    roe: m.roeRating ? (m.roeRating.includes('Strong') ? 20 : m.roeRating.includes('Weak') ? 3 : 10) : 10,
    fcfYield: m.fcfRating ? (m.fcfRating.includes('Strong') ? 8 : 2) : 0,
    dataQuality: fundamentalResult.metrics.dataQuality === 'Rich data' ? 1 : fundamentalResult.metrics.dataQuality === 'Partial data' ? 0.5 : 0,
  };
}

module.exports = {
  getEffectiveSectorPE,
  getGrade,
  determineSignal,
  determineTradeType,
  getSectorMacroAdjustment,
  analyzeFundamentals,
  analyzeTechnicals,
  analyzeFinancials,
  generateReason,
  extractIndicatorFeatures,
  extractFundamentalFeatures,
};
