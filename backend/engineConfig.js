// Engine Configuration — centralized runtime-editable config with DB persistence.
// All tunable parameters live here: weights, thresholds, indicator params, training, regime, calibration.
const { pool } = require('./db');

const DEFAULTS = {
  enabled: true,
  preset: 'simple', // 'simple' or 'advanced' — controls which knobs are returned by GET /api/signals/engine/config?view=simple
  signalInterval: 300000,
  maxSymbols: 200,
  minConfidence: 40,
  backtestDays: 30,
  forwardTestMinAge: 28800000,

  // Webhook URLs for alerting (empty = no webhook)
  alerts: {
    webhookUrl: '',
    circuitBreakerWebhook: '',
    onTrainingComplete: false,
  },

  weights: {
    fundamental: 0.30,
    technical: 0.30,
    financial: 0.08,
    macro: 0.04,
    ml_probability: 0.15,
    confidence: 0.13,
    auto_optimize: false,
    optimize_frequency_hours: 24,
  },

  thresholds: {
    strong_buy: 68,
    buy: 60,
    accumulate: 50,
    hold: 40,
    reduce: 30,
    sell: 18,
    strong_sell: 0,
  },

  regime_adaptation: {
    enabled: true,
    models_per_regime: true,
    detection: {
      trend_fast: 20,
      trend_slow: 100,
      volatility_lookback: 20,
      thresholds: {
        bull_strong: 15,
        bull_moderate: 5,
        bear_strong: -15,
        bear_moderate: -5,
        crash: -25,
        bull_score_strong: 85,
        bull_score_moderate: 70,
        bear_score_strong: 25,
        bear_score_moderate: 35,
        crash_score: 10,
        sideways_score: 50,
      },
    },
    weights_per_regime: {
      bull:     { fundamental: 0.40, technical: 0.30, confidence: 0.15, financial: 0.15 },
      bear:     { fundamental: 0.25, technical: 0.40, confidence: 0.20, financial: 0.15 },
      sideways: { fundamental: 0.30, technical: 0.35, confidence: 0.20, financial: 0.15 },
      crash:    { fundamental: 0.40, technical: 0.25, confidence: 0.20, financial: 0.15 },
    },
  },

  ml_features: {
    use_raw_indicators: true,
    feature_list: ['rsi', 'macd_hist', 'bb_pct_b', 'sma_ratio', 'atr_ratio', 'volume_ratio', 'momentum_5d', 'pe_ratio', 'revenue_growth'],
    normalization: 'z-score',
  },

  calibration: {
    enabled: true,
    bin_size_pct: 5,
    min_samples_per_bin: 50,
    adjust_signal_strength: true,
  },

  indicator_params: {
    rsi_period: 14,
    macd_fast: 12,
    macd_slow: 26,
    macd_signal: 9,
    bb_period: 20,
    bb_std_dev: 2.0,
    sma_trend_fast: 20,
    sma_trend_slow: 50,
    sma_fast: 50,
    sma_slow: 200,
    atr_period: 14,
    vol_lookback: 10,
    auto_optimize: false,
    optimize_interval_days: 7,
  },

  training: {
    min_samples: 50,
    validation_split: 0.2,
    test_split: 0.1,
    rolling_window_days: 90,
    retrain_frequency_hours: 24,
    early_stopping_patience: 5,
  },

  symbol_clustering: {
    enabled: false,
    clusters: ['large_cap', 'mid_cap', 'small_cap', 'nse'],
    min_cluster_samples: 30,
  },

  python_ml: {
    enabled: true,
    xgboost_params: {
      n_estimators: 200,
      max_depth: 6,
      learning_rate: 0.05,
      subsample: 0.8,
      colsample_bytree: 0.7,
      min_child_weight: 3,
    },
    min_samples: 30,
    min_sector_samples: 15,
    retrain_frequency_hours: 6,
    market_symbol: 'SPY',
  },

  portfolio: {
    maxConcentration: 0.25,
    maxDrawdown: 0.20,
    stopLoss: 0.05,
  },

  // Scoring deltas — all hardcoded score adjustments are now configurable
  scoring: {
    signal_confidence: {
      baseline: 50,
      min: 10,
      max: 95,
      variance_multiplier: 0.3,
      regime_penalty_crash: 0.5,
      news_positive: 5,
      news_negative: -5,
      sparse_fund_tech: -4,
      sparse_fund_fin: -3,
      direction_buy_threshold: 55,
      direction_sell_threshold: 45,
      kelly_wlr_default: 1.5,
    },
    fundamentals: {
      baseline: 40,
      cap: 25,
      data_quality: {
        very_sparse: -14,
        sparse: -8,
        partial: -3,
      },
      pe: { discount_mult: 20, discount_cap: 12, premium_mult: 20, premium_cap: 8 },
      ev_ebitda: { good_delta: 10, median_fallback: 12 },
      pb: { low_threshold: 1.0, low_delta: 15, high_threshold: 5, high_delta: -5 },
      altman_z: { distress_threshold: 1.81, suppressed_cap: 40, safe_zone_delta: 5, safe_zone_threshold: 3.0 },
      revenue: { strong_threshold: 15, strong_delta: 12, moderate_threshold: 10, moderate_delta: 8, slight_threshold: 5, slight_delta: 3, decline_delta: -5 },
      eps: { beat_threshold: 10, beat_delta: 10, miss_threshold: -10, miss_delta: -10, slight_beat_delta: 3 },
      margin: { expansion_threshold: 2, expansion_delta: 10, contraction_threshold: -3, contraction_delta: -5, slight_expansion_delta: 3 },
      fcf: { strong_threshold: 5, strong_delta: 10, positive_delta: 3, negative_delta: -8 },
      de: { low_threshold: 0.5, low_delta: 8, high_threshold: 3.0, high_delta: -8, moderate_threshold: 1.0, moderate_delta: 3 },
      cr: { healthy_threshold: 1.5, healthy_delta: 5, low_threshold: 1.0, low_delta: -5 },
      roe: { good_threshold: 15, good_delta: 8, poor_threshold: 5, poor_delta: -5 },
      news_sentiment: { positive_delta: 5, negative_delta: -5 },
    },
    technicals: {
      baseline: 50,
      cap: 25,
      data_quality: {
        insufficient_bars: 20,
        insufficient_delta: -12,
        limited_bars: 50,
        limited_delta: -5,
      },
      rsi: { oversold: 15, approaching_oversold: 5, overbought: -5, approaching_overbought: -3 },
      macd: { bullish: 15, turning_bullish: 5, bearish: -15, turning_bearish: -5 },
      trend: {
        golden_cross: 20, death_cross: -15,
        strong_uptrend: 15, uptrend: 5,
        strong_downtrend: -10, downtrend: -3,
      },
      bb: { near_lower: 10, near_upper: -10, below_middle: 3 },
      volume: { surge_2x: 10, above_avg: 5, below_avg: -3 },
      momentum: {
        strong_positive: 15, positive: 10, slight_positive: 5,
        strong_negative: -10, negative: -5, slight_negative: -3,
      },
    },
    financials: {
      baseline: 50,
      cap: 25,
      de: { low_threshold: 0.5, low_delta: 15, high_threshold: 2.0, high_delta: -15 },
      cr: { good_threshold: 2.0, good_delta: 10, poor_threshold: 1.0, poor_delta: -10 },
      roe: { good_threshold: 15, good_delta: 15, poor_threshold: 5, poor_delta: -5 },
    },
    trade_type: {
      aggressive_buy_tech_min: 65,
      aggressive_buy_fund_min: 65,
      momentum_tech_min: 65,
      momentum_fund_max: 50,
      swing_tech_min: 65,
      long_term_value_fund_min: 65,
      long_term_value_tech_max: 50,
      long_term_fund_min: 65,
      swing_min_tech: 50,
      swing_min_fund: 50,
    },
  },
};

