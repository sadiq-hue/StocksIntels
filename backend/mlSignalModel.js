const { pool } = require('./db');
const engineConfig = require('./engineConfig');
const modalBridge = require('./modalBridge');
const EventEmitter = require('events');

const FEATURES = ['fundamental', 'technical', 'financial', 'macro', 'confidence', 'regimeVal'];
let _weights = null;
let _bias = 0;
let _trainingStats = { samples: 0, accuracy: 0, lastTraining: 0 };
let _trainingInProgress = false;
let _lastTrainError = null;
const TRAINING_INTERVAL = () => {
  const hours = engineConfig.getConfig().training?.retrain_frequency_hours || 24;
  return hours * 60 * 60 * 1000;
};
const MIN_SAMPLES = () => engineConfig.getConfig().training?.min_samples || 50;
const emitter = new EventEmitter();

// Calibration bins: confidence bucket -> actual accuracy
let _calibrationBins = {};
let _calibrationSamples = 0;

function sigmoid(z) {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
}

function extractFeatures(signal) {
  const regimeMap = { bull: 1, sideways: 0, bear: -1, crash: -2, unknown: 0 };
  return [
    (signal.fundamentalScore || 50) / 100,
    (signal.technicalScore || 50) / 100,
    (signal.financialScore || 50) / 100,
    (signal.macroScore || 50) / 100,
    (signal.confidence || 50) / 100,
    regimeMap[signal.regime] || 0,
  ];
}

// Extract raw indicator features from analysis objects for the ML model
function extractRawIndicators({ fundamental, technical, macro, priceHistory, currentPrice, volume }) {
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

    const sma20 = parseFloat(ind.sma20) || currentPrice;
    const sma50 = parseFloat(ind.sma50) || currentPrice;
    featMap.sma_ratio = sma50 > 0 ? sma20 / sma50 : 1;

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
async function predictWinProbability(fundamental, technical, macro, priceHistory, currentPrice, volume, symbol, sector, fundamentalsObj) {
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

  // Fallback: JS logistic regression
  if (!_weights) return 0.5;
  const mlCfg = engineConfig.getConfig().ml_features;
  if (mlCfg && mlCfg.use_raw_indicators) {
    const x = extractRawIndicators({ fundamental, technical, macro, priceHistory, currentPrice, volume });
    if (x.length !== _weights.length) return 0.5;
    let z = _bias;
    for (let i = 0; i < _weights.length; i++) z += _weights[i] * x[i];
    return sigmoid(z);
  }
  const signal = {
    fundamentalScore: fundamental ? fundamental.score : 50,
    technicalScore: technical ? technical.score : 50,
    financialScore: 50,
    macroScore: macro ? macro.score : 50,
    confidence: 50,
    regime: 'unknown',
  };
  return predictProbability(signal);
}

// Calibrate confidence based on historical accuracy
function calibrateConfidence(rawConfidence, mlProb) {
  const cfg = engineConfig.getConfig().calibration;
  if (!cfg || !cfg.enabled) return rawConfidence;

  const binSize = cfg.bin_size_pct || 5;
  const binKey = Math.floor(rawConfidence / binSize) * binSize;
  const bin = _calibrationBins[binKey];

  if (bin && bin.total >= (cfg.min_samples_per_bin || 50)) {
    const calibrated = bin.accuracy * 100;
    return Math.round(calibrated);
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
    const result = await pool.query(`
      SELECT s.signal, sh.confidence, s.entry_price, s.exit_price, s.result,
             sh.ticker, sh.market, sh.sector, sh.trade_type, sh.generated_at
      FROM signal_outcomes s
      JOIN signal_history sh ON sh.id = s.signal_history_id
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
      const regimeVal = 0;
      const cfg = engineConfig.getConfig().ml_features;

      let feats;
      if (cfg && cfg.use_raw_indicators) {
        const confidence = row.confidence || 50;
        const sector = row.sector || 'Unknown';
        const market = row.market || 'Global';
        feats = [
          confidence / 100,
          parseFloat(row.entry_price) > 100 ? 0.7 : parseFloat(row.entry_price) > 20 ? 0.5 : 0.3,
          market === 'NSE' ? 0.3 : 0.7,
          sector ? (['Technology', 'Financial', 'Healthcare'].includes(sector) ? 0.7 : 0.5) : 0.5,
          row.trade_type === 'Aggressive Buy' ? 0.8 : row.trade_type === 'Swing Trade' ? 0.5 : 0.3,
          regimeVal,
        ];
      } else {
        feats = [
          (row.confidence || 50) / 100,
          parseFloat(row.entry_price) > 100 ? 0.7 : parseFloat(row.entry_price) > 20 ? 0.5 : 0.3,
          row.market === 'NSE' ? 0.3 : 0.7,
          row.sector ? (['Technology', 'Financial', 'Healthcare'].includes(row.sector) ? 0.7 : 0.5) : 0.5,
          row.trade_type === 'Aggressive Buy' ? 0.8 : row.trade_type === 'Swing Trade' ? 0.5 : 0.3,
          regimeVal,
        ];
      }
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
    const splitIdx = Math.floor(X.length * (1 - valSplit));
    const XTrain = X.slice(0, splitIdx);
    const yTrain = y.slice(0, splitIdx);
    const XVal = X.slice(splitIdx);
    const yVal = y.slice(splitIdx);

    const lambda = 0.01;
    const learningRate = 0.1;
    const epochs = 200;
    const n = XTrain.length;
    const dim = XTrain[0].length;
    let w = new Array(dim).fill(0);
    let b = 0;

    let bestValAcc = 0;
    let bestW = w.slice();
    let bestB = b;
    let patienceCounter = 0;
    const patience = (trainingCfg && trainingCfg.early_stopping_patience) || 5;

    for (let epoch = 0; epoch < epochs; epoch++) {
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
        w[j] -= learningRate * dw[j];
      }
      b -= learningRate * (db / n);

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

module.exports = { predictProbability, predictWinProbability, train, maybeRetrain, getModelInfo, mlScoreAdjustment, extractRawIndicators, calibrateConfidence, get modalBridge() { return modalBridge; }, emitter, get trainingInProgress() { return _trainingInProgress; }, get lastTrainError() { return _lastTrainError; } };
