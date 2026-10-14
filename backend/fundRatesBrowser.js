// Provider fund rates that are only available on JS-rendered pages.
//
// These managers publish current yields in client-side widgets, so the plain
// HTTP scraper (fundRatesScraper) can't read them. This module renders the page
// through the isolated browser sidecar (rendererClient -> /renderer service) and
// extracts the figures. Same provenance contract as fundRatesScraper: every row
// carries source / source_url / observation_date, and unreadable values are
// omitted rather than guessed.

const renderer = require('./rendererClient');
const specialFunds = require('./specialFundsService');

const NABO_URL = 'https://nabocapital.com/individual/MMF&FIF';
const LOFTY_URL = 'https://loftycorban.com/';

// Nabo publishes a weekly "Top Performers" ticker.
const NABO_MAP = {
  'KES MONEY MARKET': 'Nabo Money Market Fund',
  'KES FIXED INCOME': 'Nabo Africa Fixed Income Fund',
  'USD MONEY MARKET': 'Nabo Capital Money Market Fund (USD)',
};

// Lofty-Corban publishes a yield ticker across all its funds.
const LOFTY_MAP = {
  'Money Market Fund': 'Lofty Corban Money Market Fund (KES)',
  'Kshs Bond Fund': 'Lofty Corban Bond Fund (KES)',
  'USD Bond Fund': 'Lofty Corban Bond Fund (USD)',
  'USD Money Market Fund': 'Lofty Corban Money Market Fund (USD)',
  'Private Debt Special Fund': 'Lofty-Corban Private Debt Special Fund',
  'Global Asset Special Fund': 'Lofty-Corban Global Asset Special Fund',
};

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseNabo(text) {
  const rows = [];
  const re = /NABO\s+(KES|USD)\s+(MONEY MARKET|FIXED INCOME)\s+FUND\s*[–-]\s*([0-9]+(?:\.[0-9]+)?)\s?%/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = NABO_MAP[`${m[1].toUpperCase()} ${m[2].toUpperCase()}`];
    const y = Number(m[3]);
    if (name && y > 0) rows.push({ name, yield_pct: y });
  }
  return rows;
}

function parseLofty(text) {
  const rows = [];
  for (const [label, name] of Object.entries(LOFTY_MAP)) {
    const m = text.match(new RegExp(`${escape(label)}\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)\\s?%`));
    const y = m ? Number(m[1]) : NaN;
    if (Number.isFinite(y) && y > 0) rows.push({ name, yield_pct: y });
  }
  return rows;
}

function loftyAsOf(text) {
  const d = text.match(/Last updated:\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (d) {
    const dt = new Date(`${d[1]} ${d[2]}, ${d[3]}`);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return null;
}

const PROVIDERS = [
  {
    key: 'nabo-rendered',
    name: 'Nabo Capital (rendered)',
    source: 'Nabo Capital — effective annual yield (JS page)',
    url: NABO_URL,
    scrape: async () => {
      const { text } = await renderer.render(NABO_URL, { waitUntil: 'domcontentloaded', waitFor: 4000, timeout: 35000 });
      return { rows: parseNabo(text || '') };
    },
  },
  {
    key: 'loftycorban-rendered',
    name: 'Lofty-Corban (rendered)',
    source: 'Lofty-Corban — fund yield ticker (JS page)',
    url: LOFTY_URL,
    scrape: async () => {
      const { text } = await renderer.render(LOFTY_URL, { waitUntil: 'domcontentloaded', waitFor: 4000, timeout: 35000 });
      return { rows: parseLofty(text || ''), asOf: loftyAsOf(text || '') };
    },
  },
];

async function refreshAll() {
  const results = [];
  for (const p of PROVIDERS) {
    const result = { provider: p.key, name: p.name, ok: false, asOf: null, rows: 0, ingested: null, error: null };
    try {
      const out = await p.scrape();
      const rows = (out.rows || []).filter(r => r && r.name && Number.isFinite(r.yield_pct) && r.yield_pct > 0);
      result.asOf = out.asOf || new Date().toISOString().slice(0, 10);
      result.rows = rows.length;
      if (rows.length) {
        const summary = await specialFunds.bulkIngest(rows, { data_source: p.source, source_url: p.url || null, observation_date: result.asOf });
        result.ingested = { updated: summary.updated, created: summary.created, skipped: summary.skipped };
      }
      result.ok = rows.length > 0;
      console.log(`[FundRatesBrowser] ${p.name}: ${rows.length} rows, asOf ${result.asOf}`);
    } catch (e) {
      result.error = e.message;
      console.warn(`[FundRatesBrowser] ${p.name} failed: ${e.message}`);
    }
    results.push(result);
  }
  return { providers: results, totalRows: results.reduce((s, r) => s + r.rows, 0) };
}

module.exports = { PROVIDERS, refreshAll, parseNabo, parseLofty };
