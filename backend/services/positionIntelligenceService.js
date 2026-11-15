// StocksIntels AI Position Intelligence Service
//
// Builds a complete position context from existing quantitative signal data,
// calls Azure GPT-5-mini via the Responses API, and returns a validated,
// structured analytical interpretation.
//
// The AI is strictly interpretive: it never modifies recommendation, confidence,
// entry/stop/target levels, position sizing, or any quantitative engine output.

const { pool } = require('../db');
const azureAIClient = require('./azureAIClient');
const logger = require('../logger');

const PROMPT_SCHEMA_VERSION = 'v7';
const MODEL = process.env.AZURE_AI_MODEL || 'gpt-5-mini';

// Maximum characters for free-text fields sent to the model (input-size limit).
const MAX_FIELD_CHARS = 2000;
const MAX_NEWS_ITEMS = 10;
const MAX_KEY_RISKS = 12;

// Required output schema fields.
const REQUIRED_TOP_LEVEL = [
  'executive_summary',
  'recommendation_context',
  'investment_thesis',
  'factor_analysis',
  'factor_conflicts',
  'key_risks',
  'missing_information',
  'thesis_invalidation_conditions',
  'monitoring_priorities',
  'data_quality_observations',
  'limitations',
];

const REQUIRED_RECOMMENDATION_CONTEXT = [
  'existing_recommendation',
  'existing_confidence',
  'interpretation',
];

const REQUIRED_INVESTMENT_THESIS = [
  'bullish_factors',
  'bearish_factors',
  'neutral_factors',
];

const REQUIRED_FACTOR_ANALYSIS = [
  'fundamentals',
  'technical',
  'financial_health',
  'macro',
  'news_and_sentiment',
  'valuation',
  'risk',
];

function _truncate(str, max = MAX_FIELD_CHARS) {
  if (str == null) return null;
  const s = String(str);
  return s.length > max ? s.slice(0, max - 3) + '…' : s;
}

