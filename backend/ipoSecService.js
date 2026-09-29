// IPO & lockup intelligence sourced from SEC EDGAR filings.
//
// SEC has no "IPO calendar" API, so we reconstruct the public IPO pipeline the
// way stockanalysis.com does: EDGAR full-text search for final prospectuses
// (424B4), then read each prospectus for its lock-up terms ("180 days after the
// date of this prospectus", "90 days after …", the restricted-share count, and
// early-release language). The resulting lock-up expiration calendar is derived
// entirely from real filings, and every row links back to its sec.gov document.

const https = require('https');
const zlib = require('zlib');
const axios = require('axios');

// SEC requires a descriptive User-Agent with contact info.
const USER_AGENT = process.env.SEC_USER_AGENT || 'StocksIntels Research stocksintels.com';
const EDGAR_HOST = 'www.sec.gov';
const EDGAR_SEC = 'https://www.sec.gov';
const EDGAR_EFTS = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_DATA = 'https://data.sec.gov';

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h
const _lockupCache = { data: null, ts: 0 };
const _filingsCache = { data: null, ts: 0 };

function _get(url, { json = false, timeout = 25000, redirects = 0 } = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': json ? 'application/json' : 'text/html', 'Accept-Encoding': 'gzip' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        const next = res.headers.location.startsWith('http') ? res.headers.location : `https://${EDGAR_HOST}${res.headers.location}`;
        return resolve(_get(next, { json, timeout, redirects: redirects + 1 }));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') { try { buf = zlib.gunzipSync(buf); } catch { /* not gzip */ } }
        resolve({ status: res.statusCode, body: buf.toString('utf8') });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&rsquo;/g, "'").replace(/&#8217;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ');
}

// "180 days after the date of this prospectus" / "90 days after …". Prospectuses
// often mention several durations (underwriters, option holders, early-release),
// so prefer the longest / most-standard lock-up term, which is the one that
// governs the bulk of restricted shares.
function parseLockupDays(text) {
  const dayRe = /(\d{2,3})\s+days?\s+after\s+(?:the\s+date\s+of\s+this\s+prospectus|the\s+date\s+hereof|the\s+closing\s+of\s+this\s+offering|the\s+completion\s+of\s+this\s+offering|this\s+prospectus|this\s+offering)/gi;
  const monRe = /(\d{1,2})\s+months?\s+after\s+(?:the\s+date\s+of\s+this\s+prospectus|the\s+date\s+hereof|the\s+closing\s+of\s+this\s+offering|the\s+completion\s+of\s+this\s+offering|this\s+prospectus|this\s+offering)/gi;
  const candidates = [];
  let m;
  while ((m = dayRe.exec(text)) !== null) candidates.push({ days: parseInt(m[1], 10), condition: `${m[1]} days after prospectus` });
  while ((m = monRe.exec(text)) !== null) candidates.push({ days: parseInt(m[1], 10) * 30, condition: `${m[1]} months after prospectus` });
  if (candidates.length) {
    // Prefer the industry-standard 180/90; else the longest term.
    candidates.sort((a, b) => {
      const rank = (x) => (x.days === 180 ? 3 : x.days === 90 ? 2 : 1);
      return rank(b) - rank(a) || b.days - a.days;
    });
    return candidates[0];
  }
  return { days: null, condition: 'Lock-up terms not stated' };
}

