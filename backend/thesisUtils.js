/**
 * Shared definition of "is this the same trading call?".
 *
 * The engine re-derives stop/target levels from a fresh quote on every cycle, so
 * an unchanged idea arrives with a slightly different entry price each hour. Two
 * places need to recognise those as ONE call rather than a new one:
 *
 *   - recordForwardPrediction() / persistSignalOutcome() in signalService: one
 *     open prediction and one outcome row per thesis
 *   - trackSignalOutcomes() in riskManager: do not immediately re-open a position
 *     that has just resolved, or a single idea becomes an endless chain
 *
 * They MUST agree, or the write path, the reported numbers and the position book
 * describe different sets of trades. That is why this lives in its own module
 * rather than in signalService: riskManager is required BY signalService, so
 * signalService cannot be imported from here without a circular dependency, and
 * a copy-pasted predicate silently drifted once already.
 *
 * Thresholds:
 *   ENTRY_DELTA    >=8% re-rate  = a materially different entry -> new thesis
 *   ENTRY_IDENTICAL <=0.5%       = near-identical entry; same thesis unless the
 *                                  reward profile moved materially
 *   PROFILE_DELTA  >=10% drift in target1/entry = a different call
 */

const THESIS_ENTRY_DELTA = 0.08;      // >=8% price re-rate = materially new entry -> distinct thesis
const THESIS_ENTRY_IDENTICAL = 0.005; // near-identical entry (<=0.5%): same thesis unless profile changed
const THESIS_PROFILE_DELTA = 0.10;    // reward-profile (T1/entry) drift of >=10% = a different call

/**
 * @param {{price:number, target1:number|null}} p  the existing thesis
 * @param {number} price                             the new entry price
 * @param {number|null} target1                      the new target1
 * @param {string} action                            'buy' | 'sell' | 'hold'
 */
function isSameThesis(p, price, target1, action) {
  if (action === 'sell') {
    // Sells carry no levels, so only a near-identical reference price counts as
    // the same call.
    return p.price > 0 && price > 0 && Math.abs(p.price - price) / price < THESIS_ENTRY_IDENTICAL;
  }
  if (p.price > 0 && price > 0 && Math.abs(p.price - price) / price >= THESIS_ENTRY_DELTA) return false; // re-rated >=8% -> distinct thesis
  const profileChanged = () => {
    if (!p.target1 || !target1 || !p.price || !price) return false;
    const profile = p.target1 / p.price;
    const profileNow = target1 / price;
    return Math.abs(profile - profileNow) / profileNow >= THESIS_PROFILE_DELTA;
  };
  if (p.price > 0 && price > 0 && Math.abs(p.price - price) / price < THESIS_ENTRY_IDENTICAL) {
    // near-identical entry: same thesis unless the reward profile is materially different
    return !profileChanged();
  }
  // entry band [0.5%, 8%): the reward profile decides
  return !profileChanged();
}

module.exports = {
  isSameThesis,
  THESIS_ENTRY_DELTA,
  THESIS_ENTRY_IDENTICAL,
  THESIS_PROFILE_DELTA,
};
