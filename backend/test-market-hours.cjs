// Verifies the shared session clock. NSE is 09:30-15:00 EAT = 06:30-12:00 UTC;
// US is 09:30-16:00 ET (DST-aware). The engine and the API both read this module,
// so these boundaries are now the single definition of "market open".
process.env.NODE_ENV = 'test';
const mh = require('./marketHours');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}: got ${actual}, expected ${expected}`); }
}
const at = (iso) => new Date(iso);

// 2026-10-05 is a Monday; 2026-10-03 is a Saturday.
check('NSE 06:29 UTC closed', mh.nseOpen(at('2026-10-05T06:29:00Z')), false);
check('NSE 06:30 UTC open', mh.nseOpen(at('2026-10-05T06:30:00Z')), true);
check('NSE 11:59 UTC open', mh.nseOpen(at('2026-10-05T11:59:00Z')), true);
check('NSE 12:00 UTC closed', mh.nseOpen(at('2026-10-05T12:00:00Z')), false);
check('NSE Saturday closed', mh.nseOpen(at('2026-10-03T09:00:00Z')), false);
check('NSE Sunday closed', mh.nseOpen(at('2026-10-04T09:00:00Z')), false);

// October = EDT (UTC-4): US session 13:30-20:00 UTC.
check('US 13:29 UTC (EDT) closed', mh.usOpen(at('2026-10-05T13:29:00Z')), false);
check('US 13:30 UTC (EDT) open', mh.usOpen(at('2026-10-05T13:30:00Z')), true);
check('US 19:59 UTC (EDT) open', mh.usOpen(at('2026-10-05T19:59:00Z')), true);
check('US 20:00 UTC (EDT) closed', mh.usOpen(at('2026-10-05T20:00:00Z')), false);

// January = EST (UTC-5): US session 14:30-21:00 UTC.
check('US 14:29 UTC (EST) closed', mh.usOpen(at('2026-01-05T14:29:00Z')), false);
check('US 14:30 UTC (EST) open', mh.usOpen(at('2026-01-05T14:30:00Z')), true);

// The engine's old NSE window opened 30 min early; 06:00 UTC must now be closed.
check('NSE old 06:00 UTC now closed', mh.nseOpen(at('2026-10-05T06:00:00Z')), false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
