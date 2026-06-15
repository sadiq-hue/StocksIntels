const { getMarketSnapshot } = require('./index.js');
(async () => {
  const snapshot = await getMarketSnapshot();
  console.log('NSE stocks:', snapshot.nse.movers.gainers.length, 'gainers', snapshot.nse.movers.losers.length, 'losers');
  console.log('Global stocks:', snapshot.global.movers.gainers.length, 'gainers', snapshot.global.movers.losers.length, 'losers');
  console.log('Total stocks:', snapshot.movers.gainers.length, 'gainers', snapshot.movers.losers.length, 'losers');
  if (snapshot.global.movers.gainers.length > 0) {
    console.log('First global gainer:', snapshot.global.movers.gainers[0]);
  }
  if (snapshot.nse.movers.gainers.length > 0) {
    console.log('First NSE gainer:', snapshot.nse.movers.gainers[0]);
  }
})();
