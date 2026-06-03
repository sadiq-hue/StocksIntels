const fs = require('fs');
let orig = fs.readFileSync('./index_cleaned.js', 'utf8');

// Find the app.get for /api/signals - search for the route
let idx = orig.indexOf("/api/signals'");
if (idx < 0) idx = orig.indexOf('/api/signals"');
console.log('/api/signals at idx:', idx);

// Go back to find the start of the app.get/app.post
if (idx > 0) {
  let start = orig.lastIndexOf('app.', idx);
  console.log('start at:', start);
  if (start >= 0) {
    let end = orig.indexOf('});', start) + 3;
    if (end < 3) end = start + 300;
    console.log('ROUTE:\n' + orig.substring(start, Math.min(end, orig.length)));
  }
}

// Also look at what generateSignals returns by checking the signalService
const sig = require('./signalService');
const result = sig.generateSignals();
console.log('\ngenerateSignals returns type:', typeof result, Array.isArray(result));
if (Array.isArray(result)) {
  console.log('length:', result.length);
  console.log('first keys:', Object.keys(result[0]).slice(0, 10));
} else if (result && typeof result === 'object') {
  console.log('keys:', Object.keys(result).slice(0, 20));
  console.log('total:', result.total);
}