function _num(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function _pct(v) {
  const n = _num(v);
  return n == null ? null : Math.round(n * 100) / 100;
}

// Factor keys emitted by the quantitative engine (mirrors the UI FactorDef in
// MarketIntelligenceCard.tsx). The AI context must use these SAME keys, because
// the structured names (pe_ratio, current_ratio, …) are not populated.
const FACTOR_META = [
  { key: 'evSignal', ratingKey: 'evRating', name: 'EV/EBITDA', group: 'Valuation' },
  { key: 'peSignal', ratingKey: 'peRating', name: 'P/E vs Sector', group: 'Valuation' },
  { key: 'pbSignal', ratingKey: 'pbRating', name: 'Price/Book', group: 'Valuation' },
  { key: 'divSignal', ratingKey: 'divRating', name: 'Dividend Yield', group: 'Valuation' },
  { key: 'revSignal', ratingKey: 'revRating', name: 'Revenue Growth', group: 'Growth' },
  { key: 'epsSignal', ratingKey: 'epsRating', name: 'Earnings Surprise', group: 'Earnings' },
  { key: 'mgnSignal', ratingKey: 'mgnRating', name: 'Margin Trend', group: 'Margins' },
  { key: 'fcfSignal', ratingKey: 'fcfRating', name: 'Free Cash Flow Yield', group: 'Cash Flow' },
  { key: 'deSignal', ratingKey: 'debtRating', name: 'Debt/Equity', group: 'Financial Health' },
  { key: 'crSignal', ratingKey: 'crRating', name: 'Current Ratio', group: 'Financial Health' },
  { key: 'roeSignal', ratingKey: 'roeRating', name: 'Return on Equity', group: 'Financial Health' },
  { key: 'altSignal', ratingKey: 'altRating', name: 'Altman Z-Score', group: 'Financial Health' },
];

function _numsOf(s) {
  return (String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?/g) || [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

// Treat engine "no data / not available / insufficient / n/a" ratings as
// unavailable so they are consolidated into data_quality.missing_fields instead
// of being repeated inside factor sections.
const NO_DATA_RE = /no\s+(data|analyst|roe|debt)|not available|insufficient|n\/a|unavailable/i;

/**
 * Build the complete position context payload from the stored quantitative
 * signal data. Sections A–I per the integration specification.
 */
function buildPositionContext(positionData, enrichment = {}) {
  const payload = positionData.payload || {};

  // signal_snapshots stores the full signal object in the `payload` column
  // (see signalSnapshotsService.js). analysis_data lives on signal_history,
  // not signal_snapshots. Prefer payload, fall back to top-level fields.
  const signalObj = typeof payload === 'string'
    ? (() => { try { return JSON.parse(payload); } catch { return {}; } })()
    : payload;

  const {
    ticker, name, signal, confidence, action, type,
    entry: entryPrice, stopLoss,
    target1, target2, target3, riskReward: riskReward,
    positionSize: positionSize,
    sector: sectorFromObj, market, currency, price, regime, dataSource: dataSource,
    generated_at: generatedAt, analyzed_at: analyzedAt,
    country: countryFromObj, industry: industryFromObj,
  } = positionData || {};

  // companyProfile lives nested inside the signal object payload
  // (set by _buildSignal in signalService.js line 6988-6997).
  const companyProfile = signalObj.companyProfile || {};

  // analysis_data lives in payload.analysis (set by _buildSignal in signalService.js)
  const analysisDataRaw = signalObj.analysis || positionData.analysis_data || {};
  const analysisData =
    analysisDataRaw == null
      ? {}
      : typeof analysisDataRaw === 'string'
        ? (() => { try { return JSON.parse(analysisDataRaw); } catch { return {}; } })()
        : analysisDataRaw;

  const fundamental = analysisData.fundamental || {};
  const technical = analysisData.technical || {};
  const financial = analysisData.financial || {};
  // Macro score/grade may live on the signal object top-level (macro param passed to
  // _buildSignal) or inside analysis_data. Prefer top-level, fall back to analysis.
  const macro = positionData.macro || signalObj.macro || analysisData.macro || {};
  const insider = positionData.insider || signalObj.insider || analysisData.insider || {};

  const news = Array.isArray(positionData.news) ? positionData.news : (enrichment.news || []);
  const newsSummary = positionData.news_summary || enrichment.newsSummary || null;
  const catalyst = positionData.catalyst || enrichment.catalyst || null;

    return {
      // A. Position identity & recommendation
      position: {
        ticker: ticker || null,
        company_name: name || null,
        company_description: companyProfile.description || null,
        exchange: market || null,
        market: market || null,
        country: countryFromObj || companyProfile.country || positionData.country || null,
        sector: sectorFromObj || companyProfile.industry || positionData.sector || null,
        industry: industryFromObj || companyProfile.industry || positionData.industry || null,
        employees: companyProfile.employees || null,
        ceo: companyProfile.ceo || null,
        website: companyProfile.website || null,
        recommendation: signal || null,
        confidence_score: _num(confidence),
        position_type: type || null,
        investment_style: type || null,
        holding_period: positionData.timeframe || null,
        analysis_timestamp: generatedAt || analyzedAt || null,
        original_analysis_price: _num(entryPrice) || _num(price),
      },
      // B. Market & price information
      market_data: {
        current_market_price: _num(price),
        daily_price_change: positionData.change != null ? _num(positionData.change) : null,
        daily_price_change_pct: positionData.change_pct != null ? _num(positionData.change_pct) : null,
        price_since_analysis_pct: null,
        original_analysis_price: _num(entryPrice) || _num(price),
        price_timestamp: generatedAt || analyzedAt || null,
        current_price_timestamp: positionData.analyzed_at || null,
        volume: positionData.volume || null,
        currency: currency || null,
      },
    // C. Fundamental analysis
    fundamentals: {
      pe_ratio: _num(fundamental.metrics ? fundamental.metrics.pe_ratio : fundamental.pe_ratio),
      pb_ratio: _num(fundamental.metrics ? fundamental.metrics.pb_ratio : fundamental.pb_ratio),
      revenue_growth: _num(fundamental.metrics ? fundamental.metrics.revenue_growth : fundamental.revenue_growth),
      earnings_growth: _num(fundamental.metrics ? fundamental.metrics.earnings_growth : fundamental.eps_growth),
      profit_margin: _num(fundamental.metrics ? fundamental.metrics.profit_margin : fundamental.profit_margin),
      free_cash_flow_yield: _num(fundamental.metrics ? fundamental.metrics.fcf_yield : fundamental.fcf_yield),
      dividend_yield: _num(fundamental.metrics ? fundamental.metrics.dividend_yield : fundamental.dividend_yield),
      sector_avg_pe: _num(fundamental.metrics ? fundamental.metrics.sector_avg_pe : fundamental.sector_avg_pe),
      valuation_indicators: fundamental.metrics || {},
      score: _num(fundamental.score),
      grade: fundamental.grade || null,
      data_quality: fundamental.dataQuality || null,
      missing_metrics: fundamental.missing_metrics || [],
    },
    // D. Financial health
    financial_health: {
      debt_to_equity: _num(financial.debt_to_equity ?? financial.de),
      current_ratio: _num(financial.current_ratio ?? financial.cr),
      quick_ratio: _num(financial.quick_ratio),
      roe: _num(financial.roe),
      roic: _num(financial.roic),
      altman_z_score: _num(financial.altman_z ?? financial.altmanZ),
      cash_flow_indicators: financial.cash_flow_indicators || {},
      liquidity_metrics: financial.liquidity_metrics || {},
      solvency_metrics: financial.solvency_metrics || {},
      score: _num(financial.score),
      grade: financial.grade || null,
      sparse_penalty_applied: financial.sparse_penalty_applied || null,
    },
    // E. Technical analysis
    technicals: {
      rsi: _num(technical.rsi),
      macd: technical.macd || null,
      macd_histogram: _num(technical.macd_histogram),
      sma_20: _num(technical.sma_20),
      sma_50: _num(technical.sma_50),
      bollinger_bands: technical.bollinger_bands || null,
      atr: _num(technical.atr),
      momentum: _num(technical.momentum),
      volume: _num(technical.volume ?? positionData.volume),
      trend_direction: technical.trend_direction || null,
      score: _num(technical.score),
      grade: technical.grade || null,
      indicators: technical.indicators || {},
    },
    // F. Macro & market conditions
    macro: {
      score: _num(macro.score),
      grade: macro.grade || null,
      market_regime: regime || null,
      signal: macro.signal || null,
      country: positionData.country || null,
      conditions: macro.conditions || {},
      summary: macro.summary || null,
      data_source: macro.data_source || null,
    },
    // G. News & sentiment
    news_and_sentiment: {
      sentiment_score: newsSummary != null && typeof newsSummary === 'object'
        ? _num(newsSummary.net) : null,
      positive_count: newsSummary != null && typeof newsSummary === 'object' ? newsSummary.positive : null,
      neutral_count: newsSummary != null && typeof newsSummary === 'object' ? newsSummary.neutral : null,
      negative_count: newsSummary != null && typeof newsSummary === 'object' ? newsSummary.negative : null,
      headlines: (Array.isArray(news) ? news : [])
        .slice(0, MAX_NEWS_ITEMS)
        .map(n => ({
          headline: n.headline || null,
          source: n.source || null,
          sentiment: n.sentiment || null,
          published_at: n.publishedAt || n.published_at || null,
          catalyst_direction: n.catalystDirection || n.catalyst_direction || null,
          catalyst_strength: _num(n.catalystStrength || n.catalyst_strength),
        })),
      catalysts: catalyst ? [{
        type: catalyst.type || null,
        direction: catalyst.direction || null,
        strength: _num(catalyst.strength),
        headline: catalyst.headline || null,
        source: catalyst.source || null,
        published_at: catalyst.publishedAt || catalyst.published_at || null,
      }] : [],
      insider_activity: insider ? {
        score: _num(insider.score),
        has_activity: insider.has_activity || false,
        net_shares: _num(insider.net_shares ?? insider.netShares),
        buy_count: insider.buy_count ?? insider.buyCount,
        sell_count: insider.sell_count ?? insider.sellCount,
        latest_date: insider.latest_date ?? insider.latestDate,
        summary: insider.summary || null,
      } : null,
    },
    // H. Valuation & risk
    valuation_and_risk: {
      fair_value: _num(positionData.fair_value != null ? positionData.fair_value : analysisData.fair_value),
      valuation_methodology: positionData.valuation_methodology != null ? positionData.valuation_methodology : (analysisData.valuation_methodology != null ? analysisData.valuation_methodology : null),
      wacc: _num(positionData.wacc != null ? positionData.wacc : analysisData.wacc),
      growth_assumptions: positionData.growth_assumptions != null ? positionData.growth_assumptions : (analysisData.growth_assumptions != null ? analysisData.growth_assumptions : null),
      bear_case: positionData.bear_case != null ? positionData.bear_case : (analysisData.bear_case != null ? analysisData.bear_case : null),
      base_case: positionData.base_case != null ? positionData.base_case : (analysisData.base_case != null ? analysisData.base_case : null),
      bull_case: positionData.bull_case != null ? positionData.bull_case : (analysisData.bull_case != null ? analysisData.bull_case : null),
      original_downside_level: _num(stopLoss),
      existing_target_1: _num(target1),
      existing_target_2: _num(target2),
      existing_target_3: _num(target3),
      existing_stop_level: _num(stopLoss),
      existing_risk_assessment: positionData.risk_assessment || null,
      existing_risk_reward: _num(riskReward),
      existing_position_sizing: _num(positionSize),
      var_95: positionData.var95 || null,
      var_99: positionData.var99 || null,
      cvar_95: positionData.cvar95 || null,
    },
    // I. Data quality
    data_quality: {
      data_source: dataSource || null,
      analysis_timestamp: generatedAt || analyzedAt || null,
      stale_data_flags: analysisData.stale_data_flags || [],
      missing_metrics: (fundamental.missing_metrics || []).concat(
        financial.missing_metrics || [],
        technical.missing_indicators || []
      ),
      factors_excluded_from_scoring: analysisData.factors_excluded || [],
      data_limitations: analysisData.data_limitations || [],
    },
  };
}

/**
 * Build an authoritative context that mirrors exactly what the Market
 * Intelligence page renders. Values are pulled from the same keys the UI uses
 * (fundamental.metrics.*Signal / *Rating, technical.indicators, newsSummary,
 * and the signal_snapshots stop_loss column + payload levels). This prevents
 * the model from claiming a value is missing when it is visible on screen.
 */
function buildAuthoritativeContext(positionData, enrichment = {}) {
  const row = positionData || {};
  const payloadRaw = row.payload;
  const payload = typeof payloadRaw === 'string'
    ? (() => { try { return JSON.parse(payloadRaw); } catch { return {}; } })()
    : (payloadRaw || {});

  const analysis = payload.analysis || {};
  const fundamental = analysis.fundamental || {};
  const technical = analysis.technical || {};
  const financial = analysis.financial || {};
  const metrics = fundamental.metrics || {};
  const ti = technical.indicators || {};
  const company = payload.companyProfile || {};

  const news = Array.isArray(payload.news) ? payload.news : (Array.isArray(row.news) ? row.news : []);
  const newsSummary = row.news_summary || payload.newsSummary || null;
  const catalyst = row.catalyst || payload.catalyst || null;
  const insider = payload.insider || null;
  const macro = payload.macro || analysis.macro || {};

  const unavailableFactors = [];
  const factors = FACTOR_META.map((f) => {
    const signal = metrics[f.key] != null ? metrics[f.key] : null;
    const rating = metrics[f.ratingKey] != null ? metrics[f.ratingKey] : null;
    if (signal == null && rating == null) return null;
    const text = String(rating != null ? rating : signal);
    if (NO_DATA_RE.test(text)) {
      unavailableFactors.push(f.name);
      return null;
    }
    return {
      name: f.name,
      group: f.group,
      signal,
      rating,
      assessed: true,
      numbers: _numsOf(text),
    };
  }).filter(Boolean);

  const firstNum = (name) => {
    const f = factors.find((x) => x.name === name);
    return f && f.numbers.length ? f.numbers[0] : null;
  };

  const entry = _num(row.entry) ?? _num(payload.entry);
  const stop = _num(row.stop_loss) ?? _num(payload.stopLoss);
  const t1 = _num(row.target1) ?? _num(payload.target1);
  const t2 = _num(row.target2) ?? _num(payload.target2);
  const t3 = _num(row.target3) ?? _num(payload.target3);
  const rr = _num(row.risk_reward) ?? _num(payload.riskReward);
  const alloc = row.position_size != null ? row.position_size : payload.positionSize;
  const sentimentLabel = newsSummary && newsSummary.net ? String(newsSummary.net) : null;
  const overallScore = analysis.overall && analysis.overall.score != null ? _num(analysis.overall.score) : null;
  // Mirrors the page's displayed "Risk Level" (MarketIntelligenceCard riskLevel).
  const riskLevelDisplay = overallScore == null ? null : (overallScore >= 70 ? 'Moderate' : 'Elevated');
  // How the engine derived risk_reward: with scenario targets it is
  // (average target - entry)/(entry - stop); otherwise (min target - entry)/(entry - stop)
  // (see riskManager.calculateTradeLevels and scenarioTargets.buildScenarioTargets).
  const targetMethod = payload.targetMethod || null;
  const riskRewardBasis = rr == null ? null : (targetMethod === 'scenario' ? 'average_target' : 'minimum_target');
  const targetRewardRisk = payload.targets ? {
    method: payload.targets.method || null,
    reward_risk_minimum: _num(payload.targets.rewardRiskMinimum),
    reward_risk_average: _num(payload.targets.rewardRiskAverage),
    reward_risk_extended: _num(payload.targets.rewardRiskExtended),
  } : null;

  // Single consolidated list of unavailable fields. Only data_quality_observations
  // should mention these; factor sections describe available evidence only.
  const MISSING_LABEL = {
    'Return on Equity': 'Return on Equity (ROE)',
    'Earnings Surprise': 'Analyst/earnings estimates',
  };
  const missingFields = unavailableFactors.map((n) => MISSING_LABEL[n] || n);
  if (payload.fairValue == null) missingFields.push('Fair value');
  if ((row.price != null ? row.price : payload.price) == null) missingFields.push('Market current price');
  if (payload.volume == null) missingFields.push('Market-level volume');

  return {
    source_priority: 'AUTHORITATIVE: position, levels, factors, technicals and counts below are engine outputs. Interpret them; never contradict or override them. If a field is null, say "not provided" — do not guess.',

    metric_definitions: {
      position_score: 'Weighted engine composite (0-100). This is NOT confidence.',
      confidence_score: 'Engine conviction (0-100). This is NOT a probability of success.',
      recommendation: 'Engine classification (Strong Buy / Buy / Hold / Sell / Strong Sell).',
      position_type: 'Trade style label (e.g., Aggressive Buy, Swing Trade).',
      risk_level: 'Displayed risk classification (Moderate / Elevated).',
      risk_reward: 'Reward-to-risk ratio (reward distance / risk distance). This is NOT a probability.',
    },

    position: {
      ticker: row.ticker || payload.ticker || null,
      company_name: row.name || payload.name || null,
      company_description: company.description || null,
      industry: company.industry || row.sector || null,
      sector: row.sector || company.industry || null,
      country: company.country || payload.country || null,
      employees: company.employees || null,
      ceo: company.ceo || null,
      website: company.website || null,
      recommendation: row.signal || payload.signal || null,
      confidence_score: _num(row.confidence != null ? row.confidence : payload.confidence),
      position_type: payload.type || null,
      holding_period: row.timeframe || payload.timeframe || null,
      generated_at: payload.generatedAt || row.analyzed_at || null,
    },

    levels: {
      analysis_price: entry,
      downside_level: stop,
      minimum_target: t1,
      average_target: t2,
      extended_target: t3,
      risk_reward: rr,
      model_allocation: alloc != null ? String(alloc) : null,
      note: 'These levels are the source of truth. Never say stops or targets are unavailable when present.',
    },

    market: {
      current_price: _num(row.price != null ? row.price : payload.price),
      daily_change: _num(payload.change),
      currency: payload.currency || null,
      volume: payload.volume || null,
      volume_note: 'Market-level volume. Distinct from technicals.volume (the technical indicator volume); a difference is not a contradiction.',
    },

    fundamentals: {
      score: _num(fundamental.score),
      grade: fundamental.grade || null,
      factors,
      sparse_data: metrics.dataQuality || null,
    },

    financial_health: {
      score: _num(financial.score),
      grade: financial.grade || null,
      factors: factors.filter((f) => f.group === 'Financial Health'),
      current_ratio: firstNum('Current Ratio'),
      debt_to_equity: firstNum('Debt/Equity'),
      roe: firstNum('Return on Equity'),
      altman_z_score: firstNum('Altman Z-Score'),
      engine_commentary: financial.analysis || null,
    },

    technicals: {
      score: _num(technical.score),
      grade: technical.grade || null,
      trend: ti.trendSignal || null,
      sma_fast: ti.smaFast || null,
      sma_slow: ti.smaSlow || null,
      macd_signal: ti.macdSignal || null,
      macd_value: ti.macd || null,
      rsi: ti.rsi || null,
      rsi_signal: ti.rsiSignal || null,
      momentum: ti.momentum || null,
      bollinger_signal: ti.bbSignal || null,
      volume_signal: ti.volumeSignal || null,
      volume: ti.volume || null,
    },

    macro: {
      score: _num(macro.score),
      grade: macro.grade || null,
      overall_signal: macro.signal || null,
      conditions: macro.conditions || {},
    },

    news_and_sentiment: {
      sentiment_label: sentimentLabel,
      positive_count: newsSummary ? newsSummary.positive : null,
      neutral_count: newsSummary ? newsSummary.neutral : null,
      negative_count: newsSummary ? newsSummary.negative : null,
      total_count: newsSummary ? newsSummary.count : (news.length || null),
      interpretation_rule: 'Use sentiment_label as the overall sentiment. Do NOT recount headlines to override it; per-headline labels may differ.',
      reconciliation: 'sentiment_label is the overall aggregate; catalyst.direction is a specific recorded event. If they differ (e.g., positive sentiment with a negative Crisis catalyst), report both and treat the catalyst as a specific risk.',
      headlines: news.slice(0, 8).map((n) => ({
        headline: n.headline || null,
        source: n.source || null,
        sentiment: n.sentiment || null,
        published_at: n.publishedAt || n.published_at || null,
      })),
      catalyst: catalyst ? {
        type: catalyst.type || null,
        direction: catalyst.direction || null,
        strength: _num(catalyst.strength),
        headline: catalyst.headline || null,
        source: catalyst.source || null,
        published_at: catalyst.publishedAt || null,
      } : null,
      insider_activity: insider ? {
        score: _num(insider.score),
        has_activity: !!insider.hasActivity,
        buys: insider.buyCount != null ? insider.buyCount : null,
        sells: insider.sellCount != null ? insider.sellCount : null,
        net_shares: _num(insider.netShares),
        summary: insider.summary || null,
      } : null,
    },

    valuation_and_risk: {
      fair_value: _num(payload.fairValue),
      existing_targets: [t1, t2, t3].filter((x) => x != null),
      downside_level: stop,
      risk_reward: rr,
      overall_score: overallScore,
      risk_level: riskLevelDisplay,
      risk_reward_basis: riskRewardBasis,
      target_reward_risk: targetRewardRisk,
      risk_reward_note: 'Engine-supplied reward-to-risk ratio (reward / risk distance); do not recalculate. <1 means potential reward is smaller than the risk distance. This is not a probability and does not by itself imply attractive asymmetry.',
      cross_factor_risk_signal: payload.intelligence && payload.intelligence.riskLevel ? payload.intelligence.riskLevel : null,
      cross_factor_summary: payload.intelligence && payload.intelligence.summary ? payload.intelligence.summary : null,
    },

    data_quality: {
      completeness: payload.dataCompleteness || null,
      trust: payload.dataTrust || null,
      flags: payload.intelligence && payload.intelligence.dataIntegrity
        ? payload.intelligence.dataIntegrity.flags
        : null,
      missing_fields: missingFields,
    },
  };
}

/**
 * Strict system prompt for GPT-5-mini. The model acts as a professional equity
 * research analyst interpreting existing quantitative outputs — never overriding
 * them.
 */
const SYSTEM_PROMPT = `
You are a professional equity research analyst and market intelligence assistant for StocksIntels, an AI-powered market intelligence platform covering African and global financial markets.

Your role is strictly interpretive. You receive a complete position context produced by the StocksIntels quantitative signal engine. Your job is to explain, contextualize, and analyze what the engine already decided — NOT to second-guess, override, or replace it.

CORE RULES — YOU MUST NOT:
1. Generate a different recommendation (Buy/Sell/Hold/Strong Buy/Strong Sell).
2. Change the existing confidence score.
3. Create new price targets, stop levels, or entry prices.
4. Recalculate position sizing or portfolio allocation.
5. Invent financial metrics, news, catalysts, or insider transactions.
6. Assume a high aggregate score proves financial strength.
7. Treat missing data as positive evidence.
8. Present speculative assumptions as verified facts.
9. Provide personalized investment advice.
10. Present model confidence as a probability of success unless the methodology explicitly supports it.

YOUR RESPONSIBILITIES:
1. Interpret only the supplied position data.
2. Preserve the existing quantitative recommendation exactly as given.
3. Explain why the engine produced the recommendation, citing the supplied sub-scores and factors.
4. Identify the strongest supporting (bullish) factors from the supplied data.
5. Identify the strongest opposing (bearish) factors from the supplied data.
6. Explain disagreements between fundamental, technical, financial, macro, and news indicators when they conflict.
7. Identify important missing information explicitly.
8. Distinguish facts (quantitative engine outputs, current market data) from AI interpretation.
9. Explain material valuation and risk considerations using only the supplied values — do not recalculate.
10. Identify developments that could invalidate the existing investment thesis.
11. Highlight monitoring priorities for the position.
12. Explain the limitations of the analysis, including data quality issues.
13. Avoid unsupported claims and fabricated catalysts.
14. If information is insufficient, explicitly state what cannot be concluded.

CONSISTENCY RULES (critical — read before writing):
- The supplied context is authoritative. Never state that a value is missing when it appears anywhere in the context — including inside fundamentals.factors, financial_health.factors, technicals, levels, or the news counts.
- Use news_and_sentiment.sentiment_label as the overall news sentiment. Do NOT mention, enumerate, or compare the positive/neutral/negative headline counts in any form — rely only on sentiment_label. You may say that individual headlines vary, but never state how many are positive/neutral/negative.
- Use levels.analysis_price, levels.downside_level and levels.*target* for all level references. Never claim stops or targets are unavailable when they are present.
- Use valuation_and_risk.risk_level as the risk label shown to users. Do not replace it with cross_factor_risk_signal.
- For each factor, rely on its "signal" and "rating" text and any numbers inside them. If a numeric value is absent, say "no numeric value provided" — do not invent one and do not describe it as present.
- If two supplied fields appear inconsistent (for example a rating text implies a value that is otherwise missing, or a label conflicts with a headline mix), explicitly identify the inconsistency rather than silently picking one.
- Different fields measure different things — never present them as contradictions:
  · market.volume (a market-level figure) and technicals.volume (the technical indicator volume) are separate measurements.
  · A missing metric (e.g., ROE or analyst estimates) does not mean the whole category is missing when a related factor is assessed (e.g., Margin Trend = "Margin stable").
- A factor present in fundamentals.factors / financial_health.factors with a signal or rating is ASSESSED. Never describe Margin Trend as unspecified or missing when its rating is "Margin stable" — treat margin as assessed (stable/neutral). Only factors completely absent are unspecified.
- news_and_sentiment.sentiment_label is the OVERALL aggregate; news_and_sentiment.catalyst.direction is a SPECIFIC recorded event. If they differ (for example overall sentiment is positive while the recorded catalyst direction is negative, such as a Crisis), state both: overall coverage is positive, and the specific catalyst remains a risk. Never say there is "no negative catalyst" when catalyst.direction is negative.
- levels.risk_reward is the engine's supplied reward-to-risk ratio (reward distance / risk distance), computed against the engine target basis in valuation_and_risk.risk_reward_basis (minimum_target or average_target). Do NOT recalculate it. A value below 1 means the potential reward is smaller than the risk distance. Do not describe it as attractive/acceptable asymmetry, and never imply that a Strong Buy recommendation, a high position score, or high confidence implies a good risk/reward. Where they diverge, explicitly acknowledge the tension between Strong Buy / score / confidence and a sub-1 risk/reward with a Moderate risk label.
- Keep these metrics strictly distinct and never substitute one for another: position_score (weighted engine composite), confidence_score (engine conviction — NOT a probability of success), recommendation, position_type, risk_level, and risk_reward. Do not present confidence as a probability and do not present position_score as confidence.
- recommendation, confidence_score, risk_level and holding_period are engine outputs. Preserve them exactly (including the stated holding period and "Moderate"/"Elevated" risk label) and never present expected upside as guaranteed.
- Do not assert a company development as verified when it appears only as a headline — attribute it to the headline ("a headline reports…"). Do not invent price levels, thresholds, or engine invalidation rules.
- Engine invalidation conditions come only from the supplied levels and engine fields. Your own monitoring suggestions are AI-generated and must be labelled as such.

STYLE RULES:
- Do not restate metrics that are already visible in the UI. Each factor_analysis section must focus on implications, relationships and conflicts, not a numeric recap.
- Avoid repeating the same figures across sections. Keep each section concise but substantive, with no generic filler.
- MISSING-DATA CONSOLIDATION (strict): the only authoritative list of unavailable fields is data_quality.missing_fields. List them exactly once, in data_quality_observations. Do NOT name any missing field (fair value, ROE, analyst/earnings estimates, market-level volume/current price, or any excluded factor) in executive_summary, factor_analysis, factor_conflicts, risk, or monitoring_priorities. Factor sections must describe the implications of available evidence only. In monitoring_priorities, refer generically to "currently unavailable metrics" rather than naming them.
- Always state the engine holding_period and risk_level ("~1 month", "Moderate"/"Elevated") exactly as supplied — include them in executive_summary or the risk section.
- The recorded news catalyst may be referenced in executive_summary and news_and_sentiment; mention it elsewhere only where it adds a distinct analytical purpose (e.g., position sizing). Do not repeat it in monitoring_priorities unless it is a primary risk, and then keep it to one clause.
- In factor_analysis, address each factor on its own terms; never generalize one missing metric into a whole category.
- In monitoring_priorities, explicitly label any technical threshold that is not an engine rule as AI-generated guidance (for example: "AI-generated monitoring: RSI above 70 — not an engine rule"). This applies to RSI > 70 and similar thresholds. Never invent price levels, targets, or engine invalidation conditions.
- Write like a research analyst: explain what the metrics mean and how they relate; highlight genuine supporting and opposing evidence and uncertainty; do not simply restate numbers already visible on the page.

FINAL SELF-CHECK (run before returning JSON):
1. Missing fields appear only in data_quality_observations (the data_quality.missing_fields list); no other section names them, including monitoring_priorities.
2. sentiment_label and catalyst.direction are reported separately when they differ.
3. risk_reward is quoted exactly as supplied (with its basis when available), not recalculated, and never described as attractive.
4. holding_period and risk_level are stated exactly as supplied.
5. position_score, confidence_score, recommendation, position_type and risk_reward are used distinctly; confidence is never presented as a probability of success.
6. No invented thresholds, price levels, or engine rules; any AI-generated monitoring threshold is explicitly labelled.

OUTPUT FORMAT:
Return valid JSON only — no markdown code fences, no preamble, no explanatory text outside the JSON. The JSON must conform to this schema:

{
  "executive_summary": "string (2-4 sentences, plain language)",
  "recommendation_context": {
    "existing_recommendation": "string (the exact signal from input)",
    "existing_confidence": number or null,
    "interpretation": "string (what this recommendation means in plain terms)"
  },
  "investment_thesis": {
    "bullish_factors": ["string", ...],
    "bearish_factors": ["string", ...],
    "neutral_factors": ["string", ...]
  },
  "factor_analysis": {
    "fundamentals": "string",
    "technical": "string",
    "financial_health": "string",
    "macro": "string",
    "news_and_sentiment": "string",
    "valuation": "string",
    "risk": "string"
  },
  "factor_conflicts": [
    { "factor_pair": "string", "conflict": "string", "assessment": "string" }
  ],
  "key_risks": ["string", ...],
  "missing_information": ["string", ...],
  "thesis_invalidation_conditions": ["string", ...],
  "monitoring_priorities": ["string", ...],
  "data_quality_observations": ["string", ...],
  "limitations": ["string", ...],
  "generated_at": "ISO 8601 timestamp",
  "model": "gpt-5-mini"
}

All string fields must be plain text. Arrays must contain strings unless otherwise specified. Do not include fields not in the schema. If a value is unknown, use null or an empty array — do not fabricate.
`;

/**
 * Validate that the model output conforms to the expected schema.
 * Returns { valid: true, data } or { valid: false, errors }.
 */
function validateAiOutput(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Output is not an object'] };
  }

  // Check required top-level fields.
  for (const field of REQUIRED_TOP_LEVEL) {
    if (!(field in raw)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Recommendation context.
  const rc = raw.recommendation_context;
  if (rc && typeof rc === 'object') {
    for (const field of REQUIRED_RECOMMENDATION_CONTEXT) {
      if (!(field in rc)) {
        errors.push(`Missing recommendation_context field: ${field}`);
      }
    }
    if (rc.existing_confidence != null && typeof rc.existing_confidence !== 'number') {
      errors.push('recommendation_context.existing_confidence must be a number or null');
    }
  } else {
    errors.push('recommendation_context must be an object');
  }

  // Investment thesis.
  const thesis = raw.investment_thesis;
  if (thesis && typeof thesis === 'object') {
    for (const field of REQUIRED_INVESTMENT_THESIS) {
      if (!(field in thesis) || !Array.isArray(thesis[field])) {
        errors.push(`investment_thesis.${field} must be an array`);
      }
    }
  } else {
    errors.push('investment_thesis must be an object');
  }

  // Factor analysis.
  const fa = raw.factor_analysis;
  if (fa && typeof fa === 'object') {
    for (const field of REQUIRED_FACTOR_ANALYSIS) {
      if (!(field in fa) || typeof fa[field] !== 'string') {
        errors.push(`factor_analysis.${field} must be a string`);
      }
    }
  } else {
    errors.push('factor_analysis must be an object');
  }

  // Factor conflicts.
  if (raw.factor_conflicts != null && !Array.isArray(raw.factor_conflicts)) {
    errors.push('factor_conflicts must be an array');
  }

  // Arrays.
  const arrayFields = ['key_risks', 'missing_information', 'thesis_invalidation_conditions', 'monitoring_priorities', 'data_quality_observations', 'limitations'];
  for (const field of arrayFields) {
    if (raw[field] != null && !Array.isArray(raw[field])) {
      errors.push(`${field} must be an array`);
    }
  }

  // generated_at must be a string if present.
  if (raw.generated_at != null && typeof raw.generated_at !== 'string') {
    errors.push('generated_at must be a string');
  }

  // model must be a string if present.
  if (raw.model != null && typeof raw.model !== 'string') {
    errors.push('model must be a string');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: raw };
}

/**
 * Parse the model's output text as JSON, handling common formatting issues.
 */
function _parseModelOutput(outputText) {
  if (!outputText || typeof outputText !== 'string') {
    throw new Error('Empty model output');
  }

  let text = outputText.trim();

  // Strip markdown code fences if present.
  if (text.startsWith('```')) {
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Try to find the first { ... } block in case of preamble.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through to full parse attempt.
    }
  }

  return JSON.parse(text);
}

/**
 * Generate a structured AI interpretation for a position.
 *
 * @param {Object} positionData - The quantitative signal data (from signal_snapshots or signal_history).
 * @param {Object} enrichment - Optional additional context (news, etc.).
 * @returns {Promise<{ ok: boolean, data?: Object, error?: string, model?: string }>}
 */
async function analyzePosition(positionData, enrichment = {}) {
  const ticker = positionData.ticker || positionData.symbol || 'UNKNOWN';

  if (!azureAIClient.isEnabled()) {
    logger.warn('[AI Intelligence] Azure AI not enabled, returning fallback');
    return {
      ok: false,
      error: 'Azure AI integration is not enabled.',
      code: 'AZURE_AI_DISABLED',
      model: MODEL,
    };
  }

  // Build the authoritative, UI-consistent position context.
  const context = buildAuthoritativeContext(positionData, enrichment);

  // Build the user prompt — the full position context as JSON.
  const userPrompt = `Position context for analysis (StocksIntels quantitative engine output — do not modify any quantitative values):

${JSON.stringify(context, null, 2)}

Please provide a structured analytical interpretation of this position following the system prompt instructions.`;

  let rawOutput;
  try {
    const result = await azureAIClient.createResponse(SYSTEM_PROMPT, userPrompt, {
      maxOutputTokens: 12000,
      reasoningEffort: 'low',
      requestId: `ai-intel-${ticker}-${Date.now()}`,
    });
    rawOutput = result.outputText;
    console.log('[AI DEBUG] Raw model output length:', rawOutput.length);
    console.log('[AI DEBUG] Raw model output first 500 chars:', rawOutput.substring(0, 500));
    console.log('[AI DEBUG] Raw model output last 200 chars:', rawOutput.substring(Math.max(0, rawOutput.length - 200)));
  } catch (err) {
    logger.error('[AI Intelligence] Azure AI call failed', {
      ticker,
      message: err.message,
    });
    return {
      ok: false,
      error: err.message,
      code: 'AI_CALL_FAILED',
      model: MODEL,
    };
  }

  // Parse and validate the structured output.
  let parsed;
  try {
    parsed = _parseModelOutput(rawOutput);
  } catch (err) {
    logger.error('[AI Intelligence] Failed to parse model output as JSON', {
      ticker,
      message: err.message,
      outputPreview: rawOutput ? rawOutput.slice(0, 200) : null,
    });
    return {
      ok: false,
      error: 'Model returned invalid JSON.',
      code: 'INVALID_MODEL_OUTPUT',
      model: MODEL,
      rawOutput: rawOutput ? rawOutput.slice(0, 500) : null,
    };
  }

  const validation = validateAiOutput(parsed);
  if (!validation.valid) {
    logger.error('[AI Intelligence] Model output failed schema validation', {
      ticker,
      errors: validation.errors,
    });
    return {
      ok: false,
      error: 'Model output failed validation: ' + validation.errors.join('; '),
      code: 'VALIDATION_FAILED',
      model: MODEL,
      rawOutput: rawOutput ? rawOutput.slice(0, 500) : null,
    };
  }

  // Ensure model field is set correctly.
  parsed.model = MODEL;
  if (!parsed.generated_at) {
    parsed.generated_at = new Date().toISOString();
  }

  logger.info('[AI Intelligence] analysis completed', {
    ticker,
    model: MODEL,
    promptSchemaVersion: PROMPT_SCHEMA_VERSION,
  });

  return {
    ok: true,
    data: parsed,
    model: MODEL,
    promptSchemaVersion: PROMPT_SCHEMA_VERSION,
    inputContext: context,
  };
}

module.exports = {
  analyzePosition,
  buildPositionContext,
  buildAuthoritativeContext,
  validateAiOutput,
  SYSTEM_PROMPT,
  PROMPT_SCHEMA_VERSION,
  MODEL,
};
