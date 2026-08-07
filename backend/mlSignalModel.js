const { pool } = require('./db');
const engineConfig = require('./engineConfig');
const modalBridge = require('./modalBridge');
const EventEmitter = require('events');

const FEATURES = [
  'rsi', 'macd_hist', 'bb_pct_b', 'sma_ratio', 'atr_ratio',
  'volume_ratio', 'momentum_5d', 'pe_ratio', 'revenue_growth',
  'macro_score', 'technical_score', 'fundamental_score',
  'forward_test_1d_accuracy', 'forward_test_5d_accuracy',
  'forward_test_20d_accuracy', 'forward_test_all_accuracy',
  'forward_test_avg_days_to_resolve', 'forward_test_samples',
  'live_test_1d_win_rate', 'live_test_5d_win_rate',
  'live_test_20d_win_rate', 'live_test_all_win_rate',
  'live_test_avg_days_to_resolve', 'live_test_samples',
];
let _weights = null;
let _bias = 0;
let _trainingStats = { samples: 0, accuracy: 0, lastTraining: 0 };
let _trainingInProgress = false;
let _lastTrainError = null;
const TRAINING_INTERVAL = () => {
  const hours = engineConfig.getConfig().training?.retrain_frequency_hours || 24;
  return hours * 60 * 60 * 1000;
};
const MIN_SAMPLES = () => engineConfig.getConfig().training?.min_samples || 20;
const emitter = new EventEmitter();

// Calibration bins: confidence bucket -> actual accuracy
let _calibrationBins = {};
let _calibrationSamples = 0;

// Restore trained ML weights from engine_config on startup so the model
// survives restarts and cold-start cycles without requiring a fresh training
// run (which needs resolved outcomes that don't exist on new deployments).
(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS engine_config (config_key TEXT PRIMARY KEY, config_value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    const { rows } = await pool.query("SELECT config_value FROM engine_config WHERE config_key = 'ml_weights'");
    if (rows[0] && rows[0].config_value) {
      const saved = rows[0].config_value;
      if (saved.w && Array.isArray(saved.w) && saved.w.length > 0) {
        _weights = saved.w;
        _bias = typeof saved.b === 'number' ? saved.b : 0;
        if (saved.fs && saved.fs.means && saved.fs.stds) _featureStats = saved.fs;
        console.log(`[ML] Restored weights from engine_config (${saved.n || '?'} samples, ${saved.acc || '?'}% acc, saved ${saved.ts ? new Date(saved.ts).toISOString() : '?'})`);
        _trainingStats = { samples: saved.n || 0, accuracy: saved.acc || 0, lastTraining: saved.ts || 0, weights: _weights.map(v => Math.round(v * 1000) / 1000), bias: Math.round(_bias * 1000) / 1000 };
      }
    }
  } catch (e) { /* table may not exist on first deploy */ }
})();

function sigmoid(z) {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
}

function extractFeatures(signal) {
  const regimeMap = { bull: 1, sideways: 0, bear: -1, crash: -2, unknown: 0 };
  return [
    (signal.confidence || 50) / 100,
    (signal.entryPrice || 50) > 100 ? 0.7 : (signal.entryPrice || 50) > 20 ? 0.5 : 0.3,
    signal.market === 'NSE' ? 0.3 : 0.7,
    (signal.sector && ['Technology', 'Financial', 'Healthcare'].includes(signal.sector)) ? 0.7 : 0.5,
    signal.tradeType === 'Aggressive Buy' ? 0.8 : signal.tradeType === 'Swing Trade' ? 0.5 : 0.3,
    regimeMap[signal.regime] || 0,
  ];
}

