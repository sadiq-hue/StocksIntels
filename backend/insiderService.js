const axios = require('axios');
const path = require('path');
const { cikLookup, fetchSubmissions } = require('./edgarService');

const USER_AGENT = 'StocksIntels/1.0 (contact@stockintel.app)';
const SEC_ARCHIVES = 'https://www.sec.gov/Archives';
const SUPPORTED_FORMS = new Set(['3', '4', '5', '3/A', '4/A', '5/A']);

const CODE_LABELS = {
  P: 'Open-market purchase',
  S: 'Open-market sale',
  A: 'Grant / award',
  M: 'Option exercise',
  F: 'Tax withholding',
  G: 'Gift',
  C: 'Conversion',
  D: 'Disposition',
  J: 'Other',
  K: 'Equity swap',
  L: 'Small acquisition',
  U: 'Disposition (tender)',
  W: 'Acquisition (tender)',
  Z: 'Voting trust',
  I: 'Discretionary',
  H: 'Holding',
};

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { cache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  if (cache.size > 2500) cache.clear();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

function decode(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function firstTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : '';
}

function tagValue(xml, tag) {
  const inner = firstTag(xml, tag);
  const value = inner.match(/<value>([\s\S]*?)<\/value>/);
  return decode((value ? value[1] : inner).trim());
}

function tagText(xml, tag) {
  return decode(firstTag(xml, tag).replace(/<[^>]+>/g, '').trim());
}

function toNumber(value) {
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function directionForCode(code) {
  if (code === 'P') return 'buy';
  if (code === 'S') return 'sell';
  return 'neutral';
}

function parseOwner(block) {
  const relationship = firstTag(block, 'reportingOwnerRelationship');
  return {
    name: decode(firstTag(block, 'rptOwnerName').trim()),
    cik: firstTag(block, 'rptOwnerCik').trim(),
    isDirector: /true/i.test(firstTag(relationship, 'isDirector')),
    isOfficer: /true/i.test(firstTag(relationship, 'isOfficer')),
    isTenPercentOwner: /true/i.test(firstTag(relationship, 'isTenPercentOwner')),
    isOther: /true/i.test(firstTag(relationship, 'isOther')),
    officerTitle: decode(firstTag(relationship, 'officerTitle').trim()),
    otherText: decode(firstTag(relationship, 'otherText').trim()),
  };
}

function parseTransaction(block, owner, meta, derivative) {
  const code = tagValue(block, 'transactionCode') || 'H';
  const shares = toNumber(tagValue(block, 'transactionShares') || tagValue(block, 'sharesOwnedFollowingTransaction'));
  const price = toNumber(tagValue(block, 'transactionPricePerShare'));
  const acquiredDisposed = tagValue(block, 'transactionAcquiredDisposedCode');
  const sharesAfter = toNumber(tagValue(block, 'sharesOwnedFollowingTransaction'));
  const securityTitle = tagValue(block, 'securityTitle');
  const underlying = tagValue(block, 'underlyingSecurityTitle');
  return {
    symbol: meta.symbol,
    issuerName: meta.issuerName,
    company: meta.issuerName || meta.company,
    cik: meta.cik,
    formType: meta.formType,
    filedDate: meta.filedDate,
    periodOfReport: meta.periodOfReport,
    accessionNumber: meta.accessionNumber,
    filingUrl: meta.filingUrl,
    tenB5One: meta.tenB5One,
    owner,
    securityTitle: derivative && underlying ? `${securityTitle} (underlying: ${underlying})` : securityTitle,
    transactionDate: tagValue(block, 'transactionDate') || meta.periodOfReport,
    code,
    codeLabel: CODE_LABELS[code] || 'Other',
    direction: directionForCode(code),
    acquiredDisposed,
    shares,
    pricePerShare: price,
    value: price > 0 && shares > 0 ? Math.round(price * shares) : 0,
    sharesOwnedAfter: sharesAfter,
    directOrIndirect: tagValue(block, 'directOrIndirectOwnership'),
    natureOfOwnership: tagValue(block, 'natureOfOwnership'),
    derivative: Boolean(derivative),
  };
}

function parseOwnershipXml(xml, meta) {
  const issuerName = tagText(xml, 'issuerName') || meta.company || '';
  const symbol = tagText(xml, 'issuerTradingSymbol') || meta.symbol || '';
  const formType = tagText(xml, 'documentType') || meta.formType || '';
  const periodOfReport = tagText(xml, 'periodOfReport') || meta.periodOfReport || '';
  const tenB5One = /true/i.test(tagText(xml, 'aff10b5One'));

  const owners = [...String(xml).matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/g)]
    .map((m) => parseOwner(m[1]))
    .filter((o) => o.name);

  const filing = {
    symbol: symbol || meta.symbol || '',
    issuerName,
    company: issuerName || meta.company || '',
    cik: meta.cik || '',
    formType,
    filedDate: meta.filedDate || '',
    periodOfReport,
    accessionNumber: meta.accessionNumber || '',
    filingUrl: meta.filingUrl || '',
    tenB5One,
    owners,
    transactions: [],
  };

  const owner = owners[0] || { name: '', isDirector: false, isOfficer: false, isTenPercentOwner: false, isOther: false, officerTitle: '', otherText: '' };
  const rowMeta = { ...meta, ...filing, owner, tenB5One };

  const transactionBlocks = [
    ...String(xml).matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g),
  ];
  for (const match of transactionBlocks) {
    filing.transactions.push(parseTransaction(match[1], owner, rowMeta, false));
  }

  const derivativeBlocks = [
    ...String(xml).matchAll(/<derivativeTransaction>([\s\S]*?)<\/derivativeTransaction>/g),
  ];
  for (const match of derivativeBlocks) {
    filing.transactions.push(parseTransaction(match[1], owner, rowMeta, true));
  }

  const holdingBlocks = [
    ...String(xml).matchAll(/<nonDerivativeHolding>([\s\S]*?)<\/nonDerivativeHolding>/g),
  ];
  for (const match of holdingBlocks) {
    const row = parseTransaction(match[1], owner, rowMeta, false);
    row.code = 'H';
    row.codeLabel = CODE_LABELS.H;
    row.direction = 'neutral';
    filing.transactions.push(row);
  }

  return filing;
}

