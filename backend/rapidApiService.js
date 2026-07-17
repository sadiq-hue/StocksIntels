const yahooService = require('./yahooService');

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function fetchNSEQuote(symbol) {
  if (!symbol.startsWith('NSE:')) return null;
  return yahooService.fetchQuote(symbol);
}

async function fetchGlobalQuote(symbol) {
  if (symbol.startsWith('NSE:')) return null;

  const cleanSymbol = symbol.toUpperCase().replace(/\./g, '-');

  // Try consolidated Yahoo service
  const yq = await yahooService.fetchQuote(symbol);
  if (yq) return { ...yq, symbol: cleanSymbol, exchange: 'Global' };

  // Fallback: Twelve Data
  try {
    const { fetchQuoteWithStats } = require('./twelveDataService');
    const tq = await fetchQuoteWithStats(symbol);
    if (tq) {
      return {
        symbol: cleanSymbol,
        company_name: tq.company_name || cleanSymbol,
        price: tq.price,
        currency: tq.currency || 'USD',
        change: tq.change || 0,
        changePercent: tq.changePercent || 0,
        volume: tq.volume || 0,
        dayHigh: tq.dayHigh || tq.price,
        dayLow: tq.dayLow || tq.price,
        previousClose: tq.previousClose || tq.price,
        marketCap: tq.marketCap || 0,
        peRatio: tq.peRatio || 0,
        eps: tq.eps || 0,
        timestamp: Math.floor(Date.now() / 1000),
        lastUpdated: new Date().toISOString(),
        exchange: tq.exchange || 'Global',
        provider: 'twelvedata',
      };
    }
  } catch {}

  // Fallback: Google Finance scrape
  try {
    const gq = await fetchGoogleFinanceQuote(cleanSymbol);
    if (gq) {
      return {
        symbol: cleanSymbol,
        company_name: cleanSymbol,
        price: gq.price,
        currency: gq.currency || 'USD',
        change: gq.change || 0,
        changePercent: gq.changePercent || 0,
        volume: 0,
        dayHigh: gq.price,
        dayLow: gq.price,
        previousClose: gq.price,
        marketCap: 0,
        timestamp: Math.floor(Date.now() / 1000),
        lastUpdated: new Date().toISOString(),
        exchange: 'Global',
        provider: 'google',
      };
    }
  } catch {}

  return null;
}

async function fetchGoogleFinanceQuote(symbol) {
  const axios = require('axios');
  const [base, exchange = 'NASDAQ'] = symbol.split(':');
  const exchMap = {
    'SPY':'NYSEARCA','VOO':'NYSEARCA','QQQ':'NASDAQ','VTI':'NYSEARCA',
    'BND':'NASDAQ','AGG':'NYSEARCA','VXUS':'NASDAQ','GLD':'NYSEARCA',
    'SLV':'NYSEARCA','TLT':'NASDAQ','IWM':'NYSEARCA','DIA':'NYSEARCA',
    'XLF':'NYSEARCA','XLK':'NYSEARCA','ARKK':'NYSEARCA',
    'EEM':'NYSEARCA','IEMG':'NASDAQ','VWO':'NYSEARCA','VEU':'NYSEARCA',
    'EZA':'NYSEARCA','AFK':'NYSEARCA','IJR':'NYSEARCA','TIP':'NYSEARCA',
    'VNQ':'NYSEARCA','VUG':'NASDAQ','VTV':'NYSEARCA','IVV':'NYSEARCA',
    'SHY':'NASDAQ','JPM':'NYSE','DIS':'NYSE','BAC':'NYSE',
    'NFLX':'NASDAQ','AMD':'NASDAQ','INTC':'NASDAQ','CSCO':'NASDAQ',
  };
  const exch = exchMap[base] || exchange;

  for (const url of [
    `https://www.google.com/finance/quote/${base}:${exch}`,
    `https://www.google.com/finance/quote/${base}`,
  ]) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 8000, maxRedirects: 5,
      });
      const ds2 = extractDataArray(res.data, 'ds:2');
      if (!ds2) continue;
      const inner = ds2[0]?.[0]?.[0];
      if (!inner) continue;
      const priceArr = inner[5];
      if (!priceArr || priceArr[0] == null) continue;
      return { price: priceArr[0], currency: inner[4] || 'USD', change: priceArr[1] || 0, changePercent: priceArr[2] || 0 };
    } catch {}
  }
  return null;
}