// Extract raw indicator features from analysis objects for the ML model
function extractRawIndicators({ fundamental, technical, macro, priceHistory, currentPrice, volume, forwardTest, liveTest }) {
  const cfg = engineConfig.getConfig().ml_features;
  const featMap = {};

  if (technical && technical.indicators) {
    const ind = technical.indicators;
    featMap.rsi = parseFloat(ind.rsi) || 50;
    featMap.macd_hist = parseFloat(ind.macd) || 0;

    if (ind.bbLower && ind.bbUpper && currentPrice) {
      const bbLow = parseFloat(ind.bbLower);
      const bbHigh = parseFloat(ind.bbUpper);
      const bbMid = (bbLow + bbHigh) / 2;
      featMap.bb_pct_b = bbMid !== 0 ? (currentPrice - bbLow) / (bbHigh - bbLow) : 0.5;
    } else {
      featMap.bb_pct_b = 0.5;
    }

    const smaFast = parseFloat(ind.smaFast) || currentPrice;
    const smaSlow = parseFloat(ind.smaSlow) || currentPrice;
    featMap.sma_ratio = smaSlow > 0 ? smaFast / smaSlow : 1;

    if (priceHistory && priceHistory.length >= 14) {
      const ranges = [];
      for (let i = priceHistory.length - 14; i < priceHistory.length; i++) {
        ranges.push(Math.abs(priceHistory[i] - priceHistory[i - 1]) / priceHistory[i - 1]);
      }
      const atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      featMap.atr_ratio = atr;
    } else {
      featMap.atr_ratio = 0.02;
    }

    featMap.volume_ratio = parseFloat(ind.volRatio) || 1;

    const momentumVal = parseFloat(ind.momentum) || 0;
    featMap.momentum_5d = momentumVal;
  } else {
    Object.assign(featMap, { rsi: 50, macd_hist: 0, bb_pct_b: 0.5, sma_ratio: 1, atr_ratio: 0.02, volume_ratio: 1, momentum_5d: 0 });
  }

  if (fundamental && fundamental.metrics) {
    const m = fundamental.metrics;
    const peVal = m.peRating ? parseFloat(m.peRating.match(/[\d.]+/)?.[0]) || 18 : 18;
    featMap.pe_ratio = peVal;
    const revVal = m.revRating ? parseFloat(m.revRating.match(/[\d.]+/)?.[0]) || 0 : 0;
    featMap.revenue_growth = revVal;
  } else {
    featMap.pe_ratio = 18;
    featMap.revenue_growth = 0;
  }

  if (macro) {
    featMap.macro_score = (macro.score || 50) / 100;
  } else {
    featMap.macro_score = 0.5;
  }

  if (technical) {
    featMap.technical_score = (technical.score || 50) / 100;
  } else {
    featMap.technical_score = 0.5;
  }

  if (fundamental) {
    featMap.fundamental_score = (fundamental.score || 50) / 100;
  } else {
    featMap.fundamental_score = 0.5;
  }

  if (volume) {
    featMap.volume_raw = volume;
  } else {
    featMap.volume_raw = 0;
  }

  if (forwardTest) {
    const b = forwardTest.buckets || {};
    featMap.forward_test_1d_accuracy = b['1d']?.total > 0 ? b['1d'].correct / b['1d'].total : 0.5;
    featMap.forward_test_5d_accuracy = b['5d']?.total > 0 ? b['5d'].correct / b['5d'].total : 0.5;
    featMap.forward_test_20d_accuracy = b['20d']?.total > 0 ? b['20d'].correct / b['20d'].total : 0.5;
    featMap.forward_test_all_accuracy = forwardTest.total > 0 ? forwardTest.correct / forwardTest.total : 0.5;
    featMap.forward_test_avg_days_to_resolve = (forwardTest.avgDaysToResolve || 0) / 30;
    featMap.forward_test_samples = Math.log2(forwardTest.total + 1) / 10;
  } else {
    featMap.forward_test_1d_accuracy = 0.5;
    featMap.forward_test_5d_accuracy = 0.5;
    featMap.forward_test_20d_accuracy = 0.5;
    featMap.forward_test_all_accuracy = 0.5;
    featMap.forward_test_avg_days_to_resolve = 0.5;
    featMap.forward_test_samples = 0;
  }

  if (liveTest) {
    const b = liveTest.buckets || {};
    featMap.live_test_1d_win_rate = b['1d']?.total > 0 ? b['1d'].wins / b['1d'].total : 0.5;
    featMap.live_test_5d_win_rate = b['5d']?.total > 0 ? b['5d'].wins / b['5d'].total : 0.5;
    featMap.live_test_20d_win_rate = b['20d']?.total > 0 ? b['20d'].wins / b['20d'].total : 0.5;
    featMap.live_test_all_win_rate = liveTest.total > 0 ? liveTest.wins / liveTest.total : 0.5;
    featMap.live_test_avg_days_to_resolve = (liveTest.avgDaysToResolve || 0) / 30;
    featMap.live_test_samples = Math.log2(liveTest.total + 1) / 10;
  } else {
    featMap.live_test_1d_win_rate = 0.5;
    featMap.live_test_5d_win_rate = 0.5;
    featMap.live_test_20d_win_rate = 0.5;
    featMap.live_test_all_win_rate = 0.5;
    featMap.live_test_avg_days_to_resolve = 0.5;
    featMap.live_test_samples = 0;
  }

  const cfgFeatures = cfg.feature_list || FEATURES;
  const featureVector = cfgFeatures.map(name => featMap[name] !== undefined ? featMap[name] : 0);

  if (cfg.normalization === 'z-score' && _featureStats) {
    return featureVector.map((v, i) => {
      const mean = _featureStats.means[i] || 0;
      const std = _featureStats.stds[i] || 1;
      return std > 0 ? (v - mean) / std : 0;
    });
  }

  return featureVector;
}