async function fetchText(url, ttlMs = 10 * 60 * 1000) {
  const key = `text:${url}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const res = await axios.get(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain, application/xml, text/xml, */*' },
    timeout: 30000,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  return cacheSet(key, String(res.data || ''), ttlMs);
}

async function enrichByAccession({ cik, accessionNumber, formType, filedDate, filingUrl, company, symbol }) {
  const cleanCik = String(cik || '').replace(/^0+/, '');
  const accNoDashes = String(accessionNumber || '').replace(/-/g, '');
  if (!cleanCik || !accNoDashes) return null;

  const cacheKey = `insider:${cleanCik}:${accNoDashes}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const txtUrl = `${SEC_ARCHIVES}/edgar/data/${cleanCik}/${accNoDashes}/${accessionNumber}.txt`;
  const text = await fetchText(txtUrl, 24 * 60 * 60 * 1000);
  const match = text.match(/<ownershipDocument[\s\S]*?<\/ownershipDocument>/);
  if (!match) return null;

  const filing = parseOwnershipXml(match[0], {
    cik: cleanCik,
    accessionNumber,
    formType: formType || '',
    filedDate: filedDate || '',
    filingUrl: filingUrl || `${SEC_ARCHIVES}/edgar/data/${cleanCik}/${accNoDashes}/${accessionNumber}-index.htm`,
    company: company || '',
    symbol: symbol || '',
  });
  if (!filing.transactions.length) return null;
  return cacheSet(cacheKey, filing, 6 * 60 * 60 * 1000);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await fn(items[index], index); }
      catch { results[index] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function flattenFiling(filing) {
  return (filing?.transactions || []).map((txn) => ({
    ...txn,
    issuerName: filing.issuerName,
    company: filing.company || filing.issuerName,
    symbol: filing.symbol,
    formType: filing.formType,
    filedDate: filing.filedDate,
    accessionNumber: filing.accessionNumber,
    filingUrl: filing.filingUrl,
    tenB5One: filing.tenB5One,
    owner: txn.owner || filing.owners?.[0] || null,
  }));
}

function summarize(rows) {
  let buys = 0;
  let sells = 0;
  let buyShares = 0;
  let sellShares = 0;
  const insiders = new Set();
  let latestDate = '';
  for (const row of rows) {
    if (row.owner?.name) insiders.add(row.owner.name.toLowerCase());
    if (row.transactionDate && row.transactionDate > latestDate) latestDate = row.transactionDate;
    if (row.direction === 'buy') { buys++; buyShares += row.shares || 0; }
    else if (row.direction === 'sell') { sells++; sellShares += row.shares || 0; }
  }
  return {
    buys,
    sells,
    buyShares,
    sellShares,
    netShares: buyShares - sellShares,
    insiders: insiders.size,
    latestDate,
  };
}

async function getCompanyInsiderFilings(symbol, limit = 20) {
  const cik = cikLookup(symbol);
  if (!cik) return { success: false, symbol, error: 'No SEC CIK for this symbol', filings: [], rows: [] };

  const cacheKey = `company-insider:${String(cik)}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const submissions = await fetchSubmissions(cik);
    const recent = submissions?.filings?.recent || {};
    const forms = recent.form || [];
    const selected = [];
    for (let i = 0; i < forms.length && selected.length < limit; i++) {
      if (!SUPPORTED_FORMS.has(forms[i])) continue;
      selected.push({
        cik,
        accessionNumber: recent.accessionNumber?.[i] || '',
        formType: forms[i],
        filedDate: recent.filingDate?.[i] || '',
        company: submissions.name || '',
        symbol: symbol.toUpperCase(),
      });
    }

    const filings = (await mapLimit(selected, 4, enrichByAccession)).filter(Boolean);
    const rows = filings.flatMap(flattenFiling);
    rows.sort((a, b) => String(b.transactionDate || b.filedDate).localeCompare(String(a.transactionDate || a.filedDate)));

    return cacheSet(cacheKey, {
      success: true,
      symbol: symbol.toUpperCase(),
      cik,
      filings,
      rows,
      summary: summarize(rows),
    }, 30 * 60 * 1000);
  } catch (error) {
    console.error('[Insider] company filings failed:', error.message);
    return { success: false, symbol, error: error.message, filings: [], rows: [] };
  }
}

function parseAtomFeed(xml) {
  const entries = [];
  for (const match of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1];
    const formType = block.match(/<category[^>]*\bterm="([^"]+)"/)?.[1] || '';
    if (!SUPPORTED_FORMS.has(formType)) continue;
    const title = tagText(block, 'title').replace(/\s+/g, ' ').trim();
    const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    const updated = tagText(block, 'updated');
    const summary = tagText(block, 'summary').replace(/<[^>]+>/g, ' ');
    const accessionNumber = summary.match(/AccNo:\s*([0-9-]+)/i)?.[1]
      || link.match(/\/([0-9]{10}-[0-9]{2}-[0-9]{6})\//)?.[1]
      || '';
    const cik = title.match(/\((\d{10})\)/)?.[1] || link.match(/\/data\/(\d+)\//)?.[1] || '';
    const company = title.replace(/^[^-]+-\s*/, '').replace(/\s*\(\d+\)\s*\([^)]*\)\s*$/, '').trim();
    entries.push({
      formType,
      company,
      cik,
      accessionNumber,
      filedDate: (summary.match(/Filed:\s*([0-9-]+)/i)?.[1] || updated.slice(0, 10)),
      filingUrl: link,
      source: 'feed',
      sortTime: updated || '',
    });
  }
  return entries;
}

function parseDailyIndex(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^(\S+(?:\/\S+)?)\s+(.+?)\s{2,}(\d{4,10})\s+(\d{8})\s+(\S+\.txt)\s*$/);
    if (!match) continue;
    const formType = match[1].trim();
    if (!SUPPORTED_FORMS.has(formType)) continue;
    rows.push({
      formType,
      company: match[2].trim(),
      cik: match[3].trim(),
      filedDate: `${match[4].slice(0, 4)}-${match[4].slice(4, 6)}-${match[4].slice(6, 8)}`,
      file: match[5].trim(),
      source: 'daily-index',
      sortTime: '',
    });
  }
  return rows;
}

function dailyIndexUrl(date) {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${SEC_ARCHIVES}/edgar/daily-index/${year}/QTR${quarter}/form.${ymd}.idx`;
}

async function fetchDailyIndexRows() {
  for (let back = 0; back < 7; back++) {
    const date = new Date(Date.now() - back * 24 * 60 * 60 * 1000);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue;
    try {
      const text = await fetchText(dailyIndexUrl(date), 30 * 60 * 1000);
      const rows = parseDailyIndex(text);
      if (rows.length) return rows;
    } catch { /* index for this day is not published yet */ }
  }
  return [];
}

async function getRecentInsiderFilings(limit = 40) {
  const cacheKey = `recent-insider:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const collected = [];
  try {
    const feedUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=0&count=100&output=atom';
    const res = await axios.get(feedUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/atom+xml' },
      timeout: 30000,
      responseType: 'text',
      transformResponse: [(data) => data],
    });
    collected.push(...parseAtomFeed(String(res.data || '')));
  } catch (error) {
    console.warn('[Insider] current-events feed failed:', error.message);
  }

  const indexRows = await fetchDailyIndexRows();
  for (const row of indexRows) {
    const accessionNumber = path.basename(row.file, '.txt');
    const accNoDashes = accessionNumber.replace(/-/g, '');
    collected.push({
      ...row,
      accessionNumber,
      filingUrl: `${SEC_ARCHIVES}/edgar/data/${row.cik}/${accNoDashes}/${accessionNumber}-index.htm`,
    });
  }

  const seen = new Set();
  const unique = [];
  for (const row of collected) {
    if (!row.accessionNumber || seen.has(row.accessionNumber)) continue;
    seen.add(row.accessionNumber);
    unique.push(row);
  }
  unique.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'feed' ? -1 : 1;
    const priority = (form) => form === '4' ? 0 : form === '4/A' ? 1 : form === '5' ? 2 : form === '5/A' ? 3 : form === '3' ? 4 : 5;
    if (a.source === 'daily-index' && priority(a.formType) !== priority(b.formType)) {
      return priority(a.formType) - priority(b.formType);
    }
    return String(b.sortTime || b.filedDate).localeCompare(String(a.sortTime || a.filedDate));
  });

  // Interleave issuers so the feed spans companies instead of showing dozens
  // of rows from whichever name sorts first in the daily index.
  const interleave = (rows) => {
    const groups = new Map();
    for (const row of rows) {
      const key = row.cik || row.company;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const out = [];
    let added = true;
    while (added) {
      added = false;
      for (const list of groups.values()) {
        if (list.length) { out.push(list.shift()); added = true; }
      }
    }
    return out;
  };
  const ordered = [
    ...interleave(unique.filter((r) => r.source === 'feed')),
    ...interleave(unique.filter((r) => r.source === 'daily-index')),
  ];
  const selected = ordered.slice(0, limit);
  const filings = (await mapLimit(selected, 4, enrichByAccession)).filter(Boolean);
  const perCompany = new Map();
  const rows = [];
  for (const filing of filings) {
    for (const txn of flattenFiling(filing)) {
      const key = txn.symbol || txn.cik || txn.company;
      const count = perCompany.get(key) || 0;
      if (count >= 4) continue;
      perCompany.set(key, count + 1);
      rows.push(txn);
    }
  }

  return cacheSet(cacheKey, {
    success: true,
    filings,
    rows,
    summary: summarize(rows),
    counts: { filings: filings.length, feed: selected.filter((r) => r.source === 'feed').length, dailyIndex: selected.filter((r) => r.source === 'daily-index').length },
  }, 5 * 60 * 1000);
}

module.exports = {
  SUPPORTED_FORMS,
  CODE_LABELS,
  getCompanyInsiderFilings,
  getRecentInsiderFilings,
  parseOwnershipXml,
  parseAtomFeed,
};
