// Empirical calibration for scenario target probabilities.
//
// The live outcome log records when price crossed T1/T2/T3. Once a horizon has
// enough closed outcomes we convert those cumulative hit rates into a target
// distribution and blend it into the scenario targets. Before the sample is
// large enough we deliberately leave the evidence-based probabilities alone.

const { pool } = require('./db');

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = null;
let cacheAt = 0;
let inflight = null;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

async function refresh() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await pool.query(`
      SELECT o.horizon, o.target1_hit_at, o.target2_hit_at, o.target3_hit_at,
             o.result, o.close_reason
      FROM signal_outcomes o
      WHERE o.source = 'live'
        AND COALESCE(o.signal_generated_at, o.recorded_at) > NOW() - INTERVAL '365 days'
        AND o.result IS NOT NULL
    `);
    const buckets = new Map();
    for (const r of res.rows) {
      const horizon = r.horizon || 'legacy';
      if (!buckets.has(horizon)) {
        buckets.set(horizon, { samples: 0, minimumHits: 0, averageHits: 0, extendedHits: 0 });
      }
      const b = buckets.get(horizon);
      b.samples++;
      const won = r.result === 'win';
      if (r.target1_hit_at || won) b.minimumHits++;
      if (r.target2_hit_at) b.averageHits++;
      if (r.target3_hit_at) b.extendedHits++;
    }
    const out = {};
    for (const [horizon, b] of buckets.entries()) {
      out[horizon] = {
        samples: b.samples,
        minimumHitRate: b.samples ? b.minimumHits / b.samples : null,
        averageHitRate: b.samples ? b.averageHits / b.samples : null,
        extendedHitRate: b.samples ? b.extendedHits / b.samples : null,
        calibrated: b.samples >= 30,
      };
    }
    cache = out;
    cacheAt = Date.now();
    return out;
  })().finally(() => { inflight = null; });
  return inflight;
}

function getForHorizon(horizon) {
  const key = String(horizon || 'legacy');
  const c = cache?.[key];
  if (!c || !c.calibrated) return null;
  return c;
}

function applyToTargets(targets, horizon) {
  if (!targets?.available) return targets;
  const c = getForHorizon(horizon);
  if (!c) return targets;
  const min = clamp(c.minimumHitRate ?? 0, 0, 0.95);
  const avg = clamp(Math.min(c.averageHitRate ?? 0, min), 0, 0.95);
  const ext = targets.extended != null ? clamp(Math.min(c.extendedHitRate ?? 0, avg), 0, 0.95) : 0;
  // Convert cumulative hit rates into a distribution over the maximum target
  // reached: minimum-only, average-only, extended. Failure is excluded here
  // because the existing scenario object prices only its target levels.
  let wMin = Math.max(0.001, min - avg);
  let wAvg = Math.max(0.001, avg - ext);
  let wExt = targets.extended != null ? Math.max(0, ext) : 0;
  const total = wMin + wAvg + wExt;
  if (!(total > 0)) return targets;
  wMin /= total; wAvg /= total; wExt /= total;
  const probabilities = {
    minimum: Math.round(wMin * 1000) / 1000,
    average: Math.round(wAvg * 1000) / 1000,
    extended: Math.round(wExt * 1000) / 1000,
  };
  const expected = Math.round(
    (targets.minimum * probabilities.minimum
      + targets.average * probabilities.average
      + (targets.extended != null ? targets.extended * probabilities.extended : 0))
    * 100
  ) / 100;
  return {
    ...targets,
    probabilities,
    expected,
    calibration: {
      samples: c.samples,
      minimumHitRate: c.minimumHitRate,
      averageHitRate: c.averageHitRate,
      extendedHitRate: c.extendedHitRate,
    },
  };
}

async function getStats() {
  if (Date.now() - cacheAt > CACHE_TTL_MS) await refresh();
  return cache || {};
}

module.exports = { refresh, getForHorizon, applyToTargets, getStats };