let _featureStats = null;

function updateFeatureStats(X) {
  if (!X || X.length === 0) return;
  const dim = X[0].length;
  const means = new Array(dim).fill(0);
  const stds = new Array(dim).fill(0);
  for (let j = 0; j < dim; j++) {
    let sum = 0;
    for (let i = 0; i < X.length; i++) sum += X[i][j];
    means[j] = sum / X.length;
    let sqSum = 0;
    for (let i = 0; i < X.length; i++) sqSum += (X[i][j] - means[j]) ** 2;
    stds[j] = Math.sqrt(sqSum / X.length) || 1;
  }
  _featureStats = { means, stds };
}

function predictProbability(signal) {
  if (!_weights) return 0.5;
  const x = extractFeatures(signal);
  let z = _bias;
  for (let i = 0; i < _weights.length; i++) z += _weights[i] * x[i];
  return sigmoid(z);
}

// Predict win probability from analysis results (called by _buildSignal)
// Uses Python XGBoost when available, falls back to JS logistic regression
async function predictWinProbability(fundamental, technical, macro, priceHistory, currentPrice, volume, symbol, sector, fundamentalsObj, forwardTest, liveTest) {
  if (process.env.MODAL_URL) {
    try {
      const result = await modalBridge.predict(
        symbol || 'UNKNOWN',
        sector || 'Unknown',
        priceHistory || [],
        priceHistory?.volumes || [],
        fundamentalsObj || {},
        [],
      );
      if (result && typeof result.win_prob === 'number' && result.model_used !== 'fallback') {
        return result.win_prob;
      }
    } catch {
      // Modal unavailable — fall through to JS model
    }
  }

  // Fallback: JS logistic regression using indicator features
  if (!_weights) return 0.5;
  const x = extractRawIndicators({ fundamental, technical, macro, priceHistory, currentPrice, volume, forwardTest, liveTest });
  if (x.length !== _weights.length) return 0.5;
  let z = _bias;
  for (let i = 0; i < _weights.length; i++) z += _weights[i] * x[i];
  return sigmoid(z);
}

// Platt scaling coefficients for sparse-bin confidence calibration.
// Fit a sigmoid over all resolved predictions when per-bin sample counts
// are too low (< 50 total across all bins). Coefficients are recomputed
// alongside the calibration bins in updateCalibration.
let _plattA = null;
let _plattB = null;

