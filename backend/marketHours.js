// Single source of truth for exchange trading sessions.
//
// The signal engine and the API used to hard-code their own hours and disagreed:
// the engine treated NSE as 09:00-15:00 EAT, the API/UI as 09:30-15:30 EAT.
// NSE's continuous session is 09:30-15:00 EAT (UTC+3, no DST). Import these
// helpers instead of re-deriving the clock math anywhere else.

const NSE_OPEN_EAT_MIN = 9 * 60 + 30;   // 09:30 EAT = 06:30 UTC
const NSE_CLOSE_EAT_MIN = 15 * 60;      // 15:00 EAT = 12:00 UTC
const US_OPEN_ET_MIN = 9 * 60 + 30;     // 09:30 ET
const US_CLOSE_ET_MIN = 16 * 60;        // 16:00 ET

const EAT_OFFSET_MIN = 180;             // UTC+3, Kenya has no DST

function isWeekend(now = new Date()) {
  const d = now.getDay();
  return d === 0 || d === 6;
}

function utcMinutes(now = new Date()) {
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function eatMinutes(now = new Date()) {
  return (((utcMinutes(now) + EAT_OFFSET_MIN) % 1440) + 1440) % 1440;
}

function etMinutes(now = new Date()) {
  // Approximate US DST: Mar–Oct. Matches the engine's existing convention.
  const isDST = now.getMonth() >= 2 && now.getMonth() <= 9;
  return (((utcMinutes(now) + (isDST ? -4 : -5) * 60) % 1440) + 1440) % 1440;
}

function nseOpen(now = new Date()) {
  if (isWeekend(now)) return false;
  const m = eatMinutes(now);
  return m >= NSE_OPEN_EAT_MIN && m < NSE_CLOSE_EAT_MIN;
}

function usOpen(now = new Date()) {
  if (isWeekend(now)) return false;
  const m = etMinutes(now);
  return m >= US_OPEN_ET_MIN && m < US_CLOSE_ET_MIN;
}

module.exports = {
  NSE_OPEN_EAT_MIN,
  NSE_CLOSE_EAT_MIN,
  US_OPEN_ET_MIN,
  US_CLOSE_ET_MIN,
  EAT_OFFSET_MIN,
  isWeekend,
  utcMinutes,
  eatMinutes,
  etMinutes,
  nseOpen,
  usOpen,
};