// Restricted shares that unlock: "up to 75,318,061 restricted shares will be
// eligible for sale … upon expiration of lock-up agreements"
function parseUnlockShares(text) {
  const m = text.match(/([\d,]{5,})\s+(?:restricted\s+)?shares[^.]{0,120}?(?:will be|become)\s+(?:eligible|subject)/i)
    || text.match(/([\d,]{5,})\s+shares[^.]{0,120}lock-?up/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return isFinite(n) && n > 0 ? n : null;
}

// Prefer a longer window (180d) over an early-release clause, and note it.
function parseEarlyRelease(text) {
  if (/early\s+release|earlier\s+release\s+provision|release\s+at\s+the\s+option\s+of\s+the\s+underwriter/i.test(text)) {
    return 'Early-release provisions may unlock shares earlier';
  }
  return null;
}

function extractTickerAndName(displayNames) {
  // "DEEP FISSION, INC.  (FISN)  (CIK 0001918102)"
  const s = (displayNames && displayNames[0]) || '';
  const nameMatch = s.match(/^(.*?)\s*\(([A-Z][A-Z0-9.\-]{0,6})\)\s*\(CIK/i);
  if (nameMatch) {
    return { name: nameMatch[1].replace(/,\s*$/, '').trim(), ticker: nameMatch[2].trim() };
  }
  return { name: s.replace(/\(CIK.*$/, '').trim(), ticker: null };
}

// EDGAR full-text search for recent final prospectuses (424B4).
// EDGAR full-text search for the standard lock-up phrase; the exact-phrase form
// is what EDGAR's index reliably matches (hyphenated/longer queries return 0).
const PROSPECTUS_Q = '"180 days after the date of this prospectus"';

async function searchProspectuses({ startdt, enddt, forms = '424B4', q = PROSPECTUS_Q, limit = 60 }) {
  const url = `${EDGAR_EFTS}?q=${encodeURIComponent(q)}&dateRange=custom&startdt=${startdt}&enddt=${enddt}&forms=${forms}`;
  const r = await _get(url, { json: true });
  if (r.status !== 200) return [];
  try {
    const j = JSON.parse(r.body);
    const hits = j?.hits?.hits || [];
    return hits.slice(0, limit).map((h) => {
      const src = h._source || {};
      const { name, ticker } = extractTickerAndName(src.display_names);
      return {
        cik: (src.ciks && src.ciks[0]) || null,
        name,
        ticker,
        form: src.form,
        prospectusDate: src.file_date,
        accession: (h._id || '').split(':')[0],
        _id: h._id,
      };
    }).filter((x) => x.cik && x.prospectusDate);
  } catch { return []; }
}

// Fetch the primary prospectus document text for an accession, cap size.
async function fetchProspectusText(cik, accession) {
  const accNoDash = String(accession).replace(/-/g, '');
  const idxUrl = `${EDGAR_SEC}/Archives/edgar/data/${Number(cik)}/${accNoDash}/index.json`;
  const ir = await _get(idxUrl, { json: true });
  if (ir.status !== 200) return null;
  let docName = null;
  try {
    const items = JSON.parse(ir.body)?.directory?.item || [];
    // Prefer the primary 424b document
    docName = (items.find((it) => /^d?\d+.*424b\d?\.htm$/i.test(it.name)) || items.find((it) => /\.htm$/i.test(it.name) && !/index/i.test(it.name)) || {}).name;
  } catch { /* ignore */ }
  if (!docName) return null;
  const docUrl = `${EDGAR_SEC}/Archives/edgar/data/${Number(cik)}/${accNoDash}/${docName}`;
  const dr = await _get(docUrl, { timeout: 30000 });
  if (dr.status !== 200 || dr.body.length < 500) return null;
  return { url: docUrl, text: stripHtml(dr.body) };
}

// Market cap for a ticker via quote cache (best effort).
async function marketCapFor(ticker) {
  try {
    const marketService = require('./marketService');
    const q = await marketService.getStockQuote(ticker);
    if (q && q.marketCap) return q.marketCap;
    if (q && q.price) {
      // Fall back to shares outstanding from key metrics if available.
      try {
        const fr = require('./financialReportsService').getFinancialReport;
        const rep = await fr(ticker, 'annual', 2);
        const sh = rep?.data?.keyMetrics?.sharesOutstanding;
        if (sh) return q.price * sh;
      } catch {}
    }
  } catch { /* ignore */ }
  return null;
}

// Build the lock-up expiration calendar from real SEC prospectuses.
async function getLockupCalendar() {
  if (_lockupCache.data && Date.now() - _lockupCache.ts < CACHE_TTL) return _lockupCache.data;

  const now = new Date();
  const end = new Date(now.getTime());
  const start = new Date(now.getTime() - 200 * 24 * 3600 * 1000); // ~6 months back for "recently expired"
  const iso = (d) => d.toISOString().slice(0, 10);
  const hits = await searchProspectuses({ startdt: iso(start), enddt: iso(end), limit: 40 });

  const rows = [];
  // Parse a bounded number of prospectuses (each is large) to keep response time sane.
  const parseTargets = hits.slice(0, 18);
  for (const h of parseTargets) {
    const doc = await fetchProspectusText(h.cik, h.accession);
    if (!doc) continue; // SPAC shells / missing primary doc — skip
    const { days, condition } = parseLockupDays(doc.text);
    if (!days) continue; // no parseable lock-up term — skip
    const shares = parseUnlockShares(doc.text);
    const early = parseEarlyRelease(doc.text);
    const base = makeRow(h, days, shares, condition, doc.url);
    if (early) base.note = early;
    rows.push(base);
  }

  function makeRow(h, days, shares, condition, docUrl) {
    const expDate = days ? new Date(new Date(h.prospectusDate).getTime() + days * 86400000) : null;
    return {
      cik: h.cik,
      ticker: h.ticker,
      name: h.name,
      prospectusDate: h.prospectusDate,
      expirationDate: expDate ? expDate.toISOString().slice(0, 10) : null,
      days,
      condition: condition || 'Lock-up terms not stated',
      shares,
      docUrl: docUrl || null,
      marketCap: null,
    };
  }

  // Attach market cap for the tickers we can resolve.
  const withTicker = rows.filter((r) => r.ticker && r.expirationDate);
  const caps = await Promise.all(withTicker.map(async (r) => ({ t: r.ticker, c: await marketCapFor(r.ticker) })));
  const capMap = new Map(caps.map((c) => [c.t, c.c]));
  for (const r of rows) if (r.ticker && capMap.get(r.ticker)) r.marketCap = capMap.get(r.ticker);

  // Group by time window relative to now.
  const startOfWeek = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; };
  const wk = startOfWeek(now);
  const nextWk = new Date(wk.getTime() + 7 * 86400000);
  const wk2 = new Date(wk.getTime() + 14 * 86400000);
  const future = [];
  let thisWeek = [], nextWeek = [], after = [], expired = [];
  for (const r of rows) {
    if (!r.expirationDate) continue;
    const e = new Date(r.expirationDate + 'T00:00:00');
    if (e < wk) expired.push(r);
    else if (e < nextWk) thisWeek.push(r);
    else if (e < wk2) nextWeek.push(r);
    else after.push(r);
  }
  const byDate = (a, b) => new Date(a.expirationDate) - new Date(b.expirationDate);
  thisWeek.sort(byDate); nextWeek.sort(byDate); after.sort(byDate); expired.sort((a, b) => new Date(b.expirationDate) - new Date(a.expirationDate));

  const data = { thisWeek, nextWeek, after, expired, updatedAt: Date.now() };
  _lockupCache.data = data; _lockupCache.ts = Date.now();
  return data;
}

// Recent SEC IPO filings (424B4/S-1/F-1), for the "Filings" tab.
async function getRecentIpoFilings() {
  if (_filingsCache.data && Date.now() - _filingsCache.ts < CACHE_TTL) return _filingsCache.data;
  const now = new Date();
  const start = new Date(now.getTime() - 120 * 24 * 3600 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const [finalPros, regs] = await Promise.all([
    searchProspectuses({ startdt: iso(start), enddt: iso(now), forms: '424B4', q: '"initial public offering"', limit: 50 }),
    searchProspectuses({ startdt: iso(start), enddt: iso(now), forms: 'S-1', q: '"initial public offering"', limit: 50 }),
  ]);
  const filings = [
    ...finalPros.map((f) => ({ ...f, stage: 'Final (424B4)' })),
    ...regs.map((f) => ({ ...f, stage: 'Registration (S-1)' })),
  ].sort((a, b) => new Date(b.prospectusDate) - new Date(a.prospectusDate));
  const data = { filings, updatedAt: Date.now() };
  _filingsCache.data = data; _filingsCache.ts = Date.now();
  return data;
}

module.exports = { getLockupCalendar, getRecentIpoFilings };