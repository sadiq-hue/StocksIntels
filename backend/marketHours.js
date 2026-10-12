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

// NGX (Lagos, WAT = UTC+1, no DST): continuous 09:30-16:00.
const NGX_OPEN_WAT_MIN = 9 * 60 + 30;   // 09:30 WAT = 08:30 UTC
const NGX_CLOSE_WAT_MIN = 16 * 60;       // 16:00 WAT = 15:00 UTC
// JSE (Johannesburg, SAST = UTC+2, no DST): continuous 09:00-16:50.
const JSE_OPEN_SAST_MIN = 9 * 60;        // 09:00 SAST = 07:00 UTC
const JSE_CLOSE_SAST_MIN = 16 * 60 + 50; // 16:50 SAST = 14:50 UTC

const EAT_OFFSET_MIN = 180;             // UTC+3, Kenya has no DST
const WAT_OFFSET_MIN = 60;              // UTC+1, Nigeria has no DST
const SAST_OFFSET_MIN = 120;            // UTC+2, South Africa has no DST

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

function watMinutes(now = new Date()) {
  return (((utcMinutes(now) + WAT_OFFSET_MIN) % 1440) + 1440) % 1440;
}

function sastMinutes(now = new Date()) {
  return (((utcMinutes(now) + SAST_OFFSET_MIN) % 1440) + 1440) % 1440;
}

function ngxOpen(now = new Date()) {
  if (isWeekend(now)) return false;
  const m = watMinutes(now);
  return m >= NGX_OPEN_WAT_MIN && m < NGX_CLOSE_WAT_MIN;
}

function jseOpen(now = new Date()) {
  if (isWeekend(now)) return false;
  const m = sastMinutes(now);
  return m >= JSE_OPEN_SAST_MIN && m < JSE_CLOSE_SAST_MIN;
}

module.exports = {
  NSE_OPEN_EAT_MIN,
  NSE_CLOSE_EAT_MIN,
  US_OPEN_ET_MIN,
  US_CLOSE_ET_MIN,
  NGX_OPEN_WAT_MIN,
  NGX_CLOSE_WAT_MIN,
  JSE_OPEN_SAST_MIN,
  JSE_CLOSE_SAST_MIN,
  EAT_OFFSET_MIN,
  WAT_OFFSET_MIN,
  SAST_OFFSET_MIN,
  isWeekend,
  utcMinutes,
  eatMinutes,
  etMinutes,
  watMinutes,
  sastMinutes,
  nseOpen,
  usOpen,
  ngxOpen,
  jseOpen,
};
