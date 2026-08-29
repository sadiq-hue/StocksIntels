// Period-kind classifier shared by the NSE report detector (which labels new
// PDF filings) and the one-off re-parse tool (which re-labels existing rows).
//
// Labels are consumed by:
//  - financialReportsService.buildLocalNseReport — treats anything other than
//    'annual' as interim for KPI/grid fallback logic
//  - the frontend (FinancialsPage) — recognizes 'quarterly' and 'half_year'
//  - the LLM parser prompt (jsParser.buildPrompt) — period-aware extraction

// First pass over the filename/slug (e.g. AfricanFinancials "ir-h1"/"ir-q3").
const RE_HALF = /\b(?:half[- ]?year(?:ly)?|h1\b|h2\b|hy\b|six[- ]?month(?:s)?|6[- ]?month(?:s)?|semi[-\s]?annual)\b/i;
const RE_QUARTER = /\bq[1-4]\b|(?:three|3|nine|9)[-\s]?month(?:s)?|\bquarter(?:ly)?\b|\b1[st]?\s*(?:q|quarter)\b/i;
const RE_ANNUAL = /\b(?:year[- ]?ly[- ]?ended|year[- ]?ended|for the year|full[- ]?year|annual|fiscal[- ]?year|12[- ]?month(?:s)?)\b/i;

function monthOf(dateLike) {
  if (!dateLike) return null;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  return d.getUTCMonth() + 1;
}

// Annual vs interim/quarterly, derived from the (often abbrev.) report type in
// the filename/slug. `periodEnd` disambiguates cue-less interim PDFs (e.g.
// "period ended 30-Jun" -> half_year, "31-Mar"/"30-Sep" -> quarterly).
function inferPeriodType(filename, periodEnd) {
  const f = String(filename || '').toLowerCase();
  if (RE_HALF.test(f)) return 'half_year';
  if (RE_QUARTER.test(f)) return 'quarterly';
  // Explicit annual signals beat the month heuristic so a "year ended 30 Jun"
  // statement for a June-FYE company is never demoted to interim. A bare
  // "Audited ..." label also implies full-year (interims are unaudited), while
  // "unaudited"/"un-audited" interims must be neutralized first.
  const annualWords = RE_ANNUAL.test(f) || /\baudited\b/i.test(f.replace(/un[- ]?audited/gi, 'interim'));
  if (annualWords) return 'annual';
  const mon = monthOf(periodEnd);
  if (mon === 6) return 'half_year';
  if (mon === 3 || mon === 9) return 'quarterly';
  return 'annual';
}

module.exports = { inferPeriodType, monthOf };