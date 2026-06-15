// Fetch real prices from Yahoo for ALL global stocks in the app
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const FETCH_TIMEOUT = 8000;

// ALL unique global symbols collected from all sources in the app
const ALL_GLOBAL_SYMBOLS = [
  // From stockUniverses.ts quickFinancialSymbols + globalStocks
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','V','LLY',
  'AVGO','WMT','XOM','UNH','PG','COST','KO','PEP','AMD','CRM','ADBE',
  'PLTR','SNOW','UBER','ORCL','NFLX','DIS','BAC','INTC','CSCO','QCOM',
  'TXN','IBM','GS','MS','GE','BA','CAT','MCD','NKE','SBUX','PYPL','SQ',
  'COIN','HOOD','ABNB','SPOT','SNAP','GME','AMC','MRK','ABBV','TMO',
  'AMGN','C','WFC','BLK','AXP','UPS','RTX','HON','LOW','MMM','MDT',
  'AMAT','MU','NOW','DDOG','CRWD','PANW','FTNT','PFE','T','VZ','SYK',
  'BSX','ISRG','ABT','GILD','REGN','VRTX','DHR','ZTS','CL','MDLZ',
  'TGT','TJX','ROST','LULU','MRNA','SIRI','ETSY','EBAY','PINS','RBLX',
  'ZM','DOCU','TWLO','WBD','CMCSA','CHTR','FOXA','NWSA','EA','TTWO',
  'LYV','DHI','LEN','NVR','PHM','TSCO','BBY','DG','DLTR','KR','ACI',
  'COP','EOG','SLB','OXY','PSX','FCX','NEM','DOW','APD','SHW','PPG',
  'ECL','DE','CMI','PCAR','WM','RSG','PLD','AMT','EQIX','SPG','PSA',
  'O','WELL','AVB','USB','PNC','TFC','BK','F','GM','AAL','DAL','UAL',
  'LUV','MAR','HLT','MGM','WYNN','LVS','CZR','DKNG','SOFI','AFRM',
  'UPST','MARA','RIOT','CLSK','W','CHWY','ACN','ADP','ADI','APH',
  'ANSS','CDNS','SNPS','KLAC','LRCX','MCHP','NXPI','GLW','TEL','STX',
  'WDC','KEYS','TRMB','ZBRA','NET','MDB','ZS','DASH','PTC','MPWR',
  'ENTG','TER','WDAY','CI','ELV','HCA','MCK','BDX','EW','DXCM','IDXX',
  'ALGN','BIIB','RMD','HOLX','WST','SCHW','MCO','SPGI','MSCI','ICE',
  'CME','NDAQ','FIS','FI','GPN','PGR','ALL','MET','PRU','AFL','TRV',
  'CB','AIG','MPC','VLO','HAL','BKR','DVN','HES','WMB','OKE','KMI',
  'NEE','DUK','SO','AEP','EXC','SRE','PEG','ED','XEL','EIX','DLR',
  'SBAC','CCI','EQR','LMT','NOC','GD','LHX','TDG','EMR','ETN','ITW',
  'PWR','VMC','MLM','DD','IFF','KMB','CMG','SYY','GIS','K','HSY',
  'STZ','MNST','KHC','CHD','ORLY','AZO','CTAS','FDX','RIVN','LCID',
  'BRK.B','TT','PH','ROK','AME','OTIS','CARR','JCI','IR','FANG',
  'GWW','FAST','DOV','NDSN','SNA','SWK','MAS','XYL','WAB','IP',
  'ALB','CF','MOS','NUE','STLD','MHK','SEDG','ENPH','PLUG','CHPT',
  // From signalService.js US_SYMBOLS (additional ones not yet covered)
  'JNJ','CVX','HD','SCHW','RF','HBAN','KEY','FITB','STT','NTRS',
  'MTB','CFG','CMA','ACGL','MCO','SPGI','MSCI','ICE','CME','NDAQ',
  'FDS','CPRT','GPC','SWKS','QRVO','TER','ON','PTC','WDAY','SFM',
  'PARA','OMC','IPG','TM','HMC','EW','DXCM','IDXX','ALGN','BIIB',
  'WST','CPRT','GPC','DLR',
  'SPCX','NOK','SMCI','RKLB','RDW','ASTS','SATS','IREN','GRAB','PATH',
  'MRVL','CPNG','NU','TTD','ITUB','CCL','SOUN','HPE','VALE','NIO',
  'ARM','MSTR','ROKU','IONQ','HIMS','STLA','CAG','ACHR','PL',
];

// Deduplicate
const uniqueSymbols = [...new Set(ALL_GLOBAL_SYMBOLS)];
console.log(`Total unique global symbols to fetch: ${uniqueSymbols.length}`);

async function fetchSingleStock(symbol) {
  try {
    const { data } = await axios.get(
      `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?range=1d&interval=1m`,
      { timeout: FETCH_TIMEOUT, headers: { 'User-Agent': UA } }
    );
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    const closes = quotes?.close?.filter(c => c != null) || [];
    const currentPrice = meta.regularMarketPrice || closes?.[closes.length - 1] || meta.previousClose || null;
    const prevClose = meta.previousClose || currentPrice;
    const volumes = quotes?.volume?.filter(v => v != null) || [];
    const volume = meta.regularMarketVolume || (volumes.length > 0 ? volumes[volumes.length - 1] : 0);
    const companyName = meta.shortName || meta.longName || symbol;
    if (!currentPrice) return null;
    return { symbol, price: currentPrice, previousClose: prevClose, volume: Math.round(volume), company_name: companyName };
  } catch {
    return null;
  }
}

async function main() {
  const results = {};
  let successCount = 0;
  let failCount = 0;
  const batchSize = 3; // 3 concurrent requests

  for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
    const batch = uniqueSymbols.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(s => fetchSingleStock(s)));
    batchResults.forEach((r, idx) => {
      const sym = batch[idx];
      if (r.status === 'fulfilled' && r.value) {
        results[sym] = r.value;
        successCount++;
      } else {
        failCount++;
      }
    });
    // Rate limiting: delay between batches
    if (i + batchSize < uniqueSymbols.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
    if ((i / batchSize) % 20 === 0 && i > 0) {
      console.log(`Progress: ${i + batchSize}/${uniqueSymbols.length} (success: ${successCount}, fail: ${failCount})`);
    }
  }

  console.log(`\n=== FINISHED ===`);
  console.log(`Success: ${successCount}, Failed: ${failCount}`);

  // Output as BASE_QUOTES format (only the global stock entries)
  const entries = Object.entries(results).sort((a, b) => a[0].localeCompare(b[0]));
  let output = '';
  for (const [sym, data] of entries) {
    if (data.price !== null && data.price !== undefined) {
      output += `  '${sym}': { company_name: '${data.company_name.replace(/'/g, "\\'")}', price: ${data.price}, previousClose: ${data.previousClose || data.price}, volume: ${data.volume || 100000} },\n`;
    }
  }

  fs.writeFileSync(path.join(__dirname, 'fetched_prices.txt'), output);
  console.log(`\nWrote ${entries.length} entries to fetched_prices.txt`);
  console.log('\nFirst 20 entries:');
  console.log(output.split('\n').slice(0, 20).join('\n'));
}

main().catch(console.error);
