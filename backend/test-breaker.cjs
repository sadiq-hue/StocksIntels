// Verifies the loss-streak circuit breaker can never reach 0. It multiplied
// every signal's confidence (signalService.js:5344), so a 0 muted the whole
// universe - production logged "461 raw signals (0 non-Hold)" for four days
// while sitting at consecutive_losses = 9. The streak only clears on a booked
// win, which a muted engine can never open a position to earn, so the state was
// unrecoverable. The floor keeps a bad run throttling conviction hard while
// leaving the engine able to recover.
process.env.NODE_ENV = 'test';
require('dotenv').config();
const { updatePortfolioRisk } = require('./riskManager');

const priceHistory = [100, 101, 102];
const breaker = (streak) =>
  updatePortfolioRisk({ consecutiveLosses: streak }, 'TEST', 100, priceHistory, 'buy').circuitBreaker;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${name}: got ${actual}, expected ${expected}`); }
}

// 1. A healthy book is unthrottled.
check('streak 0 -> 1', breaker(0), 1);
check('streak 2 -> 1', breaker(2), 1);

// 2. The existing tiers are unchanged.
check('streak 3 -> 0.5', breaker(3), 0.5);
check('streak 4 -> 0.5', breaker(4), 0.5);
check('streak 5 -> 0.25', breaker(5), 0.25);
check('streak 7 -> 0.25', breaker(7), 0.25);

// 3. The regression itself: 8+ throttles to the floor, never to 0.
check('streak 8 -> 0.25', breaker(8), 0.25);
check('streak 9 -> 0.25', breaker(9), 0.25);
check('streak 20 -> 0.25', breaker(20), 0.25);

// 4. No streak at all must not yield NaN/undefined, which would also zero
//    confidence downstream.
check('missing streak -> 1', breaker(undefined), 1);

// 5. The invariant that matters: the breaker is strictly positive for any
//    streak, so confidence can always be regenerated.
let everZero = false;
for (let s = 0; s <= 60; s++) if (breaker(s) <= 0) everZero = true;
check('no streak in 0..60 mutes the engine', everZero, false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
