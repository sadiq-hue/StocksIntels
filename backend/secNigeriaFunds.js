// Nigeria — SEC Nigeria weekly CIS valuation importer.
//
// The Securities & Exchange Commission (Nigeria) publishes a weekly XLSX,
// "Net Asset Value and Unit Price as at <date>", covering every registered
// collective investment scheme: fund, manager, NAV (Naira), bid/offer unit
// price and WTD/YTD yield. We download the latest file, parse the "Weekly
// Valuation" sheet and ingest each fund with full provenance. Funds are keyed
// with an `sf-ng-` id so they never collide with the Kenyan directory.

const axios = require('axios');
const XLSX = require('xlsx');
const specialFunds = require('./specialFundsService');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CIS_BASE = 'https://sec.gov.ng/for-operators/keep-track-of-capital-market-data/net-asset-value-data/weekly-net-asset-value-for-cis/';
const SOURCE = 'SEC Nigeria — Weekly NAV & Unit Price (CIS)';

const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

// SEC's group headers → our categories. Headers are inconsistently present in
// the sheet (some groups have none), so we also infer from the fund name.
const CAT_MAP = {
  'EQUITY BASED FUNDS': 'Equity',
  'EQUITY': 'Equity',
  'DOLLAR FUNDS': 'Fixed Income / Bond',
  'EUROBONDS': 'Fixed Income / Bond',
  'FIXED INCOME': 'Fixed Income / Bond',
  'BONDS/FIXED INCOME FUNDS': 'Fixed Income / Bond',
  'REAL ESTATE INVESTMENT TRUSTS': 'REIT',
  'REAL ESTATE INVESTMENT TRUST': 'REIT',
  'BALANCED FUNDS': 'Balanced',
  'BALANCED': 'Balanced',
  'ETHICAL FUNDS': 'Ethical',
  'SHARIAH COMPLIANT FUNDS': 'Shariah',
  "SHARI'AH COMPLAINT FUNDS": 'Shariah',
  'SPECIALISED FUNDS': 'Special Funds',
};
const KNOWN = new Set(Object.keys(CAT_MAP));

// Name-based category (authoritative for rows whose group header is missing).
function inferCategory(name, group) {
  const n = String(name || '').toLowerCase();
  if (/shari|shariah/.test(n)) return 'Shariah';
  if (/reit|real estate/.test(n)) return 'REIT';
  if (/money market/.test(n)) return 'Money Market';
  if (/eurobond|bond|fixed income|income fund|treasury|debt fund/.test(n)) return 'Fixed Income / Bond';
  if (/balanced|multi[- ]?asset/.test(n)) return 'Balanced';
  if (/equity/.test(n)) return 'Equity';
  if (/ethical|esg|impact/.test(n)) return 'Ethical';
  return group || 'Unclassified';
}

const abs = (h) => (h.startsWith('http') ? h : new URL(h, 'https://sec.gov.ng').href);
const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || /^n\/?a$/i.test(s) || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 4) => (v == null ? null : Number(v.toFixed(d)));
const ngId = (name) => 'sf-ng-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

function dateFromUrl(u) {
  const m = u.match(/as_at_(\d{1,2})(?:st|nd|rd|th)?_([A-Za-z]+)_(\d{4})/i);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const iso = `${m[3]}-${mon}-${String(m[1]).padStart(2, '0')}`;
  return { iso, t: new Date(`${iso}T00:00:00Z`).getTime() };
}

async function getText(url) {
  const { data } = await axios.get(url, { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'text' });
  return String(data);
}

// Latest weekly CIS XLSX = newest year sub-page, newest dated file in it.
async function findLatestXlsx() {
  const base = await getText(CIS_BASE);
  const years = [...base.matchAll(/href="([^"]*weekly-net-asset-value-for-cis\/(\d{4})-weekly-nav-for-cis\/)"/gi)]
    .map(m => ({ url: abs(m[1]), year: Number(m[2]) }))
    .sort((a, b) => b.year - a.year);
  for (const y of years) {
    let html;
    try { html = await getText(y.url); } catch { continue; }
    const files = [...html.matchAll(/href="([^"]*\/documents\/\d+\/Net_Asset_Value[^"]*\.xlsx)"/gi)]
      .map(m => abs(m[1]))
      .map(u => ({ url: u, d: dateFromUrl(u) }))
      .filter(x => x.d)
      .sort((a, b) => b.d.t - a.d.t);
    if (files.length) return { url: files[0].url, iso: files[0].d.iso };
  }
  return null;
}

// Parse the "Weekly Valuation" sheet into fund rows.
function parseWeekly(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets['Weekly Valuation'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const funds = [];
  let group = null;
  let groupUsd = false;
  for (const r of rows) {
    if (!r) continue;
    const c0 = r[0];
    const name = r[1] != null ? String(r[1]).trim() : '';
    if (name && KNOWN.has(name.toUpperCase())) {
      group = CAT_MAP[name.toUpperCase()];
      groupUsd = name.toUpperCase() === 'DOLLAR FUNDS';
      continue;
    }
    const sn = typeof c0 === 'number' ? c0 : (c0 && /^\d+$/.test(String(c0).trim()) ? Number(String(c0).trim()) : null);
    if (sn === null || !name || /^total/i.test(name)) continue;
    const navN = num(r[4]);
    const bidN = num(r[7]);
    const offerN = num(r[9]);
    const yieldYTD = num(r[12]);
    const yieldWTD = num(r[11]);
    const category = inferCategory(name, group);
    const usd = groupUsd || /\bdollar\b|\busd\b/i.test(name);
    funds.push({
      id: ngId(name),
      name,
      manager: r[2] != null ? String(r[2]).trim() : null,
      category,
      country: 'Nigeria',
      currency: usd ? 'USD' : 'NGN',
      structure: 'Collective Investment Scheme',
      aum: navN,
      nav: offerN != null ? offerN : bidN,
      yield_pct: yieldYTD != null ? round(yieldYTD * 100) : null,
      ytd_return_pct: yieldYTD != null ? round(yieldYTD * 100) : null,
      ...(category === 'Shariah' ? { sharia_compliant: true } : {}),
      ...(yieldWTD != null ? { benchmarks: `WTD ${round(yieldWTD * 100)}% · YTD ${yieldYTD != null ? round(yieldYTD * 100) : '—'}% (SEC weekly)` } : {}),
    });
  }
  return funds;
}

async function importLatest() {
  const result = { ok: false, source: null, date: null, funds: 0, ingested: null, error: null };
  try {
    const latest = await findLatestXlsx();
    if (!latest) throw new Error('no weekly CIS XLSX found');
    const { data } = await axios.get(latest.url, { timeout: 120000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    const rows = parseWeekly(Buffer.from(data));
    if (!rows.length) throw new Error('no fund rows parsed');
    const summary = await specialFunds.bulkIngest(rows, { data_source: SOURCE, source_url: latest.url, observation_date: latest.iso });
    result.ok = true;
    result.source = latest.url;
    result.date = latest.iso;
    result.funds = rows.length;
    result.ingested = { created: summary.created, updated: summary.updated, skipped: summary.skipped };
    console.log(`[SECNigeria] ${rows.length} funds from ${latest.iso}`);
  } catch (e) {
    result.error = e.message;
    console.warn('[SECNigeria] import failed:', e.message);
  }
  return result;
}

module.exports = { importLatest, findLatestXlsx, parseWeekly, dateFromUrl, CAT_MAP };
