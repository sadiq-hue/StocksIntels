const fs = require('fs');
const path = require('path');
const { fetchGlobalQuotes } = require('./globalScraper');
const { fetchNseQuotes, getQuoteForSymbol } = require('./nseAfxScraper');

const STOCKS_FILE = 'C:/Users/user/Downloads/StocksIntels/frontend/src/app/data/stockUniverses.ts';

(async () => {
  const content = fs.readFileSync(STOCKS_FILE, 'utf8');
  const lines = content.split('\n');

  // Extract all stock entries with line numbers for global and NSE
  const globalEntries = [];
  const nseEntries = [];

  for (let i = 0; i < lines.length; i++) {
    const gMatch = lines[i].match(/ticker:\s*"(\w+)"[\s\S]*?market:\s*"global"/);
    const nMatch = lines[i].match(/ticker:\s*"(\w+)"[\s\S]*?market:\s*"nse"/);
    if (gMatch) globalEntries.push({ line: i, ticker: gMatch[1] });
    if (nMatch) nseEntries.push({ line: i, ticker: nMatch[1] });
  }

  console.log(`Found ${globalEntries.length} global, ${nseEntries.length} NSE entries`);

  // Fetch live prices
  const globalTickers = globalEntries.map(e => e.ticker);
  const nseTickers = nseEntries.map(e => e.ticker);

  console.log('Fetching global prices from Yahoo...');
  const globalPrices = await fetchGlobalQuotes(globalTickers);
  let globalOk = 0, globalFail = 0;
  globalTickers.forEach(t => {
    if (globalPrices[t] && globalPrices[t].price) globalOk++;
    else globalFail++;
  });
  console.log(`Global: ${globalOk} OK, ${globalFail} failed`);

  console.log('Fetching NSE prices from AFX...');
  await fetchNseQuotes();
  let nseOk = 0, nseFail = 0;
  nseTickers.forEach(t => {
    const q = getQuoteForSymbol('NSE:' + t);
    if (q && q.price) nseOk++;
    else nseFail++;
  });
  console.log(`NSE: ${nseOk} OK, ${nseFail} failed`);

  // Generate update map
  const updates = {};

  for (const entry of globalEntries) {
    const live = globalPrices[entry.ticker];
    if (live && live.price && live.changePercent !== undefined) {
      updates[entry.ticker] = {
        price: parseFloat(live.price.toFixed(2)),
        change: parseFloat(live.changePercent.toFixed(2)),
        previousClose: live.previousClose ? parseFloat(live.previousClose.toFixed(2)) : null,
        volume: live.volume || null,
        market: 'global'
      };
    }
  }

  for (const entry of nseEntries) {
    const live = getQuoteForSymbol('NSE:' + entry.ticker);
    if (live && live.price) {
      updates[entry.ticker] = {
        price: parseFloat(live.price.toFixed(2)),
        change: parseFloat(live.changePercent.toFixed(2)),
        previousClose: live.previousClose ? parseFloat(live.previousClose.toFixed(2)) : null,
        volume: live.volume || null,
        market: 'nse'
      };
    }
  }

  // Output the updates as JSON for the calling script
  console.log('\n=== UPDATES ===');
  console.log(JSON.stringify(updates));
  console.log('=== END UPDATES ===');
})();