let _config = {};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeDeep(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeDeep(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

async function loadFromDb() {
  try {
    const result = await pool.query(`SELECT config_key, config_value FROM engine_config`);
    const dbConfig = {};
    for (const row of result.rows) {
      try {
        dbConfig[row.config_key] = JSON.parse(row.config_value);
      } catch {
        dbConfig[row.config_key] = row.config_value;
      }
    }
    if (Object.keys(dbConfig).length > 0) {
      _config = mergeDeep(deepClone(DEFAULTS), dbConfig);
    } else {
      // No config in DB yet — persist defaults so API edits survive restarts
      for (const key of Object.keys(DEFAULTS)) {
        await persistToDb(key, DEFAULTS[key]);
      }
      console.log('[EngineConfig] Persisted default config to DB');
    }
  } catch {
    // table may not exist — use defaults
  }
}

async function persistToDb(key, value) {
  try {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    await pool.query(
      `INSERT INTO engine_config (config_key, config_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = $2, updated_at = NOW()`,
      [key, strValue]
    );
  } catch {
    // best-effort
  }
}

const PRESET_SIMPLE_KEYS = [
  'enabled', 'signalInterval', 'maxSymbols', 'minConfidence', 'preset',
  'weights', 'thresholds', 'alerts',
  'training.retrain_frequency_hours', 'training.min_samples',
  'portfolio.maxConcentration', 'portfolio.maxDrawdown', 'portfolio.stopLoss',
  'python_ml.enabled',
  'indicator_params.rsi_period', 'indicator_params.vol_lookback',
];

function getConfig(view) {
  const full = deepClone(_config);
  if (view !== 'simple') return full;
  // Return only the simple keys as a flat/structured subset
  const simple = {};
  for (const k of PRESET_SIMPLE_KEYS) {
    const parts = k.split('.');
    let val = full;
    for (const p of parts) {
      if (val == null || typeof val !== 'object') { val = undefined; break; }
      val = val[p];
    }
    if (val !== undefined) {
      if (parts.length === 1) {
        simple[k] = val;
      } else {
        let cursor = simple;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cursor[parts[i]]) cursor[parts[i]] = {};
          cursor = cursor[parts[i]];
        }
        cursor[parts[parts.length - 1]] = val;
      }
    }
  }
  // Always include preset and alerts at top level
  simple.preset = full.preset;
  simple.alerts = full.alerts;
  return simple;
}

