const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let lastFetchTime = 0;
const COOLDOWN_MS = 600000; // 10 min

const TICKER_MAP = {
  'safaricom': 'SCOM', 'equity group': 'EQTY', 'equity': 'EQTY',
  'kcb': 'KCB', 'kcb group': 'KCB',
  'co-operative bank': 'COOP', 'coop': 'COOP',
  'east african breweries': 'EABL', 'eabl': 'EABL',
  'bat kenya': 'BAT',
  'britam': 'BRIT', 'jubilee': 'JUB',
  'kenya power': 'KPLC', 'kengen': 'KEGN',
  'kenya airways': 'KQ',
  'standard chartered': 'SCBK',
  'totalenergies': 'TOTL', 'total kenya': 'TOTL',
  'kakuzi': 'KUKZ', 'kapchorua': 'KAPC',
  'williamson tea': 'WTK', 'crown paints': 'CRWN',
  'bamburi': 'BAMB', 'carbacid': 'CARB',
  'centum': 'CTUM', 'diamond trust': 'DTK',
  'i&m': 'IMH', 'ncba': 'NCBA',
  'sanlam': 'SLAM', 'stanbic': 'SBIC',
  'nation media': 'NMG', 'sameer': 'SMER',
  'sasini': 'SASN', 'umeme': 'UMME',
  'kenya re': 'KNRE', 'home afrika': 'HAFR',
  'hf group': 'HFCK', 'liberty': 'LBTY',
  'car & general': 'CGEN', 'longhorn': 'LHL',
  'eveready': 'EVRD', 'flame tree': 'FTGH',
  'nse': 'NSE', 'nairobi securities exchange': 'NSE',
  'kenya pipeline': 'KPC', 'family bank': 'FMLY',
  'alp industrial': 'ALP',
};

function guessTicker(name) {
  const lower = name.toLowerCase().replace(/plc|holdings|group|kenya|-/gi, '').trim();
  for (const [key, val] of Object.entries(TICKER_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

async function scrapeFromMansaMarkets() {
  const actions = [];
  try {
    const { data } = await axios.get('https://www.mansamarkets.com/dividends/kenya', {
      timeout: 15000,
      headers: { 'User-Agent': USER_AGENT },
    });
    const $ = cheerio.load(data);
    const rows = $('table tbody tr');
    rows.each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 10) return;
      const companyEl = $(cells[0]);
      const company = companyEl.find('span.block').first().text().trim();
      const ticker = guessTicker(company);
      const dpsText = $(cells[1]).text().trim();
      const amount = parseFloat(dpsText.replace(/[^0-9.]/g, ''));
      const type = $(cells[3]).text().trim();
      const exDate = $(cells[5]).text().trim();
      const recordDate = $(cells[6]).text().trim();
      const payDate = $(cells[7]).text().trim();
      const status = $(cells[9]).text().trim().toLowerCase();
      if (!company || !amount) return;
      const title = `${company} - ${type} Dividend of KES ${amount} per share`;
      const desc = `${company} announced a ${type.toLowerCase()} dividend of KES ${amount} per share. Ex-Date: ${exDate}, Record: ${recordDate}, Payment: ${payDate}.`;
      actions.push({
        company, ticker: ticker || 'NSE', actionType: 'dividend',
        title, description: desc,
        eventDate: exDate || null, recordDate: recordDate || null,
        payDate: payDate || null, status: status === 'paid' ? 'completed' : 'pending',
      });
    });
    console.log(`[NSE-CorpActions] Scraped ${actions.length} dividends from Mansa Markets`);
  } catch (err) {
    console.error('[NSE-CorpActions] Mansa Markets scrape error:', err.message);
  }
  return actions;
}

async function scrapeCorporateActions() {
  const now = Date.now();
  if (now - lastFetchTime < COOLDOWN_MS) return [];
  lastFetchTime = Date.now();
  return await scrapeFromMansaMarkets();
}

module.exports = { scrapeCorporateActions, guessTicker };
