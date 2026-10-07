const axios = require('axios');

const MODAL_URL = process.env.MODAL_URL || '';
const REQUEST_TIMEOUT = 120000;
const TRAIN_TIMEOUT = 600000;

// A Modal endpoint that 404s (or is otherwise down) must not be retried on
// every single signal — that is thousands of failed calls per cycle. After a
// few consecutive failures the bridge opens for a cooldown and abstains
// immediately, then retries once the cooldown elapses.
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 10 * 60 * 1000;
let _failures = 0;
let _openUntil = 0;

let _lastStatus = { models_loaded: 0, total_samples: 0, last_training: 0 };

async function _request(endpoint, data = null, timeout = REQUEST_TIMEOUT) {
  if (!MODAL_URL) {
    return null;
  }
  if (Date.now() < _openUntil) {
    return null;
  }
  const url = `${MODAL_URL.replace(/\/+$/, '')}/${endpoint}`;
  const config = {
    timeout,
    headers: { 'Content-Type': 'application/json' },
  };
  try {
    const method = data ? 'post' : 'get';
    const response = await axios[method](url, data || {}, config);
    _failures = 0;
    return response.data;
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    _failures++;
    if (_failures >= FAIL_THRESHOLD) {
      _openUntil = Date.now() + COOLDOWN_MS;
      console.warn(`[ModalBridge] ${_failures} consecutive failures (${msg}) - pausing Modal for ${COOLDOWN_MS / 60000} min`);
      _failures = 0;
    } else {
      console.warn(`[ModalBridge] ${endpoint} failed: ${msg}`);
    }
    return null;
  }
}

async function predict(symbol, sector, prices, volumes, fundamentals, marketPrices) {
  const result = await _request('predict', {
    symbol, sector, prices: prices || [],
    volumes: volumes || [], fundamentals: fundamentals || {},
  });
  if (result && typeof result.win_prob === 'number') {
    return { win_prob: result.win_prob, model_used: result.model_used || 'modal', features_used: result.features_used || 0 };
  }
  return { win_prob: 0.5, model_used: 'fallback', features_used: 0 };
}

async function train() {
  const result = await _request('train', {}, TRAIN_TIMEOUT);
  if (result) {
    _lastStatus.models_loaded = (result.models || []).length;
    _lastStatus.total_samples = result.samples || 0;
    _lastStatus.last_training = Date.now();
  }
  return result || { status: 'error', message: 'Modal unreachable' };
}

async function getStatus() {
  const result = await _request('status');
  if (result) _lastStatus = result;
  return _lastStatus;
}

async function health() {
  return await _request('health');
}

function stop() {}

module.exports = { predict, train, getStatus, health, stop };
