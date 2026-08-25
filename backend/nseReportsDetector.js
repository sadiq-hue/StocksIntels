// Automated NSE financial-report detector.
//
// Scrapes the official NSE "Financial Results" page (nse.co.ke), discovers newly
// published PDF reports, matches them to tracked NSE tickers, downloads + parses
// the PDF via the shared jsParser pipeline, stores the result in financial_statements,
// and alerts admin users both in-app and by email.
//
// NOTE: nse.co.ke returns malformed HTTP headers that Node's strict parser rejects,
// so every request MUST use `insecureHTTPParser: true`.

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { pool } = require('./db');
const { storePdfReport } = require('./financialStatementsStore');
const mailer = require('./mailer');

const NSE_FINANCIALS_URL = 'https://www.nse.co.ke/financial-results/';
const NSE_ANNOUNCEMENTS_URL = 'https://www.nse.co.ke/listed-company-announcements/';
const NSE_ORIGIN = 'https://www.nse.co.ke';
const DETECT_INTERVAL_MS = (parseInt(process.env.NSE_REPORT_DETECT_INTERVAL_MIN, 10) || 360) * 60 * 1000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

// ticker -> company display name (sourced from mystocks.co.ke listings)
const NSE_NAMES = {
  ABSA: 'ABSA Bank Kenya Plc', ALP: 'Africa Logistics Properties Industrial I-REIT', AMAC: 'Africa Mega Agricorp Plc',
  ARM: 'ARM Cement Plc', BAMB: 'Bamburi Cement', BAT: 'British American Tobacco Kenya Plc', BKG: 'BK Group Plc',
  BBK: 'Bank of Baroda (K) Ltd', BOC: 'BOC Kenya Plc', BRIT: 'Britam Holdings Plc', CABL: 'East African Cables Plc', CARB: 'Carbacid Investments Plc',
  CGEN: 'Car and General (K)', CFCI: 'CFC Insurance Holdings Ltd', CIC: 'CIC Insurance Group', COOP: 'Co-operative Bank of Kenya', CRWN: 'Crown Paints Kenya Plc',
  CTUM: 'Centum Investment Company Plc', DCON: 'Deacons (East Africa) Plc', DTK: 'Diamond Trust Bank Kenya',
  EABL: 'East African Breweries', EGAD: 'Eaagads', EQTY: 'Equity Group Holdings Plc', EVRD: 'Eveready East Africa',
  FTGH: 'Flame Tree Group Holdings', FABL: 'Family Bank Limited', GLD: 'ABSA NewGold ETF',   HAFC: 'HF Group PLC', HAFR: 'Home Afrika', HBE: 'Homeboyz Entertainment Plc',
  HFCK: 'HFCB Group Plc', IMH: 'I & M Holdings Plc', JUB: 'Jubilee Holdings', KAPC: 'Kapchorua Tea Kenya Plc',
  KCB: 'KCB Group Plc', KEGN: 'Kenya Electricity Generating Company Plc', KNRE: 'Kenya Re-Insurance Corporation',
  KPC: 'Kenya Pipeline Company Plc', KPLC: 'Kenya Power and Lighting Company Plc', KQ: 'Kenya Airways Plc',
  KMRC: 'Kenya Mortgage Refinance Company Plc',
  KUKZ: 'Kakuzi Plc', KURV: 'Kurwitu Ventures', LAPR: 'LAPTrust Imara Income-REIT', LBTY: 'Liberty Kenya Holdings',
  LIMT: 'Limuru Tea Plc', LKL: 'Longhorn Publishers Plc', MSC: 'Mumias Sugar Company', NBV: 'Nairobi Business Ventures',
  NCBA: 'NCBA Group Plc', NMG: 'Nation Media Group Plc', NSE: 'Nairobi Securities Exchange Plc', OCH: 'Olympia Capital Holdings',
  PORT: 'East African Portland Cement', SASN: 'Sasini Plc', SBIC: 'Stanbic Holdings Plc', SCAN: 'WPP ScanGroup Plc',
  SCBK: 'Standard Chartered Bank Kenya', SCOM: 'Safaricom Plc', SGL: 'Standard Group Plc', SKL: 'Shri Krishana Overseas Plc',
  SLAM: 'Sanlam Kenya Plc', SMER: 'Sameer Africa Plc', SMWF: 'Satrix MSCI World Feeder ETF',
  TCL: 'Trans-Century Plc', TOTL: 'TotalEnergies Marketing Kenya Plc', TPSE: 'TPS Eastern Africa (Serena)',
  UCHM: 'Uchumi Supermarket Plc', UMME: 'Umeme', UNGA: 'Unga Group', WTK: 'Williamson Tea Kenya Plc', XPRS: 'Express Kenya Plc',
  KORCH: 'Kenya Orchards Plc', FHOK: 'Friends of the Earth Kenya Plc', ILAM: 'ILAM Fahari I-REIT',
};

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const CORP_SUFFIXES = /\b(plc|ltd|limited|llp|inc|corp|corporation|group|holdings|company|companies|international)\b/gi;
// Only treat a PDF as a financial report if its filename mentions a report-like term.
// This filters out NSE's own non-report documents (strategy, pricelist, training calendar, etc.).
const FIN_KEYWORDS = /(result|financial|statement|report|annual|interim|quarter|balance|account|audited|unaudited|earnings|disclosure|abridged)/i;
// Exclude non-statement announcements (AGM notices, dividend/cautionary alerts)
// so we don't waste OCR spend parsing documents with no financial figures.
const EXCLUDE_NONSTATEMENT = /(notice|agm|cautionary|resolution|agenda|proxy|circular|announcement|appointment|director)/i;
function isFinancialReport(filename) {
  return FIN_KEYWORDS.test(filename) && !EXCLUDE_NONSTATEMENT.test(filename);
}

