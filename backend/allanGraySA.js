// South Africa — fund directory + unit prices.
//
// A single comprehensive public SA source isn't scrapeable (ProfileData/ASISA
// are login-based; Moneyweb is Cloudflare-blocked; most managers are JS). Allan
// Gray publishes a server-rendered prices table ("Prices in cents"), so we start
// there and can extend provider-by-provider like the Kenyan scraper.
//
// SA funds are keyed with an `sf-za-` id so they never collide with KE/NG.

const axios = require('axios');
const cheerio = require('cheerio');
const specialFunds = require('./specialFundsService');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const ALLANGRAY_URL = 'https://www.allangray.co.za/what-we-offer/unit-trusts/';
const SOURCE = 'Allan Gray — unit trust prices (ZAR cents)';

const zaId = (name) => 'sf-za-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

function inferCategory(name) {
  const n = name.toLowerCase();
  if (/money market/.test(n)) return 'Money Market';
  if (/interest|bond|income|flexible/.test(n)) return 'Fixed Income / Bond';
  if (/balanced|stable|optimal|worldwide|global balanced/.test(n)) return 'Balanced';
  if (/equity/.test(n)) return 'Equity';
  return 'Equity';
}

// Parse "<Allan Gray … Fund> Price at <d Mon> <price> current price …"
function parseAllanGray(text) {
  const rows = [];
  const re = /(Allan Gray[A-Za-z0-9 &'().+-]*? Fund) Price at (\d{1,2}) ([A-Z][a-z]{2}) ([\d ]+\.\d{2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    const cents = Number(m[4].replace(/\s/g, ''));
    if (!Number.isFinite(cents) || cents <= 0) continue;
    rows.push({
      id: zaId(name),
      name,
      manager: 'Allan Gray',
      country: 'South Africa',
      currency: 'ZAR',
      category: inferCategory(name),
      structure: 'Collective Investment Scheme',
      nav: Number((cents / 100).toFixed(4)),
    });
  }
  return rows;
}

async function refresh() {
  const result = { ok: false, source: null, funds: 0, ingested: null, error: null };
  try {
    const { data } = await axios.get(ALLANGRAY_URL, { timeout: 45000, headers: { 'User-Agent': UA }, responseType: 'text' });
    const $ = cheerio.load(String(data));
    $('script,style,noscript,svg').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const rows = parseAllanGray(text);
    if (!rows.length) throw new Error('no Allan Gray prices parsed');
    const summary = await specialFunds.bulkIngest(rows, { data_source: SOURCE, source_url: ALLANGRAY_URL, observation_date: new Date().toISOString().slice(0, 10) });
    result.ok = true;
    result.source = ALLANGRAY_URL;
    result.funds = rows.length;
    result.ingested = { created: summary.created, updated: summary.updated, skipped: summary.skipped };
    console.log(`[AllanGraySA] ${rows.length} funds`);
  } catch (e) {
    result.error = e.message;
    console.warn('[AllanGraySA] refresh failed:', e.message);
  }
  return result;
}

module.exports = { refresh, parseAllanGray };