function extractDataArray(body, key) {
  const marker = `AF_initDataCallback({key: '${key}'`;
  const start = body.indexOf(marker);
  if (start === -1) return null;
  const dataPos = body.indexOf('data:', start);
  if (dataPos === -1) return null;
  let i = dataPos + 5;
  while (body[i] !== '[' && i < body.length) i++;
  if (body[i] !== '[') return null;
  let depth = 0, jsonStart = i, jsonEnd = -1, inString = false;
  for (; i < body.length; i++) {
    const ch = body[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }
  if (jsonEnd === -1) return null;
  try { return JSON.parse(body.substring(jsonStart, jsonEnd)); } catch { return null; }
}

async function fetchBatchNSEQuotes(symbols) {
  const nseSymbols = symbols.filter(s => s.startsWith('NSE:'));
  if (!nseSymbols.length) return {};
  return yahooService.fetchQuotes(nseSymbols);
}

async function fetchBatchGlobalQuotes(symbols) {
  const globalSymbols = symbols.filter(s => !s.startsWith('NSE:'));
  if (!globalSymbols.length) return {};

  const map = {};

  // Try consolidated Yahoo service for batch
  const yahooResults = await yahooService.fetchQuotes(globalSymbols);
  Object.assign(map, yahooResults);

  // Fallback: Twelve Data for any missing symbols
  const missing = globalSymbols.filter(s => !map[s.toUpperCase().replace(/\./g, '-')]);
  if (missing.length > 0 && process.env.TWELVE_DATA_API_KEY) {
    try {
      const { fetchBatchQuotes } = require('./twelveDataService');
      const tdMap = await fetchBatchQuotes(missing);
      for (const [sym, q] of Object.entries(tdMap)) {
        const key = sym.toUpperCase().replace(/\./g, '-');
        if (!map[key]) {
          map[key] = {
            symbol: key,
            company_name: q.company_name || key,
            price: q.price,
            currency: q.currency || 'USD',
            change: q.change || 0,
            changePercent: q.changePercent || 0,
            volume: q.volume || 0,
            dayHigh: q.dayHigh || q.price,
            dayLow: q.dayLow || q.price,
            previousClose: q.previousClose || q.price,
            marketCap: q.marketCap || 0,
            timestamp: Math.floor(Date.now() / 1000),
            lastUpdated: new Date().toISOString(),
            exchange: 'Global',
            provider: 'twelvedata',
          };
        }
      }
    } catch {}
  }

  // Last resort: Yahoo via proxy for any still-missing symbols
  const stillMissing = globalSymbols.filter(s => !map[s.toUpperCase().replace(/\./g, '-')]);
  if (stillMissing.length > 0) {
    try {
      const promises = stillMissing.slice(0, 20).map(async (sym) => {
        try {
          const p = await yahooService.fetchPriceViaProxy(sym);
          if (p?.price) {
            const key = sym.toUpperCase().replace(/\./g, '-');
            if (!map[key]) {
              const prevClose = p.previousClose || p.price;
              map[key] = {
                symbol: key,
                company_name: p.companyName || key,
                price: p.price,
                currency: p.currency || 'USD',
                change: p.price - prevClose,
                changePercent: prevClose > 0 ? ((p.price - prevClose) / prevClose) * 100 : 0,
                volume: 0,
                dayHigh: p.price,
                dayLow: p.price,
                previousClose: prevClose,
                marketCap: p.marketCap || 0,
                timestamp: Math.floor(Date.now() / 1000),
                lastUpdated: new Date().toISOString(),
                exchange: 'Global',
                provider: 'yahoo-proxy',
              };
            }
          }
        } catch {}
      });
      await Promise.race([
        Promise.all(promises),
        new Promise(r => setTimeout(r, 20000)),
      ]);
    } catch {}
  }

  return map;
}

module.exports = { fetchNSEQuote, fetchBatchNSEQuotes, fetchGlobalQuote, fetchBatchGlobalQuotes };
