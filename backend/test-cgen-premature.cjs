require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const { evaluateForwardPrediction } = require('./signalService');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
}

console.log('── evaluateForwardPrediction: the CGEN 257.50 vs 300 mid-range case ──');

// The CGEN 257.50 swing: stop 213.08, target 358.82, current price ~300 (the
// "premature close" screen's +16.5% mark). 300 is neither <= stop nor >= target,
// so this MUST stay pending — the old code stamped a fake +16.5% / resolved onto
// a still-open idea.
const cgen = { action: 'buy', price: 257.5, stopLoss: 213.08, target1: 358.82 };
const out = evaluateForwardPrediction(cgen, 300.00);
check('mid-range buy at +16.5% returns "pending" (not resolved)', out.status === 'pending');

// Genuine resolutions still fire:
check('stop hit (213) resolves loss', evaluateForwardPrediction(cgen, 210).correct === false);
check('target hit (360) resolves win', evaluateForwardPrediction(cgen, 360).correct === true);
check('close to entry stays pending', evaluateForwardPrediction(cgen, 258).status === 'pending');

console.log('\n── resolver source invariant ──');
const src = fs.readFileSync(__dirname + '/signalService.js', 'utf8');
// The stamp `pred.resolvedAt = Date.now(); pred.actualReturn = actualReturn;`
// must NOT be done unconditionally ahead of the resolved-branch check anymore.
const buggy = src.includes('const actualReturn = Math.round(((currentPrice - pred.price) / pred.price) * 1000) / 10;\n      pred.resolvedAt = Date.now();\n      pred.actualReturn = actualReturn;');
check('No unconditional resolvedAt/actualReturn stamp before the status branch', !buggy);

// Root cause of the trailing "0.0%" on the open 300-position: the DB restore path
// mapped actual_return = NULL through bare Number(NULL) -> 0. Uppercase the guard
// so a restored pending (resolved=false, actual_return=NULL) row stays null -> '—'.
const badRestore = src.includes('resolved: !!row.resolved, actualReturn: Number(row.actual_return)');
check('DB restore: actual_return NULL maps to null, not 0', !badRestore);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);