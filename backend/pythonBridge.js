// Python ML Bridge — spawns a Python process and communicates via JSON-over-stdin/stdout.
// Provides: train(), predict(), status()
const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('./db');
const EventEmitter = require('events');

const PYTHON_SCRIPT = path.join(__dirname, 'ml_service.py');
const PYTHON_EXE = process.env.PYTHON_PATH || 'python';
const emitter = new EventEmitter();

let _proc = null;
let _pending = {};
let _seq = 0;
let _buffer = '';
let _ready = false;
let _startupTime = 0;

// Circuit breaker state
const _circuitBreaker = {
  failures: 0,
  threshold: 3,
  cooldownMs: 300000, // 5 min
  lastTripTime: 0,
  isOpen: false,
  totalTrips: 0,
  lastError: null,
};

function _ensureProcess() {
  if (_proc && !_proc.killed) return;
  _proc = spawn(PYTHON_EXE, [PYTHON_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  });

  _buffer = '';
  _ready = false;
  _startupTime = Date.now();

  _proc.stdout.on('data', (data) => {
    _buffer += data.toString();
    const lines = _buffer.split('\n');
    _buffer = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        _handleMessage(msg);
      } catch (e) {
        console.error(`[PythonBridge] Failed to parse: ${line.slice(0, 100)}`);
      }
    }
  });

  _proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.error(`[PythonBridge:stderr] ${text}`);
  });

  _proc.on('exit', (code) => {
    console.log(`[PythonBridge] Process exited (code=${code}), will restart on next request`);
    _proc = null;
    _ready = false;
    // Reject all pending
    for (const [id, { reject }] of Object.entries(_pending)) {
      reject(new Error(`Python process exited (code=${code})`));
      delete _pending[id];
    }
  });
}

function _handleMessage(msg) {
  if (msg.type === 'ready') {
    _ready = true;
    console.log(`[PythonBridge] ML Service ready — ${msg.features_count} features available`);
    return;
  }
  if (msg.type === 'error') {
    console.error(`[PythonBridge] Error: ${msg.message}`);
  }
  const id = msg._id;
  if (id && _pending[id]) {
    if (msg.type === 'error') {
      _pending[id].reject(new Error(msg.message));
    } else {
      _pending[id].resolve(msg);
    }
    delete _pending[id];
  }
}

function _send(msg) {
  _ensureProcess();
  const id = ++_seq;
  msg._id = id;
  _proc.stdin.write(JSON.stringify(msg) + '\n');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      delete _pending[id];
      reject(new Error('Python ML service timeout'));
    }, msg.type === 'train' ? 300000 : 15000);
    _pending[id] = {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    };
  });
}

async function waitForReady(timeoutMs = 30000) {
  _ensureProcess();
  const start = Date.now();
  while (!_ready && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (!_ready) throw new Error('Python ML service failed to become ready');
}

async function predict(symbol, sector, prices, volumes, fundamentals, marketPrices) {
  // Circuit breaker check
  if (_circuitBreaker.isOpen) {
    if (Date.now() - _circuitBreaker.lastTripTime > _circuitBreaker.cooldownMs) {
      _circuitBreaker.isOpen = false;
      _circuitBreaker.failures = 0;
      _circuitBreaker.lastError = null;
      console.log('[PythonBridge] Circuit breaker reset — attempting prediction');
      emitter.emit('circuitReset', { time: Date.now(), cooldownMs: _circuitBreaker.cooldownMs });
    } else {
      const remaining = Math.round((_circuitBreaker.lastTripTime + _circuitBreaker.cooldownMs - Date.now()) / 1000);
      console.warn(`[PythonBridge] Circuit breaker open (${remaining}s remaining), skipping ML for ${symbol}`);
      return { win_prob: 0.5, model_used: 'fallback', features_used: 0 };
    }
  }
  try {
    const result = await _send({
      type: 'predict',
      symbol,
      sector,
      prices: prices || [],
      volumes: volumes || [],
      fundamentals: fundamentals || {},
      market_prices: marketPrices || [],
    });
    _circuitBreaker.failures = 0;
    return result;
  } catch (e) {
    _circuitBreaker.failures++;
    _circuitBreaker.lastError = e.message;
    if (_circuitBreaker.failures >= _circuitBreaker.threshold) {
      _circuitBreaker.isOpen = true;
      _circuitBreaker.lastTripTime = Date.now();
      _circuitBreaker.totalTrips++;
      console.warn(`[PythonBridge] Circuit breaker TRIPPED after ${_circuitBreaker.failures} failures, cooling down for ${_circuitBreaker.cooldownMs / 1000}s`);
      emitter.emit('circuitTrip', {
        failures: _circuitBreaker.failures,
        threshold: _circuitBreaker.threshold,
        cooldownMs: _circuitBreaker.cooldownMs,
        lastError: e.message,
        totalTrips: _circuitBreaker.totalTrips,
        time: Date.now(),
      });
    }
    console.warn(`[PythonBridge] Predict failed for ${symbol} (failure ${_circuitBreaker.failures}/${_circuitBreaker.threshold}): ${e.message}`);
    return { win_prob: 0.5, model_used: 'fallback', features_used: 0 };
  }
}

async function train() {
  if (_circuitBreaker.isOpen) {
    console.warn('[PythonBridge] Circuit breaker open, skipping training');
    return { status: 'error', message: 'Circuit breaker open' };
  }
  try {
    const result = await _send({ type: 'train' });
    return result;
  } catch (e) {
    console.warn(`[PythonBridge] Train failed: ${e.message}`);
    return { status: 'error', message: e.message };
  }
}

async function getStatus() {
  try {
    return await _send({ type: 'status' });
  } catch (e) {
    return { models_loaded: 0, model_names: [], total_samples: 0, last_training: 0 };
  }
}

function stop() {
  if (_proc && !_proc.killed) {
    _proc.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
    setTimeout(() => {
      if (_proc && !_proc.killed) _proc.kill();
    }, 2000);
  }
}

function getCircuitBreakerStatus() {
  const cb = _circuitBreaker;
  const now = Date.now();
  const remaining = cb.isOpen ? Math.max(0, cb.lastTripTime + cb.cooldownMs - now) : 0;
  return {
    isOpen: cb.isOpen,
    failures: cb.failures,
    threshold: cb.threshold,
    cooldownMs: cb.cooldownMs,
    remainingMs: remaining,
    remainingSec: Math.round(remaining / 1000),
    lastTripTime: cb.lastTripTime,
    totalTrips: cb.totalTrips,
    lastError: cb.lastError,
    processAlive: _proc !== null && !_proc.killed,
    ready: _ready,
    uptimeMs: _startupTime ? now - _startupTime : 0,
  };
}

// Start process immediately
_ensureProcess();

module.exports = { waitForReady, predict, train, getStatus, stop, getCircuitBreakerStatus, emitter };