// Calibrate confidence based on historical accuracy
function calibrateConfidence(rawConfidence, mlProb) {
  const cfg = engineConfig.getConfig().calibration;
  if (!cfg || !cfg.enabled) return rawConfidence;

  const binSize = cfg.bin_size_pct || 5;
  const binKey = Math.floor(rawConfidence / binSize) * binSize;
  const bin = _calibrationBins[binKey];

  // Per-bin calibration: accurate when the bin has enough resolved outcomes
  if (bin && bin.total >= (cfg.min_samples_per_bin || 10)) {
    const calibrated = bin.accuracy * 100;
    return Math.round(calibrated);
  }

  // Platt scaling fallback: fit a single sigmoid over ALL predictions when
  // individual bins are sparse. This gives a rough calibration even with
  // limited data — better than returning raw confidence uncorrected.
  if (_plattA != null && _plattB != null) {
    return Math.round(100 / (1 + Math.exp(-(_plattA * (rawConfidence / 100) + _plattB))));
  }

  return rawConfidence;
}

// Update calibration bins from resolved predictions
function updateCalibration(predictions) {
  const cfg = engineConfig.getConfig().calibration;
  if (!cfg || !cfg.enabled) return;

  for (const p of predictions) {
    if (p.predictedConfidence == null || p.actualOutcome == null) continue;
    const binSize = cfg.bin_size_pct || 5;
    const binKey = Math.floor(p.predictedConfidence / binSize) * binSize;
    if (!_calibrationBins[binKey]) _calibrationBins[binKey] = { total: 0, correct: 0, accuracy: 0 };
    _calibrationBins[binKey].total++;
    if (p.actualOutcome === 1) _calibrationBins[binKey].correct++;
    _calibrationBins[binKey].accuracy = _calibrationBins[binKey].correct / _calibrationBins[binKey].total;
    _calibrationSamples++;
  }

  // Fit Platt scaling (logistic regression on confidence vs outcome).
  // Requires at least 10 samples across all bins; recomputed every cycle
  // alongside the per-bin histograms so calibration stays current.
  if (predictions.length >= 10) {
    const xs = predictions.map(p => p.predictedConfidence / 100);
    const ys = predictions.map(p => p.actualOutcome);
    // Simple analytical fit: a = log(mean_win_rate / (1 - mean_win_rate))
    const meanWin = ys.reduce((s, v) => s + v, 0) / ys.length;
    const safe = Math.max(0.001, Math.min(0.999, meanWin));
    _plattB = Math.log(safe / (1 - safe));
    // b: scale to match predicted vs actual variance
    const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
    const varX = xs.reduce((s, v) => s + (v - meanX) ** 2, 0) / xs.length + 0.001;
    _plattA = Math.max(0.1, Math.sqrt(varX) * 2);
  }
}

