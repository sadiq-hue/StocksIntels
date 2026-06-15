const tls = require('tls');

const CACHE_TTL = 300000; // 5 min
let cache = null;
let cacheTime = 0;
let failCount = 0;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Map NSE page labels to internal index keys
const HOMEPAGE_MAP = {
  'NSE ALL SHARE INDEX': 'NSE:NSEASI',
  'NSE 20 SHARE INDEX': 'NSE:NSE20',
  'NSE 25 SHARE INDEX': 'NSE:NSE25',
};

const MARKET_STATS_MAP = {
  'NSE 10 SHARE INDEX': 'NSE:NSE10',
};

const NAMES = {
  'NSE:NSEASI': 'NSE All Share Index',
  'NSE:NSE20': 'NSE 20 Share Index',
  'NSE:NSE25': 'NSE 25 Share Index',
  'NSE:NSE10': 'NSE 10 Share Index',
};

function fetchPage(path) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(443, 'www.nse.co.ke', {
      rejectUnauthorized: false,
      servername: 'www.nse.co.ke',
    }, () => {
      socket.write('GET ' + path + ' HTTP/1.1\r\nHost: www.nse.co.ke\r\nUser-Agent: ' + USER_AGENT + '\r\nAccept: text/html\r\nConnection: close\r\n\r\n');
    });
    let data = '';
    socket.on('data', d => data += d.toString());
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    setTimeout(() => reject(new Error('Timeout')), 10000);
  });
}

function parseHomepageResults(html) {
  const results = {};
  const blocks = html.split('<div class="stat_col">');
  blocks.forEach(block => {
    const nameMatch = block.match(/<h3>([^<]+)<\/h3>/i);
    const valMatch = block.match(/<p>([0-9,]+\.\d+)/);
    const chgMatch = block.match(/stat_percent[^>]*>\s*([+-]?\s*[0-9,]+\.?\d*)/i);
    if (!nameMatch || !valMatch) return;
    const name = nameMatch[1].trim();
    const key = HOMEPAGE_MAP[name];
    if (!key) return;
    const value = parseFloat(valMatch[1].replace(/,/g, ''));
    const change = chgMatch ? parseFloat(chgMatch[1].replace(/,/g, '').trim()) : 0;
    const changePercent = value > 0 ? (change / (value - change)) * 100 : 0;
    results[key] = { price: value, change, changePercent, previousClose: value - change, volume: 0 };
  });
  return results;
}

function parseMarketStatsResults(html) {
  const results = {};
  // Extract the table containing index values
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return results;
  const rows = tableMatch[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rows) return results;
  rows.forEach(r => {
    const cells = r.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    if (!cells || cells.length < 3) return;
    const vals = cells.map(c => c.replace(/<[^>]+>/g, '').trim());
    if (vals.length < 3) return;
    const name = vals[0].trim();
    const key = MARKET_STATS_MAP[name];
    if (!key) return;
    const valStr = vals[1].replace(/,/g, '');
    const chgStr = vals[2].replace(/,/g, '');
    const value = parseFloat(valStr);
    const change = parseFloat(chgStr);
    if (isNaN(value)) return;
    const changePercent = value > 0 ? (change / (value - change)) * 100 : 0;
    results[key] = { price: value, change, changePercent, previousClose: value - change, volume: 0 };
  });
  return results;
}

async function fetchNseIndicesFromSite() {
  const now = Date.now();
  const effectiveTtl = failCount >= 3 ? CACHE_TTL * 2 : CACHE_TTL;
  if (cache && (now - cacheTime) < effectiveTtl) {
    return cache;
  }

  try {
    const [homeHtml, statsHtml] = await Promise.all([
      fetchPage('/'),
      fetchPage('/market-statistics-summary/'),
    ]);

    const results = { ...parseHomepageResults(homeHtml), ...parseMarketStatsResults(statsHtml) };

    if (Object.keys(results).length > 0) {
      cache = results;
      cacheTime = now;
      failCount = 0;
      console.log('[NSE-Index] Scraped', Object.keys(results).length, 'indices from nse.co.ke');
    }
    return results;
  } catch (err) {
    failCount++;
    if (failCount <= 2) console.error('[NSE-Index] Scrape error:', err.message);
    if (cache) return cache;
    return {};
  }
}

module.exports = { fetchNseIndicesFromSite };
