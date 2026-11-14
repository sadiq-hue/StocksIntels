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

const PROMPT_SCHEMA_VERSION = 'v1';
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

  // Build the complete position context.
  const context = buildPositionContext(positionData, enrichment);

  // Build the user prompt — the full position context as JSON.
  const userPrompt = `Position context for analysis (StocksIntels quantitative engine output — do not modify any quantitative values):

${JSON.stringify(context, null, 2)}

Please provide a structured analytical interpretation of this position following the system prompt instructions.`;

  let rawOutput;
  try {
    const result = await azureAIClient.createResponse(SYSTEM_PROMPT, userPrompt, {
      maxOutputTokens: 2500,
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
  validateAiOutput,
  SYSTEM_PROMPT,
  PROMPT_SCHEMA_VERSION,
  MODEL,
};