async function _runBackgroundTraining() {
  _trainingInProgress = true;
  _lastTrainError = null;
  const startedAt = Date.now();
  console.log('[ML] Background training started...');

  // Fire-and-forget Modal training (background, non-blocking)
  if (process.env.MODAL_URL) {
    modalBridge.train().then(result => {
      if (result && result.status === 'ok') {
        console.log(`[ML] Modal XGBoost training completed: ${(result.models || []).length} models, ${result.samples} samples`);
      }
    }).catch(err => {
      console.warn(`[ML] Modal training failed (non-blocking): ${err.message}`);
    });
  }

  // Train JS logistic regression as fallback
  try {
    // Ensure analysis_data column exists
    await pool.query(`ALTER TABLE signal_history ADD COLUMN IF NOT EXISTS analysis_data jsonb`).catch(() => {});
    const result = await pool.query(`
      SELECT s.signal, sh.confidence, s.entry_price, s.exit_price, s.result,
             sh.ticker, sh.market, sh.sector, sh.trade_type, sh.generated_at,
             sh.analysis_data
      FROM signal_outcomes s
      JOIN signal_history sh
        ON sh.ticker = s.ticker
       AND date_trunc('milliseconds', sh.generated_at) = s.signal_generated_at
      WHERE s.result IS NOT NULL
        AND s.entry_price > 0
      ORDER BY s.recorded_at DESC
      LIMIT 20000
    `);
    if (!result.rows.length || result.rows.length < MIN_SAMPLES()) {
      _trainingInProgress = false;
      _lastTrainError = 'Insufficient samples';
      return;
    }

    const X = [];
    const y = [];
    const calibData = [];

    for (const row of result.rows) {
      const currentPrice = parseFloat(row.entry_price) || 50;
      let feats;
      if (row.analysis_data && typeof row.analysis_data === 'object') {
        feats = extractRawIndicators({
          ...row.analysis_data,
          currentPrice,
          priceHistory: [],
          volume: 0,
        });
      } else {
        // Build a minimal analysis object from DB columns — no hardcoded buckets
        feats = extractRawIndicators({
          fundamental: { score: row.confidence || 50, metrics: {} },
          technical: {},
          macro: {},
          priceHistory: [],
          currentPrice,
          volume: 0,
        });
      }
      if (!feats || feats.length === 0) continue;
      X.push(feats);
      y.push(row.result === 'win' ? 1 : 0);

      if (row.confidence != null) {
        calibData.push({
          predictedConfidence: row.confidence,
          actualOutcome: row.result === 'win' ? 1 : 0,
        });
      }
    }

    updateFeatureStats(X);

    const trainingCfg = engineConfig.getConfig().training;
    const valSplit = (trainingCfg && trainingCfg.validation_split) || 0.2;
    const splitIdx = Math.floor(X.length * valSplit);
    const XTrain = X.slice(splitIdx);
    const yTrain = y.slice(splitIdx);
    const XVal = X.slice(0, splitIdx);
    const yVal = y.slice(0, splitIdx);

    const lambda = 0.01;
    const epochs = 200;
    const n = XTrain.length;
    const dim = XTrain[0].length;
    let w = new Array(dim).fill(0);
    let b = 0;
    let lr = 0.1;

    let bestValAcc = 0;
    let bestW = w.slice();
    let bestB = b;
    let patienceCounter = 0;
    const patience = (trainingCfg && trainingCfg.early_stopping_patience) || 5;

    for (let epoch = 0; epoch < epochs; epoch++) {
      lr = 0.1 * Math.pow(0.98, epoch);
      let dw = new Array(dim).fill(0);
      let db = 0;
      for (let i = 0; i < n; i++) {
        const pred = sigmoid(b + XTrain[i].reduce((s, v, j) => s + w[j] * v, 0));
        const err = pred - yTrain[i];
        for (let j = 0; j < dim; j++) dw[j] += err * XTrain[i][j];
        db += err;
      }
      for (let j = 0; j < dim; j++) {
        dw[j] = (dw[j] + lambda * w[j]) / n;
        w[j] -= lr * dw[j];
      }
      b -= lr * (db / n);

      if (XVal.length > 0 && epoch % 10 === 0) {
        let valCorrect = 0;
        for (let i = 0; i < XVal.length; i++) {
          const pred = sigmoid(b + XVal[i].reduce((s, v, j) => s + w[j] * v, 0));
          if ((pred >= 0.5 && yVal[i] === 1) || (pred < 0.5 && yVal[i] === 0)) valCorrect++;
        }
        const valAcc = valCorrect / XVal.length;
        if (valAcc > bestValAcc) {
          bestValAcc = valAcc;
          bestW = w.slice();
          bestB = b;
          patienceCounter = 0;
        } else {
          patienceCounter++;
          if (patienceCounter >= patience) break;
        }
      }
    }

    if (XVal.length > 0) {
      _weights = bestW;
      _bias = bestB;
    } else {
      _weights = w;
      _bias = b;
    }

    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = sigmoid(_bias + X[i].reduce((s, v, j) => s + _weights[j] * v, 0));
      if ((pred >= 0.5 && y[i] === 1) || (pred < 0.5 && y[i] === 0)) correct++;
    }

    let valCorrect = 0;
    if (XVal.length > 0) {
      for (let i = 0; i < XVal.length; i++) {
        const pred = sigmoid(_bias + XVal[i].reduce((s, v, j) => s + _weights[j] * v, 0));
        if ((pred >= 0.5 && yVal[i] === 1) || (pred < 0.5 && yVal[i] === 0)) valCorrect++;
      }
    }

    _trainingStats = {
      samples: n,
      accuracy: Math.round((correct / X.length) * 1000) / 10,
      valAccuracy: XVal.length > 0 ? Math.round((valCorrect / XVal.length) * 1000) / 10 : null,
      lastTraining: Date.now(),
      weights: _weights.map(v => Math.round(v * 1000) / 1000),
      bias: Math.round(_bias * 1000) / 1000,
      featureStats: _featureStats ? {
        means: _featureStats.means.map(v => Math.round(v * 1000) / 1000),
        stds: _featureStats.stds.map(v => Math.round(v * 1000) / 1000),
      } : null,
    };

    updateCalibration(calibData);

    // Persist trained weights to engine_config so they survive restarts and
    // cold-start symbols immediately benefit from the trained model instead
    // of returning 0.5 until the next training cycle (which requires resolved
    // outcomes that don't exist on a fresh deployment).
    try {
      const payload = JSON.stringify({ w: _weights, b: _bias, fs: _featureStats, ts: Date.now(), n: n, acc: _trainingStats.accuracy });
      await pool.query(
        `INSERT INTO engine_config (config_key, config_value, updated_at) VALUES ('ml_weights', $1, NOW()) ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
        [payload]
      );
    } catch (e) { /* non-critical */ }

    console.log(`[ML] Background training completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${n} samples, ${_trainingStats.accuracy}% acc`);
  } catch (err) {
    _lastTrainError = err.message;
    _trainingStats.lastTraining = Date.now(); // still advance timer to avoid tight retry loop
    console.warn(`[ML] Background training failed: ${err.message}`);
  } finally {
    _trainingInProgress = false;
    emitter.emit('trainingComplete', { stats: _trainingStats, error: _lastTrainError });
  }
}

async function train() {
  if (_trainingInProgress) {
    console.log('[ML] Training already in progress, skipping duplicate request');
    return { status: 'in_progress', message: 'Training already running in background' };
  }
  _runBackgroundTraining().catch(err => {
    _trainingInProgress = false;
    _lastTrainError = err.message;
    console.warn(`[ML] Background training error: ${err.message}`);
  });
  return { status: 'started', message: 'Training started in background' };
}

async function maybeRetrain() {
  if (_trainingInProgress) return { status: 'in_progress', message: 'Training already running' };
  if (Date.now() - _trainingStats.lastTraining < TRAINING_INTERVAL()) return;
  return await train();
}

async function getModelInfo() {
  const info = {
    loaded: _weights !== null,
    samples: _trainingStats.samples,
    accuracy: _trainingStats.accuracy,
    valAccuracy: _trainingStats.valAccuracy || null,
    lastTraining: _trainingStats.lastTraining,
    calibrationBins: _calibrationSamples > 0 ? Object.fromEntries(
      Object.entries(_calibrationBins).map(([k, v]) => [k, { total: v.total, accuracy: Math.round(v.accuracy * 1000) / 10 }])
    ) : null,
    features: engineConfig.getConfig().ml_features.feature_list || FEATURES,
    featureStats: _trainingStats.featureStats,
  };
  try {
    info.modal = await modalBridge.getStatus();
  } catch (err) {
    info.modal = { error: err.message, models_loaded: 0 };
  }
  return info;
}

function mlScoreAdjustment(signal) {
  const prob = predictProbability(signal);
  return Math.round((prob - 0.5) * 2 * 20);
}

module.exports = { FEATURES, predictProbability, predictWinProbability, train, maybeRetrain, getModelInfo, mlScoreAdjustment, extractRawIndicators, calibrateConfidence, get modalBridge() { return modalBridge; }, emitter, get trainingInProgress() { return _trainingInProgress; }, get lastTrainError() { return _lastTrainError; } };
