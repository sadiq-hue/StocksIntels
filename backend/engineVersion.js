// Engine version / epoch tag.
//
// Bump ENGINE_VERSION when the scoring parameterization changes materially, so
// signals from different eras can be separated and only the current cohort
// counts toward performance, calibration and ML. New rows default to this value
// (see migrations/007_engine_v2_reset.js); every signal also carries it in its
// diagnostics so any row can be traced to the parameter set that produced it.
//
// v2 (Oct 2026): constant-50 composite term removed; ML saturation fixed and the
// model abstains; thresholds not yet re-fit; market hours centralized.
const crypto = require('crypto');

const ENGINE_VERSION = 'v2';

// Short digest of the live scoring parameters, for audit — lets you confirm two
// rows with the same engine_version were actually scored identically.
function paramsHash() {
  try {
    const c = require('./engineConfig').getConfig();
    const fp = JSON.stringify({ weights: c.weights, thresholds: c.thresholds, scoring: c.scoring });
    return crypto.createHash('sha1').update(fp).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

module.exports = { ENGINE_VERSION, paramsHash };