function norm(s) {
  return (s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ticker -> array of normalized alias strings used for filename matching
const ALIASES = {}; // alias -> ticker
function addAlias(ticker, raw) {
  const a = norm(raw);
  if (a.length >= 3 && !ALIASES[a]) ALIASES[a] = ticker;
}
for (const [ticker, name] of Object.entries(NSE_NAMES)) {
  const base = name.replace(/\(.*?\)/, '').trim();
  addAlias(ticker, base);
  addAlias(ticker, base.replace(CORP_SUFFIXES, ' '));
  addAlias(ticker, ticker); // some NSE PDFs use the ticker symbol as the company name
}
// Manual overrides for naming mismatches between mystocks and NSE PDF filenames
const MANUAL = {
  IMH: ['im group', 'imgroup', 'i m group', 'i&m group', 'im holdings'],
  HFCK: ['hf group', 'hfgroup', 'hfcb group'],
  BKG: ['bk group', 'bk group plc'],
  GLD: ['newgold', 'new gold etf'],
  SLAM: ['sanlam allianz', 'sanlam allianz holdings', 'sanlam kenya', 'sanlam kenya plc'],
  CGEN: ['car general', 'car general kenya'],
  CTUM: ['centum', 'centum plc'],
  KEGN: ['kengen', 'kenya electricity generating'],
  KPLC: ['kenya power', 'kenya power lighting', 'kenya power lighting company'],
  TPRI: ['tps', 'serena'],
  BBK: ['baroda', 'bank of baroda'],
  CFCI: ['cfc insurance'],
  HAFC: ['hf group plc'],
  COOP: ['co op bank', 'co-operative bank', 'coop bank'],
  FABL: ['family bank'],
  TCL: ['trans century', 'trans-century', 'transcentury'],
  LAPR: ['laptrust imara', 'laptrust imara i reit'],
  CRWN: ['crown paints'],
  KAPC: ['kapchorua tea'],
  NBV: ['nairobi business ventures'],
  OCH: ['olympia capital'],
  SASN: ['sasini'],
  EGAD: ['eaagads'],
  DTK: ['diamond trust bank'],
  PORT: ['portland cement'],
  UMME: ['umeme'],
  UNGA: ['unga'],
  WTK: ['williamson tea'],
  SMER: ['sameer', 'sameer africa'],
  HBE: ['homeboyz'],
  HAFR: ['home afrika'],
};
for (const [ticker, list] of Object.entries(MANUAL)) list.forEach(a => addAlias(ticker, a));

function matchTicker(filename) {
  const fn = norm(filename);
  const compMatch = fn.match(/^(.*?)(plc|ltd|limited|llp)\b/);
  const comp = compMatch ? compMatch[1] : fn;
  // Word-boundary containment so short tickers (e.g. "port") don't match inside
  // unrelated words (e.g. "re-port").
  const wordIncludes = (hay, needle) => {
    const re = new RegExp('(^|[^a-z0-9])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
    return re.test(hay);
  };
  let best = null, bestLen = 0;
  for (const [alias, ticker] of Object.entries(ALIASES)) {
    if (wordIncludes(fn, alias) || wordIncludes(comp, alias)) {
      if (alias.length > bestLen) { bestLen = alias.length; best = ticker; }
    }
  }
  return best;
}

function extractCompanyName(filename) {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const m = base.match(/^(.*?)\s+(plc|ltd|limited|llp)\b/i);
  return (m ? m[1] : base).replace(/\b(un[- ]?audited|audited|financial|statements?|results?|report|disclosures?|other|for|the|period|ended|as|at|group|year|quarter|q[1-4]|interim|annual|consolidated|company)\b/gi, '').replace(/\s+/g, ' ').trim() || base;
}

function parsePeriodEnd(filename) {
  const f = filename.toLowerCase();
  // 1) DD-Mon-YYYY or DDth-Mon-YYYY (NSE filenames with ordinal suffixes)
  const m = f.match(/(\d{1,2})(?:st|nd|rd|th)?[- ](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ](\d{4})/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].slice(0, 3)];
    const year = parseInt(m[3], 10);
    const d = new Date(Date.UTC(year, mon, day));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  // 2) Bare year + quarter/half/interim (AfricanFinancials slugs: ke-CODE-2024-ir-q3)
  const ym = f.match(/(\d{4})/);
  if (ym) {
    const year = parseInt(ym[1], 10);
    let mon = 11; // default December (annual)
    const qm = f.match(/\bq([1-4])\b/);
    if (qm) mon = [2, 5, 8, 11][parseInt(qm[1], 10) - 1]; // q1..q4 -> Mar/Jun/Sep/Dec
    else if (/\b(h2|second half)\b/.test(f)) mon = 11;
    else if (/\b(hy|h1|half|interim)\b/.test(f)) mon = 5; // half-year / interim -> Jun
    const endDay = { 2: 31, 5: 30, 8: 30, 11: 31 }[mon];
    const d = new Date(Date.UTC(year, mon, endDay));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function isAudited(filename) {
  const f = filename.toLowerCase();
  if (/un[- ]?audited|unaudited/.test(f)) return false;
  if (/\baudited\b/.test(f)) return true;
  return null;
}

// Annual vs interim/quarterly, derived from the (often abbrev.) report type in
// the filename/slug (e.g. AfricanFinancials "ir-q3" or NSE "Q3").
function inferPeriodType(filename) {
  const f = filename.toLowerCase();
  // Quarterly cues: Q1-Q4 labels or 3/9-month periods.
  // Half-year / H1 / H2 are 6-month reports — tag as 'annual' so they appear in the
  // history grids alongside full-year data (matching KCB convention).
  if (/\bq[1-4]\b|(?:three|nine|3|9)[-\s]?months?/.test(f)) return 'quarterly';
  return 'annual';
}

function fetchWithParser(targetUrl, asBuffer = false, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('Too many redirects'));
    const req = https.request(targetUrl, {
      method: 'GET',
      insecureHTTPParser: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: asBuffer ? 'application/pdf,*/*' : 'text/html,*/*' },
      timeout: 30000,
    }, res => {
      const finalUrl = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && finalUrl) {
        const next = new URL(finalUrl, targetUrl).toString();
        res.resume();
        return fetchWithParser(next, asBuffer, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      let size = 0;
      res.on('data', c => { size += c.length; if (size > MAX_PDF_BYTES) { req.destroy(); res.resume(); } chunks.push(c); });
      res.on('end', () => {
        if (asBuffer) resolve(Buffer.concat(chunks));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// POST form-encoded (used for NSE's WordPress admin-ajax year filter)
async function postForm(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const req = https.request(targetUrl, {
      method: 'POST', insecureHTTPParser: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,*/*',
      },
      timeout: 30000,
    }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(data); req.end();
  });
}

// NSE "Listed Company Announcements" exposes a year filter (All/2026/2025/…/2015)
// powered by a WordPress admin-ajax action `list_dwnlds`. Calling it per year
// returns the historical financial-report PDFs for FREE — no ScrapingBee, no
// Cloudflare. The filter is by *publication* year, so to cover periods 2022–
// current we iterate those years.
async function scrapeNseAnnouncementsByYear(years) {
  let baseHtml;
  try { baseHtml = await fetchWithParser(NSE_ANNOUNCEMENTS_URL, false); }
  catch (e) { console.error('[NSE-Detector] announcements base fetch failed:', e.message); return []; }
  const nonceM = baseHtml.match(/ajaxnonce["']?\s*[:=]\s*["']?([a-f0-9]+)/i)
    || baseHtml.match(/wp_ajax\s*=\s*\{[^}]*ajaxnonce["']?\s*[:=]\s*["']?([a-f0-9]+)/i);
  const nonce = nonceM ? nonceM[1] : null;
  const ajaxM = baseHtml.match(/ajaxurl["']?\s*[:=]\s*["']([^"']+)["']/i);
  const ajaxurl = ajaxM ? ajaxM[1] : 'https://www.nse.co.ke/wp-admin/admin-ajax.php';
  const cidM = baseHtml.match(/data-cid=["'](\d+)["']/);
  const cid = cidM ? cidM[1] : '15';
  if (!nonce) { console.error('[NSE-Detector] could not find ajax nonce for year filter'); return []; }
  const out = [];
  const seen = new Set();
  for (const year of years) {
    let page = 1;
    while (page <= 10) {
      const body = `action=list_dwnlds&tags=${encodeURIComponent(year)}&security=${nonce}&nse_id=${cid}` + (page > 1 ? `&page=${page}` : '');
      let html = null;
      try { html = await postForm(ajaxurl, body); } catch (e) { console.error(`[NSE-Detector] year ${year} AJAX failed: ${e.message}`); break; }
      if (!html) break;
      const links = [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]);
      let added = 0;
      for (let raw of links) {
        const url = raw.startsWith('http') ? raw : new URL(raw, NSE_ORIGIN).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        const filename = decodeURIComponent(url.split('/').pop());
        if (!isFinancialReport(filename)) continue;
        out.push({ url, filename });
        added++;
      }
      if (added === 0) break; // no new links (end of pagination or unsupported)
      page++;
    }
  }
  return out;
}

// ── Optional Cloudflare bypass via a paid scraping API ───────────────────────
// Opt-in: only used when SCRAPING_API_KEY is set. Providers: 'scrapingbee' | 'zenrows'.
const SCRAPING_API_KEY = process.env.SCRAPING_API_KEY || '';
const SCRAPING_API_PROVIDER = (process.env.SCRAPING_API_PROVIDER || 'scrapingbee').toLowerCase();

async function fetchRaw(apiUrl, asBuffer) {
  return new Promise((resolve, reject) => {
    const req = https.request(apiUrl, { method: 'GET', timeout: 60000, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > MAX_PDF_BYTES) { req.destroy(); res.resume(); } chunks.push(c); });
      res.on('end', () => resolve(asBuffer ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchViaScrapingApi(targetUrl, asBuffer = false) {
  if (!SCRAPING_API_KEY) return null;
  let apiUrl;
  if (SCRAPING_API_PROVIDER === 'zenrows') {
    apiUrl = `https://api.zenrows.com/v1?apikey=${encodeURIComponent(SCRAPING_API_KEY)}&url=${encodeURIComponent(targetUrl)}&js_render=true&antibot=true`;
  } else {
    // scrapingbee (default) — Cloudflare bypass
    apiUrl = `https://app.scrapingbee.com/api/v1?api_key=${encodeURIComponent(SCRAPING_API_KEY)}&url=${encodeURIComponent(targetUrl)}&render_js=true&wait_browser=networkidle0`;
  }
  // Retry with backoff — ScrapingBee throttles concurrent requests (HTTP 429),
  // so a single call may need several attempts under load.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const buf = await fetchRaw(apiUrl, true);
      if (!buf || buf.length === 0) throw new Error('empty response');
      return asBuffer ? buf : buf.toString('utf8');
    } catch (e) {
      if (attempt === maxAttempts) {
        console.error(`[NSE-Detector] scraping API (${SCRAPING_API_PROVIDER}) failed for ${targetUrl}: ${e.message}`);
        return null;
      }
      const delay = 1500 * attempt; // 1.5s, 3s, 4.5s, 6s
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return null;
}

// AfricanFinancials embeds each report inside a Google Drive viewer iframe.
// So: fetch the AF document page (through the scraping API to beat Cloudflare),
// extract the Drive file id, then download the PDF straight from Drive
// (drive.usercontent.google.com serves it without Cloudflare / scraping credits).
async function fetchAfricanFinancialsPdf(docUrl) {
  const html = await fetchViaScrapingApi(docUrl, false);
  if (!html) return null;
  const m = html.match(/drive\.google\.com\/file\/d\/([^/\s"?]+)/)
    || html.match(/itemprop=["']url["'][^>]*content=["']https:\/\/drive\.google\.com\/file\/d\/([^/\s"?]+)/);
  const fileId = m ? (m[1] || m[2]) : null;
  if (!fileId) { console.error(`[NSE-Detector] AF doc page had no Drive embed: ${docUrl}`); return null; }
  const dl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  try {
    const buf = await fetchWithParser(dl, true);
    if (!buf || buf.length < 100) return null;
    return buf;
  } catch (e) {
    console.error(`[NSE-Detector] Drive download failed for ${docUrl}: ${e.message}`);
    return null;
  }
}

// Download a PDF. AfricanFinancials document pages are HTML wrappers around a
// Drive embed, so they go through the AF-specific resolver; everything else is
// fetched directly (NSE returns the PDF bytes directly).
async function downloadPdf(url) {
  if (/africanfinancials\.com/i.test(url)) {
    if (!SCRAPING_API_KEY) return null;
    return fetchAfricanFinancialsPdf(url);
  }
  return fetchWithParser(url, true);
}

// Extract tracked-ticker document links from an AfricanFinancials HTML page.
// AF slugs look like: /document/ke-<CODE>-<YYYY>-<TYPE>-<SEQ>/
// (e.g. ke-scom-2026-ar-00). `ke-` marks Kenya listings.
function extractAfDocLinks(html, { years } = {}) {
  const yearSet = years && years.length ? new Set(years.map(String)) : null;
  const seen = new Set();
  const pdfs = [];
  const links = [...html.matchAll(/href=["']([^"']*\/document\/[a-z]{2}-[a-z0-9]+-\d{4}-[a-z0-9]+-[a-z0-9]+\/?)["']/gi)]
    .map(m => m[1]);
  for (let raw of links) {
    const url = raw.startsWith('http') ? raw : new URL(raw, 'https://africanfinancials.com').toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const filename = decodeURIComponent(url.replace(/\/+$/, '').split('/').pop());
    const slug = filename;
    if (!/^ke-/i.test(slug)) continue; // Kenya only
    const ticker = matchTicker(slug);
    if (!ticker) continue;
    if (yearSet) {
      const y = slug.match(/(\d{4})/);
      if (!y || !yearSet.has(y[1])) continue;
    }
    pdfs.push({ url, filename: slug, ticker, source: 'africanfinancials' });
  }
  return pdfs;
}

// Lightweight recent scan (used by the periodic detector): the first page of the
// AF listing shows the latest Kenya docs — enough to catch anything NSE missed.
// NOTE: AF listing pagination is broken (every page returns page 1), so one fetch
// suffices. Full historical pulls use backfillAfricanFinancials() (sitemap-based).
async function scrapeAfricanFinancialsRecent() {
  if (!SCRAPING_API_KEY) return [];
  const html = await fetchViaScrapingApi('https://africanfinancials.com/kenya-listed-company-documents/', false);
  const pdfs = html ? extractAfDocLinks(html) : [];
  console.log(`[NSE-Detector] africanfinancials (recent): ${pdfs.length} tracked Kenya link(s) found`);
  return pdfs;
}

// Collect every Kenya document URL from AfricanFinancials' document sitemaps
// (document-sitemap1.xml … document-sitemapN.xml). AF's listing pages have
// BROKEN pagination (every page returns page 1), so the sitemaps are the only
// reliable way to enumerate all historical docs. Plain XML — no JS rendering.
async function collectAfDocUrlsFromSitemaps() {
  const collected = new Map(); // url -> true
  const CONC = 3;
  let emptyStreak = 0;
  for (let start = 1; start <= 45; start += CONC) {
    const batch = [];
    for (let i = start; i < start + CONC && i <= 45; i++) batch.push(i);
    const results = await Promise.all(batch.map(i =>
      fetchViaScrapingApi(`https://africanfinancials.com/document-sitemap${i}.xml`, false)
        .then(html => {
          if (!html) return [];
          return [...html.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => /africanfinancials\.com\/document\/ke-/.test(u));
        })
        .catch(() => [])
    ));
    let any = false;
    for (const list of results) for (const u of list) { collected.set(u, true); any = true; }
    emptyStreak = any ? 0 : emptyStreak + 1;
    if (emptyStreak >= 3) break; // sitemaps exhausted
  }
  return [...collected.keys()];
}

// Full historical backfill from AfricanFinancials. Enumerates all Kenya document
// URLs via the sitemaps, filters to the requested years + tracked tickers, then
// downloads each PDF from Google Drive and stores it. One-shot, paid operation
// (ScrapingBee credits) — NOT run on the periodic cycle.
async function backfillAfricanFinancials(years) {
  if (!SCRAPING_API_KEY) return { error: 'SCRAPING_API_KEY not set' };
  const targetYears = (years && years.length ? years : [2024]).map(Number);
  const yearSet = new Set(targetYears.map(String));
  await ensureTable();
  console.log(`[NSE-Detector] AF backfill: fetching document sitemaps...`);
  const allKe = await collectAfDocUrlsFromSitemaps();
  console.log(`[NSE-Detector] AF backfill: ${allKe.length} Kenya doc URL(s) total`);
  const collected = new Map();
  for (const url of allKe) {
    const slug = decodeURIComponent(url.replace(/\/+$/, '').split('/').pop());
    const y = slug.match(/(\d{4})/);
    if (!y || !yearSet.has(y[1])) continue;
    const ticker = matchTicker(slug);
    if (!ticker) continue;
    collected.set(url, { url, filename: slug, ticker, source: 'africanfinancials' });
  }
  const pdfs = [...collected.values()];
  console.log(`[NSE-Detector] AF backfill: ${pdfs.length} tracked Kenya report(s) for ${targetYears.join(', ')}; downloading + parsing...`);
  let stored = 0, parsed = 0, failed = 0, skipped = 0;
  const CONC = 3;
  for (let i = 0; i < pdfs.length; i += CONC) {
    const batch = pdfs.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (pdf) => {
      try {
        const key = crypto.createHash('sha256').update(pdf.url).digest('hex');
        // Skip only if already recorded AND not a prior failure (so a failed
        // download can be retried on a later run, e.g. after API recovery).
        const ex = await pool.query('SELECT parse_status FROM nse_report_filings WHERE filing_key = $1', [key]);
        if (ex.rows.length && ex.rows[0].parse_status !== 'failed') return 'seen';
        const res = await processFiling(pdf, true); // suppress alerts during backfill
        return res;
      } catch (e) {
        console.error(`[NSE-Detector] backfill item failed ${pdf.url}: ${e.message}`);
        return { matched: true, parsed: false, error: e.message };
      }
    }));
    for (const r of results) {
      if (r === 'seen') { skipped++; continue; }
      if (r && (r.matched || r.unmatched)) stored++;
      if (r && r.parsed) parsed++;
      if (r && r.matched && !r.parsed) failed++;
    }
  }
  return { requestedYears: targetYears, collected: pdfs.length, stored, parsed, failed, skipped };
}

async function scrapePdfLinksFromPage(pageUrl) {
  const html = await fetchWithParser(pageUrl, false);
  const links = [...html.matchAll(/href=["']([^"']+\.pdf)["']/gi)].map(m => m[1]);
  const out = [];
  const seen = new Set();
  for (let raw of links) {
    const url = raw.startsWith('http') ? raw : new URL(raw, NSE_ORIGIN).toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const filename = decodeURIComponent(url.split('/').pop());
    if (!isFinancialReport(filename)) continue; // not a financial report
    out.push({ url, filename });
  }
  return out;
}

async function scrapeNseFinancialResults() {
  // The financial-results page and the listed-company-announcements page both
  // publish company report PDFs; the latter covers a broader set of issuers.
  // We also pull the announcements year-filter (admin-ajax) for 2022..current
  // so historical periods are captured for free (no ScrapingBee needed).
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = 2022; y <= currentYear; y++) years.push(String(y));
  const [a, b, c] = await Promise.allSettled([
    scrapePdfLinksFromPage(NSE_FINANCIALS_URL),
    scrapePdfLinksFromPage(NSE_ANNOUNCEMENTS_URL),
    scrapeNseAnnouncementsByYear(years),
  ]);
  const seen = new Set();
  const pdfs = [];
  for (const res of [a, b, c]) {
    if (res.status !== 'fulfilled') continue;
    for (const p of res.value) {
      if (seen.has(p.url)) continue;
      seen.add(p.url);
      pdfs.push(p);
    }
  }
  return pdfs;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nse_report_filings (
      id SERIAL PRIMARY KEY,
      filing_key TEXT UNIQUE,
      company_name TEXT,
      ticker TEXT,
      pdf_url TEXT,
      filename TEXT,
      period_end_date DATE,
      audited BOOLEAN,
      detected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      parsed BOOLEAN DEFAULT FALSE,
      parse_status TEXT,
      source TEXT DEFAULT 'nse'
    )
  `);
}

async function recordFiling({ key, company, ticker, url, filename, periodEnd, audited, parsed, parseStatus, source = 'nse' }) {
  await pool.query(
    `INSERT INTO nse_report_filings (filing_key, company_name, ticker, pdf_url, filename, period_end_date, audited, parsed, parse_status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (filing_key) DO UPDATE SET parsed = EXCLUDED.parsed, parse_status = EXCLUDED.parse_status, source = EXCLUDED.source`,
    [key, company, ticker, url, filename, periodEnd, audited, parsed, parseStatus, source]
  );
}

async function notifyAllUsers(title, body, link) {
  let admins = [];
  try { const { rows } = await pool.query("SELECT id, email FROM users WHERE role IN ('admin', 'super_admin')"); admins = rows; } catch { admins = []; }
  for (const u of admins) {
    try {
      await pool.query('INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1,$2,$3,$4,$5)', [u.id, title, body, 'nse_report', link || '/app/dashboard']);
    } catch {}
    if (u.email) {
      try { await mailer.sendViaTransport({ to: u.email, subject: title, text: body, label: 'nse_report' }); } catch {}
    }
  }
}

async function processFiling(pdf, suppressAlert) {
  const key = crypto.createHash('sha256').update(pdf.url).digest('hex');
  const ticker = pdf.ticker || matchTicker(pdf.filename);
  const company = extractCompanyName(pdf.filename);
  const periodEnd = parsePeriodEnd(pdf.filename);
  const audited = isAudited(pdf.filename);

  // Deduplication handles old reports — the coveredMatch check below skips
  // any ticker+period that already has a row in financial_statements.

  // Can't determine period from filename — skip download/parse. The filing is
  // recorded so the detector doesn't re-attempt it each cycle.
  if (!periodEnd) {
    await recordFiling({ key, company, ticker, url: pdf.url, filename: pdf.filename, periodEnd: null, audited, parsed: false, parseStatus: 'skipped-no-period', source: pdf.source || 'nse' });
    console.log(`[NSE-Detector] Skip ${ticker || company} (could not determine period from filename)`);
    return { matched: !!ticker, parsed: false, skipped: true };
  }

  if (!ticker) {
    // Not a tracked ticker — record + alert only (no auto-parse)
    await recordFiling({ key, company, ticker: null, url: pdf.url, filename: pdf.filename, periodEnd, audited, parsed: false, parseStatus: 'unmatched', source: pdf.source || 'nse' });
    const label = `${company}${periodEnd ? ' (period ' + periodEnd + ')' : ''}`;
    if (!suppressAlert) await notifyAllUsers('📄 New NSE filing: ' + company, `A new financial report was published on the NSE: ${label}. PDF: ${pdf.url}`, '/app/dashboard');
    console.log(`[NSE-Detector] Unmatched filing recorded: ${company} (${pdf.filename})`);
    return { matched: false };
  }

  // Deduplication: if ANY row exists for this ticker within ±15 days, skip
  // re-processing. This prevents duplicate rows from slightly different
  // period_end_date parses across detection cycles.
  const coveredMatch =
    `SELECT 1 FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
     WHERE s.ticker = $1
       AND (($2::date IS NULL AND fs.period_end_date IS NULL)
            OR (fs.period_end_date IS NOT NULL AND $2::date IS NOT NULL AND ABS(fs.period_end_date - $2::date) <= 15))
     LIMIT 1`;
  try {
    const ex = await pool.query(coveredMatch, [ticker, periodEnd]);
    if (ex.rowCount) {
      console.log(`[NSE-Detector] Skip ${ticker} ${periodEnd || ''} (row already exists in financial_statements)`);
      await recordFiling({ key, company, ticker, url: pdf.url, filename: pdf.filename, periodEnd, audited, parsed: true, parseStatus: 'skipped-completed', source: pdf.source || 'nse' });
      return { matched: true, parsed: true, skipped: true };
    }
  } catch (_) { /* fall through and process */ }

  try {
    const pdfBuffer = await downloadPdf(pdf.url);
    // Auto-detected NSE reports are held for admin approval (publishStatus='pending_review')
    // so a bad auto-parse can't go live without review.
    const { docId, status } = await storePdfReport({ ticker, period_type: inferPeriodType(pdf.filename), period_end_date: periodEnd, file_name: pdf.filename, pdfBuffer, processed_by: 'auto-nse', publishStatus: 'pending_review' });
    const heldForReview = status === 'pending_review';
    const parsedOk = heldForReview || status === 'completed';
    await recordFiling({ key, company, ticker, url: pdf.url, filename: pdf.filename, periodEnd, audited, parsed: parsedOk, parseStatus: status, source: pdf.source || 'nse' });
    const label = `${NSE_NAMES[ticker] || ticker} (${ticker})`;
    if (heldForReview) {
      if (!suppressAlert) await notifyAllUsers('🔍 New NSE report awaiting approval: ' + label, `A new financial report for ${label}${periodEnd ? ' (period ' + periodEnd + ')' : ''} was detected on the NSE and auto-parsed. It is held for admin review before going live. PDF: ${pdf.url}`, `/app/stock/${ticker}?market=nse`);
      console.log(`[NSE-Detector] Parsed + held for review ${label} (doc ${docId})`);
    } else if (status === 'completed') {
      if (!suppressAlert) await notifyAllUsers('📊 New NSE report auto-parsed: ' + label, `A new financial report for ${label}${periodEnd ? ' (period ' + periodEnd + ')' : ''} was detected on the NSE and automatically parsed into the database. PDF: ${pdf.url}`, `/app/stock/${ticker}?market=nse`);
      console.log(`[NSE-Detector] Parsed + stored ${label} (doc ${docId})`);
    } else {
      if (!suppressAlert) await notifyAllUsers('📄 New NSE report (parse pending): ' + label, `A new financial report for ${label}${periodEnd ? ' (period ' + periodEnd + ')' : ''} was detected on the NSE but could not be auto-parsed. You may upload it manually. PDF: ${pdf.url}`, `/app/stock/${ticker}?market=nse`);
      console.log(`[NSE-Detector] Filing stored but parse failed for ${label} (doc ${docId})`);
    }
    return { matched: true, parsed: parsedOk };
  } catch (e) {
    await recordFiling({ key, company, ticker, url: pdf.url, filename: pdf.filename, periodEnd, audited, parsed: false, parseStatus: 'error: ' + e.message });
    console.error(`[NSE-Detector] Error processing ${ticker} (${pdf.filename}): ${e.message}`);
    return { matched: true, parsed: false, error: e.message };
  }
}

async function processPdfBatch(pdfs, suppressAlert, sourceLabel) {
  let newCount = 0, parsedCount = 0;
  for (const pdf of pdfs) {
    const key = crypto.createHash('sha256').update(pdf.url).digest('hex');
    // Skip filings already handled — EXCEPT previously-failed ones, and EXCEPT
    // ones that claim success (skipped-completed/pending_review/completed) but
    // whose statement row is actually missing. A prior cycle can record success
    // via coveredMatch against a row that is later deleted/reverted (or a
    // transient OCR/LLM failure leaves the filing marked done with no row), so
    // re-checking keeps the detector self-healing instead of stuck.
    const ex = await pool.query('SELECT parse_status, ticker, period_end_date FROM nse_report_filings WHERE filing_key = $1', [key]);
    if (ex.rows.length && ex.rows[0].parse_status !== 'failed') {
      const ps = ex.rows[0].parse_status || '';
      if (!['skipped-completed', 'pending_review', 'completed', 'unmatched', 'skipped-pre-2026'].includes(ps)) continue;
      // If it claims success, confirm a live statement row actually exists.
      try {
        const live = await pool.query(
          `SELECT 1 FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id
           WHERE s.ticker = $1 AND fs.status IN ('completed','pending_review')
             AND fs.parsed_data IS NOT NULL AND (fs.error_message IS NULL OR fs.error_message = '')
             AND (($2::date IS NULL AND fs.period_end_date IS NULL)
                  OR (fs.period_end_date IS NOT NULL AND $2::date IS NOT NULL AND ABS(fs.period_end_date - $2::date) <= 15))
           LIMIT 1`,
          [ex.rows[0].ticker, ex.rows[0].period_end_date]
        );
        if (live.rowCount) continue;
        console.log(`[NSE-Detector] Re-processing ${ex.rows[0].ticker} ${ex.rows[0].period_end_date || ''} (marked ${ps} but no live statement row)`);
      } catch { /* fall through and process */ }
    }
    const res = await processFiling(pdf, suppressAlert);
    if (res && (res.matched || res.unmatched)) newCount++;
    if (res && res.parsed) parsedCount++;
  }
  return { newCount, parsedCount };
}

async function runDetection() {
  try {
    if (!process.env.DATABASE_URL) { console.log('[NSE-Detector] No DATABASE_URL — skipping'); return; }
    await ensureTable();

    // No automatic pre-2026 rejection — deduplication via coveredMatch handles
    // skipping reports that already exist in financial_statements.

    // On a fresh deploy the filings table is empty, so every currently-published
    // PDF would look "new". Backfill + parse them, but suppress the alert storm.
    const { rows: existing } = await pool.query('SELECT 1 FROM nse_report_filings LIMIT 1').catch(() => ({ rows: [] }));
    const suppressAlert = existing.length === 0;

    const pdfs = await scrapeNseFinancialResults();
    console.log(`[NSE-Detector] Found ${pdfs.length} PDFs on NSE financial-results page${suppressAlert ? ' (first run — alerts suppressed, backfilling)' : ''}`);
    const nseRes = await processPdfBatch(pdfs, suppressAlert, 'nse');
    let totalNew = nseRes.newCount, totalParsed = nseRes.parsedCount;

    if (SCRAPING_API_KEY) {
      // AfricanFinancials recent scan: cheap (~1–2 calls) check for reports NSE
      // missed. Full historical backfills use backfillAfricanFinancials() on demand.
      const { rows: afExisting } = await pool.query("SELECT 1 FROM nse_report_filings WHERE source = 'africanfinancials' LIMIT 1").catch(() => ({ rows: [] }));
      const afSuppress = afExisting.length === 0;
      const afPdfs = await scrapeAfricanFinancialsRecent();
      const afRes = await processPdfBatch(afPdfs, afSuppress, 'africanfinancials');
      totalNew += afRes.newCount; totalParsed += afRes.parsedCount;
    }

    if (totalNew > 0) console.log(`[NSE-Detector] Detection complete: ${totalNew} new filing(s), ${totalParsed} auto-parsed`);
    else console.log('[NSE-Detector] Detection complete: no new filings');
  } catch (e) {
    console.error('[NSE-Detector] runDetection error:', e.message);
  }
}

let timer = null;
function startNseReportDetection() {
  if (timer) return;
  console.log(`[NSE-Detector] Scheduling NSE financial-report detection every ${DETECT_INTERVAL_MS / 60000} min`);
  setTimeout(() => runDetection().catch(() => {}), 15000); // first run shortly after startup
  timer = setInterval(() => runDetection().catch(() => {}), DETECT_INTERVAL_MS);
}
function stopNseReportDetection() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { runDetection, startNseReportDetection, stopNseReportDetection, scrapeNseFinancialResults, scrapeNseAnnouncementsByYear, processFiling, matchTicker, backfillAfricanFinancials };