async function updateConfig(updates) {
  const before = deepClone(_config);
  _config = mergeDeep(_config, updates);
  for (const key of Object.keys(updates)) {
    await persistToDb(key, _config[key]);
  }
  return { before, after: deepClone(_config) };
}

// Get effective weights for a given regime — merges regime-specific with base weights
function getWeightsForRegime(regime, baseWeights) {
  const regimeCfg = _config.regime_adaptation;
  if (!regimeCfg || !regimeCfg.enabled) {
    return baseWeights || _config.weights;
  }
  const regWeights = regimeCfg.weights_per_regime && regimeCfg.weights_per_regime[regime];
  if (regWeights) return regWeights;
  return baseWeights || _config.weights;
}

// Get signal threshold for a specific signal type
function getThreshold(signalType) {
  const map = {
    'Strong Buy': _config.thresholds.strong_buy,
    'Buy': _config.thresholds.buy,
    'Accumulate': _config.thresholds.accumulate,
    'Hold': _config.thresholds.hold,
    'Reduce': _config.thresholds.reduce,
    'Sell': _config.thresholds.sell,
    'Strong Sell': _config.thresholds.strong_sell,
  };
  return map[signalType] || 50;
}

function getAllThresholds() {
  return { ..._config.thresholds };
}

// Initialize with defaults synchronously, then async-load from DB
_config = deepClone(DEFAULTS);

// Async load from DB (non-blocking — runs in background)
loadFromDb().catch(() => {});

async function sendWebhook(url, payload) {
  if (!url) return;
  try {
    const axios = require('axios');
    await axios.post(url, payload, { timeout: 5000 });
  } catch (err) {
    console.warn(`[Webhook] Failed to send to ${url}: ${err.message}`);
  }
}

// ML is offloaded to Modal serverless — circuit breaker not needed

module.exports = {
  getConfig,
  updateConfig,
  getWeightsForRegime,
  getThreshold,
  getAllThresholds,
  sendWebhook,
};
