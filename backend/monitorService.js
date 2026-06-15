// Monitor Service — degradation tracking, drift detection, health logging.
// Periodically evaluates signal quality and logs engine health.

const { pool } = require('./db');

// ─── State ──────────────────────────────────────────────────────────────────
let _degradationHistory = [];
let _lastHealthLog = 0;
let _alertCallbacks = [];
const HEALTH_LOG_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_DEGRADATION_HISTORY = 100;
const DEGRADATION_THRESHOLD = 0.15; // 15% drop triggers alert

function onAlert(cb) {
  _alertCallbacks.push(cb);
}

function triggerAlert(type, message, data = {}) {
  const entry = { type, message, data, timestamp: new Date().toISOString() };
  for (const cb of _alertCallbacks) cb(entry);
  if (type === 'critical') {
    console.error(`[Monitor] CRITICAL: ${message}`);
  } else if (type === 'warning') {
    console.warn(`[Monitor] WARNING: ${message}`);
  }
}

// ─── Degradation Detection ──────────────────────────────────────────────────
// Tracks rolling win rate over time and alerts on significant drops.
function trackSignalQuality(performanceStats) {
  if (!performanceStats || performanceStats.total < 10) return;

  const winRate = performanceStats.winRate || 0;
  _degradationHistory.push({ ts: Date.now(), winRate, total: performanceStats.total });

  // Keep rolling window
  if (_degradationHistory.length > MAX_DEGRADATION_HISTORY) {
    _degradationHistory = _degradationHistory.slice(-MAX_DEGRADATION_HISTORY);
  }

  // Check for degradation: compare recent 20 vs prior 20
  if (_degradationHistory.length >= 40) {
    const recent = _degradationHistory.slice(-20);
    const prior = _degradationHistory.slice(-40, -20);
    const recentAvg = recent.reduce((s, e) => s + e.winRate, 0) / recent.length;
    const priorAvg = prior.reduce((s, e) => s + e.winRate, 0) / prior.length;

    const drop = priorAvg > 0 ? (priorAvg - recentAvg) / priorAvg : 0;
    if (drop > DEGRADATION_THRESHOLD) {
      triggerAlert('warning', `Signal degradation detected: ${Math.round(drop * 100)}% drop in win rate`, {
        priorAvg: Math.round(priorAvg * 10) / 10,
        recentAvg: Math.round(recentAvg * 10) / 10,
        drop: Math.round(drop * 100),
      });
    }
  }
}

// ─── Drift Detection ───────────────────────────────────────────────────────
// Detects if signal distribution has shifted significantly.
async function detectSignalDrift() {
  try {
    const result = await pool.query(`
      SELECT signal, COUNT(*) as cnt
      FROM signal_history
      WHERE generated_at > NOW() - INTERVAL '24 hours'
      GROUP BY signal
    `);
    if (!result.rows.length) return null;

    const total = result.rows.reduce((s, r) => s + parseInt(r.cnt), 0);
    const distribution = {};
    for (const row of result.rows) {
      distribution[row.signal] = Math.round((parseInt(row.cnt) / total) * 1000) / 10;
    }

    // Alert if > 60% of signals are Hold or Neutral (engine may be flatlining)
    const holdRatio = (distribution['Hold'] || 0) + (distribution['Reduce'] || 0);
    if (holdRatio > 60) {
      triggerAlert('warning', `Signal drift: ${holdRatio}% neutral signals in last 24h`, {
        distribution,
        holdRatio,
      });
    }

    return distribution;
  } catch { return null; }
}

// ─── Health Log ────────────────────────────────────────────────────────────
// Logs comprehensive engine health to console and optionally to DB.
async function logHealth(engineHealth) {
  const now = Date.now();
  if (now - _lastHealthLog < HEALTH_LOG_INTERVAL) return;
  _lastHealthLog = now;

  const log = {
    ts: new Date().toISOString(),
    status: engineHealth.status,
    winRate: engineHealth.performance?.winRate || 0,
    totalTrades: engineHealth.performance?.total || 0,
    consecutiveLosses: engineHealth.portfolio?.consecutiveLosses || 0,
    regime: engineHealth.regime,
    signalCount: engineHealth.signalCount || 0,
    confidenceMultiplier: engineHealth.confidenceMultiplier || 1,
  };

  console.log(`[Monitor] Health: ${log.status} | Win: ${log.winRate}% | Trades: ${log.totalTrades} | Regime: ${log.regime} | Conf: ${log.confidenceMultiplier}`);

  // Persist to DB for dashboard queries
  try {
    await pool.query(
      `INSERT INTO engine_health (status, win_rate, total_trades, consecutive_losses, regime, signal_count, confidence, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT DO NOTHING`,
      [log.status, log.winRate, log.totalTrades, log.consecutiveLosses, log.regime, log.signalCount, log.confidenceMultiplier]
    );
  } catch { /* table may not exist */ }
}

// ─── Quality Score ─────────────────────────────────────────────────────────
// Composite quality score (0-100) for the engine's recent performance.
function getQualityScore(engineHealth) {
  if (!engineHealth) return 50;
  let score = 50;

  // Win rate contribution
  const wr = engineHealth.performance?.winRate || 0;
  if (wr > 60) score += 20;
  else if (wr > 50) score += 10;
  else if (wr < 40) score -= 15;
  else if (wr < 30) score -= 25;

  // Consecutive losses
  const consLosses = engineHealth.portfolio?.consecutiveLosses || 0;
  if (consLosses >= 5) score -= 20;
  else if (consLosses >= 3) score -= 10;

  // Confidence multiplier
  const cm = engineHealth.confidenceMultiplier || 1;
  if (cm < 0.7) score -= 15;
  else if (cm < 0.9) score -= 5;

  // Active signals
  const sc = engineHealth.signalCount || 0;
  if (sc < 10) score -= 10;

  return Math.max(0, Math.min(100, score));
}

module.exports = {
  onAlert, triggerAlert, trackSignalQuality, detectSignalDrift,
  logHealth, getQualityScore,
};
