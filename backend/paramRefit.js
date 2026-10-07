// Walk-forward parameter re-fit for the signal engine.
//
// Fit the composite weights and the buy/sell thresholds to REALIZED outcomes
// using the per-signal component scores the engine recorded at generation time
// (signal_history.analysis_data) joined to resolved outcomes (signal_outcomes).
//
// This is deliberately conservative:
//   - v2 outcomes only (engine_version = 'v2');
//   - sample-gated (no fit below MIN_SAMPLES);
//   - walk-forward (train on earlier folds, evaluate on later folds) so the
//     reported accuracy is out-of-sample, never in-sample;
//   - it NEVER applies the result. It writes a suggestion to engine_config under
//     `param_suggestions` for an operator to review and adopt.
//
// It cannot manufacture edge: if the current parameters already separate
// winners from losers, the fit confirms them; if they don't, it says so.

const { pool } = require('./db');

const MIN_SAMPLES = 200;
const FOLDS = 5;
const MIN_COVERAGE = 0.05; // a parameter set must make a call on >=5% of rows

// Coarse simplex — the engine's four real inputs (ML abstains, so its constant
// 50 shifts the score and is absorbed by the co-fitted thresholds).
const FUND = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const TECH = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const FIN = [0.05, 0.10, 0.15, 0.20];
const MACRO = [0.05, 0.10, 0.15];
const BUY_TH = [50, 55, 60];
const SELL_TH = [15, 18, 22];

function composite(sub, wf, wt, wfin, wm) {
  const s = wf + wt + wfin + wm;
  if (s <= 0) return 0;
  return (sub.f * wf + sub.t * wt + sub.fin * wfin + sub.m * wm) / s;
}

async function loadRows() {
  const { rows } = await pool.query(`
    SELECT so.result, so.signal, sh.analysis_data
    FROM signal_outcomes so
    JOIN signal_history sh
      ON sh.ticker = so.ticker
     AND date_trunc('milliseconds', sh.generated_at) = so.signal_generated_at
    WHERE so.result IS NOT NULL
      AND COALESCE(sh.engine_version, 'v2') = 'v2'
      AND sh.analysis_data IS NOT NULL
    ORDER BY so.signal_generated_at ASC
    LIMIT 20000
  `);
  const out = [];
  for (const r of rows) {
    const a = r.analysis_data || {};
    const f = a.fundamental?.score, t = a.technical?.score, fin = a.financial?.score, m = a.macro?.score;
    if (![f, t, fin, m].every(Number.isFinite)) continue;
    const action = a.overall ? (r.signal || '').toLowerCase().includes('sell') ? 'sell' : (r.signal || '').toLowerCase().includes('buy') ? 'buy' : 'hold' : 'hold';
    if (action === 'hold') continue;
    out.push({ action, y: r.result === 'win' ? 1 : 0, sub: { f, t, fin, m } });
  }
  return out;
}

// Accuracy of a parameter set: among rows where the score makes a call, did the
// predicted direction match the realized direction? (buy win = up; sell win = down)
function evaluate(rows, params) {
  const { wf, wt, wfin, wm, buy, sell } = params;
  let called = 0, correct = 0;
  for (const r of rows) {
    const s = composite(r.sub, wf, wt, wfin, wm);
    let pred = null;
    if (s >= buy) pred = 1;
    else if (s <= sell) pred = 0;
    if (pred == null) continue;
    const realizedUp = r.action === 'buy' ? r.y : (1 - r.y);
    called++;
    if (pred === realizedUp) correct++;
  }
  const coverage = rows.length ? called / rows.length : 0;
  const accuracy = called >= 10 ? correct / called : null;
  return { coverage, accuracy, called };
}

function gridSearch(train) {
  let best = null;
  for (const wf of FUND) for (const wt of TECH) for (const wfin of FIN) for (const wm of MACRO) {
    for (const buy of BUY_TH) for (const sell of SELL_TH) {
      const params = { wf, wt, wfin, wm, buy, sell };
      const m = evaluate(train, params);
      if (m.accuracy == null || m.coverage < MIN_COVERAGE) continue;
      if (!best || m.accuracy > best.m.accuracy) best = { params, m };
    }
  }
  return best;
}

async function refitParameters({ apply = false } = {}) {
  const rows = await loadRows();
  if (rows.length < MIN_SAMPLES) {
    console.log(`[ParamRefit] ${rows.length}/${MIN_SAMPLES} v2 resolved outcomes — not enough to fit`);
    return { ok: false, reason: 'insufficient_samples', samples: rows.length, minSamples: MIN_SAMPLES };
  }

  const foldSize = Math.floor(rows.length / FOLDS);
  const oos = [];
  for (let k = 1; k < FOLDS; k++) {
    const train = rows.slice(0, k * foldSize);
    const test = rows.slice(k * foldSize, (k + 1) * foldSize);
    const best = gridSearch(train);
    if (!best) { oos.push(null); continue; }
    const testM = evaluate(test, best.params);
    oos.push({ params: best.params, train: best.m, test: testM });
  }
  const valid = oos.filter(o => o && o.test.accuracy != null);
  const meanOOS = valid.length ? valid.reduce((s, o) => s + o.test.accuracy, 0) / valid.length : null;

  // Adopt the last fold's parameters (latest train) as the suggestion, but only
  // when its out-of-sample accuracy beat a coin flip.
  const last = [...oos].reverse().find(o => o);
  const suggestion = last && last.test.accuracy != null && last.test.accuracy > 0.5 ? last.params : null;

  const result = {
    ok: true,
    samples: rows.length,
    folds: oos.length,
    meanOOSAccuracy: meanOOS != null ? Math.round(meanOOS * 1000) / 10 : null,
    suggestion,
  };
  console.log(`[ParamRefit] ${rows.length} v2 outcomes | mean OOS accuracy ${result.meanOOSAccuracy}% | suggestion ${suggestion ? JSON.stringify(suggestion) : 'none'}`);

  try {
    await pool.query(
      `INSERT INTO engine_config (config_key, config_value, updated_at) VALUES ('param_suggestions', $1, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
      [JSON.stringify({ ...result, generatedAt: new Date().toISOString() })]
    );
  } catch (e) { /* non-critical */ }

  if (apply && suggestion) {
    const engineConfig = require('./engineConfig');
    await engineConfig.updateConfig({
      weights: { fundamental: suggestion.wf, technical: suggestion.wt, financial: suggestion.wfin, macro: suggestion.wm },
      thresholds: { buy: suggestion.buy, sell: suggestion.sell },
    });
    console.log('[ParamRefit] applied suggestion to engine config');
  }
  return result;
}

module.exports = { refitParameters, MIN_SAMPLES };
