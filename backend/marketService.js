const { KENYAN_STOCKS } = require('./newsService');
const yahooService = require('./yahooService');

// Background NSE price cache from mystocks.co.ke
const mystocks = require('./mystocksScraper');
setTimeout(() => {
  mystocks.clearCache();
  mystocks.startAutoRefresh();
}, 1000);

// NSE volume data from afx.kwayisi.org
const nseAfx = require('./nseAfxScraper');
setTimeout(() => nseAfx.fetchNseQuotes().catch(() => {}), 2000);

const quoteCache = new Map();
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;

/**
 * Shared name mapper for consistent display
 */
function getCompanyName(symbol) {
  const ticker = symbol.replace('NSE:', '').toUpperCase();
  const names = {
    'SCOM': 'Safaricom', 'EQTY': 'Equity Group', 'KCB': 'KCB Group', 'EABL': 'EABL',
    'ABSA': 'Absa Bank', 'SBIC': 'Stanbic Holdings', 'KQ': 'Kenya Airways', 'KLG': 'Kenya Airways',
    'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'NVDA': 'NVIDIA Corp.',
    'TSLA': 'Tesla Inc.', 'AMZN': 'Amazon.com Inc.', 'GOOGL': 'Alphabet Inc.',
    'META': 'Meta Platforms', 'NFLX': 'Netflix Inc.', 'JPM': 'JPMorgan Chase', 'V': 'Visa Inc.',
    'AAL': 'American Airlines Group, Inc.',
    'ABBV': 'AbbVie Inc.',
    'ABNB': 'Airbnb, Inc.',
    'ABT': 'Abbott Laboratories',
    'ACGL': 'Arch Capital Group Ltd.',
    'ACI': 'Albertsons Companies, Inc.',
    'ACN': 'Accenture plc',
    'ADBE': 'Adobe Inc.',
    'ADI': 'Analog Devices, Inc.',
    'ADP': 'Automatic Data Processing, Inc.',
    'AEP': 'American Electric Power Company',
    'AFL': 'AFLAC Incorporated',
    'AFRM': 'Affirm Holdings, Inc.',
    'AIG': 'American International Group, I',
    'ALB': 'Albemarle Corporation',
    'ALGN': 'Align Technology, Inc.',
    'ALL': 'Allstate Corporation',
    'AMAT': 'Applied Materials, Inc.',
    'AMC': 'AMC Entertainment Holdings, Inc',
    'AMD': 'Advanced Micro Devices, Inc.',
    'AME': 'AMETEK, Inc.',
    'AMGN': 'Amgen Inc.',
    'AMT': 'American Tower Corporation',
    'APD': 'Air Products and Chemicals, Inc',
    'APH': 'Amphenol Corporation',
    'AVB': 'AvalonBay Communities, Inc.',
    'AVGO': 'Broadcom Inc.',
    'AXP': 'American Express Company',
    'AZO': 'AutoZone, Inc.',
    'BA': 'Boeing Company',
    'BAC': 'Bank of America Corporation',
    'BBY': 'Best Buy Co., Inc.',
    'BDX': 'Becton, Dickinson and Company',
    'BIIB': 'Biogen Inc.',
    'BK': 'The Bank of New York Mellon Cor',
    'BKR': 'Baker Hughes Company',
    'BLK': 'BlackRock, Inc.',
    'BSX': 'Boston Scientific Corporation',
    'C': 'Citigroup, Inc.',
    'CARR': 'Carrier Global Corporation',
    'CAT': 'Caterpillar, Inc.',
    'CB': 'Chubb Limited',
    'CCI': 'Crown Castle Inc.',
    'CDNS': 'Cadence Design Systems, Inc.',
    'CF': 'CF Industries Holdings, Inc.',
    'CFG': 'Citizens Financial Group, Inc.',
    'CHD': 'Church & Dwight Company, Inc.',
    'CHPT': 'ChargePoint Holdings, Inc.',
    'CHTR': 'Charter Communications, Inc.',
    'CHWY': 'Chewy, Inc.',
    'CI': 'The Cigna Group',
    'CL': 'Colgate-Palmolive Company',
    'CLSK': 'CleanSpark, Inc.',
    'CMCSA': 'Comcast Corporation',
    'CME': 'CME Group Inc.',
    'CMG': 'Chipotle Mexican Grill, Inc.',
    'CMI': 'Cummins Inc.',
    'COIN': 'Coinbase Global, Inc.',
    'COP': 'ConocoPhillips',
    'COST': 'Costco Wholesale Corporation',
    'CPRT': 'Copart, Inc.',
    'CRM': 'Salesforce, Inc.',
    'CRWD': 'CrowdStrike Holdings, Inc.',
    'CSCO': 'Cisco Systems, Inc.',
    'CTAS': 'Cintas Corporation',
    'CVX': 'Chevron Corporation',
    'CZR': 'Caesars Entertainment, Inc.',
    'DAL': 'Delta Air Lines, Inc.',
    'DASH': 'DoorDash, Inc.',
    'DD': 'DuPont de Nemours, Inc.',
    'DDOG': 'Datadog, Inc.',
    'DE': 'Deere & Company',
    'DG': 'Dollar General Corporation',
    'DHI': 'D.R. Horton, Inc.',
    'DHR': 'Danaher Corporation',
    'DIS': 'Walt Disney Company',
    'DKNG': 'DraftKings Inc.',
    'DLR': 'Digital Realty Trust, Inc.',
    'DLTR': 'Dollar Tree, Inc.',
    'DOCU': 'DocuSign, Inc.',
    'DOV': 'Dover Corporation',
    'DOW': 'Dow Inc.',
    'DUK': 'Duke Energy Corporation',
    'DVN': 'Devon Energy Corporation',
    'DXCM': 'DexCom, Inc.',
    'EA': 'Electronic Arts Inc.',
    'EBAY': 'eBay Inc.',
    'ECL': 'Ecolab Inc.',
    'ED': 'Consolidated Edison, Inc.',
    'EIX': 'Edison International',
    'ELV': 'Elevance Health, Inc.',
    'EMR': 'Emerson Electric Company',
    'ENPH': 'Enphase Energy, Inc.',
    'ENTG': 'Entegris, Inc.',
    'EOG': 'EOG Resources, Inc.',
    'EQIX': 'Equinix, Inc.',
    'EQR': 'Equity Residential',
    'ETN': 'Eaton Corporation, PLC',
    'ETSY': 'Etsy, Inc.',
    'EW': 'Edwards Lifesciences Corporatio',
    'EXC': 'Exelon Corporation',
    'F': 'Ford Motor Company',
    'FANG': 'Diamondback Energy, Inc.',
    'FAST': 'Fastenal Company',
    'FCX': 'Freeport-McMoRan, Inc.',
    'FDS': 'FactSet Research Systems Inc.',
    'FDX': 'FedEx Corporation',
    'FIS': 'Fidelity National Information S',
    'FITB': 'Fifth Third Bancorp',
    'FOXA': 'Fox Corporation',
    'FTNT': 'Fortinet, Inc.',
    'GD': 'General Dynamics Corporation',
    'GE': 'GE Aerospace',
    'GILD': 'Gilead Sciences, Inc.',
    'GIS': 'General Mills, Inc.',
    'GLW': 'Corning Incorporated',
    'GM': 'General Motors Company',
    'GME': 'GameStop Corporation',
    'GPC': 'Genuine Parts Company',
    'GPN': 'Global Payments Inc.',
    'GS': 'Goldman Sachs Group, Inc.',
    'GWW': 'W.W. Grainger, Inc.',
    'HAL': 'Halliburton Company',
    'HBAN': 'Huntington Bancshares Incorpora',
    'HCA': 'HCA Healthcare, Inc.',
    'HD': 'Home Depot, Inc.',
    'HLT': 'Hilton Worldwide Holdings Inc.',
    'HMC': 'Honda Motor Company, Ltd.',
    'HOLX': 'Hologic, Inc.',
    'HON': 'Honeywell International Inc.',
    'HOOD': 'Robinhood Markets, Inc.',
    'HSY': 'The Hershey Company',
    'IBM': 'International Business Machines',
    'ICE': 'Intercontinental Exchange Inc.',
    'IDXX': 'IDEXX Laboratories, Inc.',
    'IFF': 'International Flavors & Fragran',
    'INTC': 'Intel Corporation',
    'IP': 'International Paper Company',
    'IR': 'Ingersoll Rand Inc.',
    'ISRG': 'Intuitive Surgical, Inc.',
    'ITW': 'Illinois Tool Works Inc.',
    'JCI': 'Johnson Controls International ',
    'JNJ': 'Johnson & Johnson',
    'KEY': 'KeyCorp',
    'KEYS': 'Keysight Technologies Inc.',
    'KHC': 'The Kraft Heinz Company',
    'KLAC': 'KLA Corporation',
    'KMB': 'Kimberly-Clark Corporation',
    'KMI': 'Kinder Morgan, Inc.',
    'KO': 'Coca-Cola Company',
    'KR': 'Kroger Company',
    'LCID': 'Lucid Group, Inc.',
    'LEN': 'Lennar Corporation',
    'LHX': 'L3Harris Technologies, Inc.',
    'LLY': 'Eli Lilly and Company',
    'LMT': 'Lockheed Martin Corporation',
    'LOW': 'Lowe\u0027s Companies, Inc.',
    'LRCX': 'Lam Research Corporation',
    'LULU': 'lululemon athletica inc.',
    'LUV': 'Southwest Airlines Company',
    'LVS': 'Las Vegas Sands Corp.',
    'LYV': 'Live Nation Entertainment, Inc.',
    'MAR': 'Marriott International',
    'MARA': 'MARA Holdings, Inc.',
    'MAS': 'Masco Corporation',
    'MCD': 'McDonald\u0027s Corporation',
    'MCHP': 'Microchip Technology Incorporat',
    'MCK': 'McKesson Corporation',
    'MCO': 'Moody\u0027s Corporation',
    'MDB': 'MongoDB, Inc.',
    'MDLZ': 'Mondelez International, Inc.',
    'MDT': 'Medtronic plc.',
    'MET': 'MetLife, Inc.',
    'MGM': 'MGM Resorts International',
    'MHK': 'Mohawk Industries, Inc.',
    'MLM': 'Martin Marietta Materials, Inc.',
    'MMM': '3M Company',
    'MNST': 'Monster Beverage Corporation',
    'MOS': 'Mosaic Company',
    'MPC': 'Marathon Petroleum Corporation',
    'MPWR': 'Monolithic Power Systems, Inc.',
    'MRK': 'Merck & Company, Inc.',
    'MRNA': 'Moderna, Inc.',
    'MS': 'Morgan Stanley',
    'MSCI': 'MSCI Inc.',
    'MTB': 'M&T Bank Corporation',
    'MU': 'Micron Technology, Inc.',
    'NDAQ': 'Nasdaq, Inc.',
    'NDSN': 'Nordson Corporation',
    'NEE': 'NextEra Energy, Inc.',
    'NEM': 'Newmont Corporation',
    'NET': 'Cloudflare, Inc.',
    'NKE': 'Nike, Inc.',
    'NOC': 'Northrop Grumman Corporation',
    'NOW': 'ServiceNow, Inc.',
    'NTRS': 'Northern Trust Corporation',
    'NUE': 'Nucor Corporation',
    'NVR': 'NVR, Inc.',
    'NWSA': 'News Corporation',
    'NXPI': 'NXP Semiconductors N.V.',
    'O': 'Realty Income Corporation',
    'OKE': 'ONEOK, Inc.',
    'OMC': 'Omnicom Group Inc.',
    'ON': 'ON Semiconductor Corporation',
    'ORCL': 'Oracle Corporation',
    'ORLY': 'O\u0027Reilly Automotive, Inc.',
    'OTIS': 'Otis Worldwide Corporation',
    'OXY': 'Occidental Petroleum Corporatio',
    'PANW': 'Palo Alto Networks, Inc.',
    'PCAR': 'PACCAR Inc.',
    'PEG': 'Public Service Enterprise Group',
    'PEP': 'Pepsico, Inc.',
    'PFE': 'Pfizer, Inc.',
    'PG': 'Procter & Gamble Company',
    'PGR': 'Progressive Corporation',
    'PH': 'Parker-Hannifin Corporation',
    'PHM': 'PulteGroup, Inc.',
    'PINS': 'Pinterest, Inc.',
    'PLD': 'Prologis, Inc.',
    'PLTR': 'Palantir Technologies Inc.',
    'PLUG': 'Plug Power, Inc.',
    'PNC': 'PNC Financial Services Group, I',
    'PPG': 'PPG Industries, Inc.',
    'PRU': 'Prudential Financial, Inc.',
    'PSA': 'Public Storage',
    'PSX': 'Phillips 66',
    'PTC': 'PTC Inc.',
    'PWR': 'Quanta Services, Inc.',
    'PYPL': 'PayPal Holdings, Inc.',
    'QCOM': 'QUALCOMM Incorporated',
    'QRVO': 'Qorvo, Inc.',
    'RBLX': 'Roblox Corporation',
    'REGN': 'Regeneron Pharmaceuticals, Inc.',
    'RF': 'Regions Financial Corporation',
    'RIOT': 'Riot Platforms, Inc.',
    'RIVN': 'Rivian Automotive, Inc.',
    'RMD': 'ResMed Inc.',
    'ROK': 'Rockwell Automation, Inc.',
    'ROST': 'Ross Stores, Inc.',
    'RSG': 'Republic Services, Inc.',
    'RTX': 'RTX Corporation',
    'SBAC': 'SBA Communications Corporation',
    'SBUX': 'Starbucks Corporation',
    'SCHW': 'Charles Schwab Corporation',
    'SEDG': 'SolarEdge Technologies, Inc.',
    'SFM': 'Sprouts Farmers Market, Inc.',
    'SHW': 'Sherwin-Williams Company',
    'SIRI': 'SiriusXM Holdings Inc.',
    'SLB': 'SLB Limited',
    'SNA': 'Snap-On Incorporated',
    'SNAP': 'Snap Inc.',
    'SNOW': 'Snowflake Inc.',
    'SNPS': 'Synopsys, Inc.',
    'SO': 'Southern Company',
    'SOFI': 'SoFi Technologies, Inc.',
    'SPG': 'Simon Property Group, Inc.',
    'SPGI': 'S&P Global Inc.',
    'SPOT': 'Spotify Technology S.A.',
    'SRE': 'DBA Sempra',
    'STLD': 'Steel Dynamics, Inc.',
    'STT': 'State Street Corporation',
    'STX': 'Seagate Technology Holdings PLC',
    'STZ': 'Constellation Brands, Inc.',
    'SWK': 'Stanley Black & Decker, Inc.',
    'SWKS': 'Skyworks Solutions, Inc.',
    'SYK': 'Stryker Corporation',
    'SYY': 'Sysco Corporation',
    'T': 'AT&T Inc.',
    'TDG': 'Transdigm Group Incorporated',
    'TEL': 'TE Connectivity plc',
    'TER': 'Teradyne, Inc.',
    'TFC': 'Truist Financial Corporation',
    'TGT': 'Target Corporation',
    'TJX': 'TJX Companies, Inc.',
    'TM': 'Toyota Motor Corporation',
    'TMO': 'Thermo Fisher Scientific Inc',
    'TRMB': 'Trimble Inc.',
    'TRV': 'The Travelers Companies, Inc.',
    'TSCO': 'Tractor Supply Company',
    'TT': 'Trane Technologies plc',
    'TTWO': 'Take-Two Interactive Software, ',
    'TWLO': 'Twilio Inc.',
    'TXN': 'Texas Instruments Incorporated',
    'UAL': 'United Airlines Holdings, Inc.',
    'UBER': 'Uber Technologies, Inc.',
    'UNH': 'UnitedHealth Group Incorporated',
    'UPS': 'United Parcel Service, Inc.',
    'UPST': 'Upstart Holdings, Inc.',
    'USB': 'U.S. Bancorp',
    'VLO': 'Valero Energy Corporation',
    'VMC': 'Vulcan Materials Company',
    'VRTX': 'Vertex Pharmaceuticals Incorpor',
    'VZ': 'Verizon Communications Inc.',
    'W': 'Wayfair Inc.',
    'WAB': 'Westinghouse Air Brake Technolo',
    'WBD': 'Warner Bros. Discovery, Inc.',
    'WDAY': 'Workday, Inc.',
    'WDC': 'Western Digital Corporation',
    'WELL': 'Welltower Inc.',
    'WFC': 'Wells Fargo & Company',
    'WM': 'Waste Management, Inc.',
    'WMB': 'Williams Companies, Inc.',
    'WMT': 'Walmart Inc.',
    'WST': 'West Pharmaceutical Services, I',
    'WYNN': 'Wynn Resorts, Limited',
    'XEL': 'Xcel Energy Inc.',
    'XOM': 'Exxon Mobil Corporation',
    'XYL': 'Xylem Inc.',
    'ZBRA': 'Zebra Technologies Corporation',
    'ZM': 'Zoom Communications, Inc.',
    'ZS': 'Zscaler, Inc.',
    'ZTS': 'Zoetis Inc.',
    'SPCX': 'SpaceX Inc.',
    'NOK': 'Nokia Corp.', 'SMCI': 'Super Micro Computer Inc.', 'RKLB': 'Rocket Lab USA Inc.',
    'RDW': 'Redwire Corp.', 'ASTS': 'AST SpaceMobile Inc.', 'SATS': 'EchoStar Corp.',
    'IREN': 'IREN Ltd.', 'GRAB': 'Grab Holdings Ltd.', 'PATH': 'UiPath Inc.',
    'MRVL': 'Marvell Technology Inc.', 'CPNG': 'Coupang Inc.', 'NU': 'Nu Holdings Ltd.',
    'TTD': 'The Trade Desk Inc.', 'ITUB': 'Itau Unibanco Holding SA', 'CCL': 'Carnival Corp.',
    'SOUN': 'SoundHound AI Inc.', 'HPE': 'Hewlett Packard Enterprise', 'VALE': 'Vale S.A.',
    'NIO': 'NIO Inc.', 'ARM': 'Arm Holdings plc', 'MSTR': 'Strategy Inc.',
    'ROKU': 'Roku Inc.', 'IONQ': 'IonQ Inc.', 'HIMS': 'Hims & Hers Health Inc.',
    'STLA': 'Stellantis N.V.', 'CAG': 'Conagra Brands Inc.', 'ACHR': 'Archer Aviation Inc.',
    'PL': 'Planet Labs PBC',
  };
  return names[ticker] || KENYAN_STOCKS[ticker] || ticker;
}

async function enrichVolumeFromAfx(quote, symbol) {
  if (!quote || !symbol.startsWith('NSE:')) return;
  try {
    await nseAfx.fetchNseQuotes();
    const afx = nseAfx.getQuoteForSymbol(symbol);
    if (afx && afx.volume) quote.volume = afx.volume;
  } catch {}
}

// Resolve an NSE quote by trying multiple sources in order:
//   mystocks.africa Partner API (authoritative, delayed) -> mystocks.co.ke scraper
//   -> AFX (afx.kwayisi.org, free) -> Apify (needs key)
// Lazy-requires each module so a missing/optional scraper never crashes boot.
async function getNseBaseQuote(symbol) {
  // 0c) NSE official portal ticker API — authoritative live feed (powers the
  //     nse.co.ke widget). Its previous close / % change match the portal; the
  //     KenyanStocks / MyStocks feeds below share a stale upstream reference.
  try {
    const nseTicker = require('./nseTickerScraper');
    const tq = await nseTicker.getQuoteForSymbol(symbol);
    if (tq && Number(tq.price) > 0) return tq;
  } catch (e) { /* fall through to other sources */ }

  // 0a) KenyanStocks.com API — fast, reliable, covers all NSE stocks
  try {
    const ksMod = require('./kenyanStocksScraper');
    const ksStocks = await ksMod.getStocksData();
    const cleanTicker = symbol.replace('NSE:', '');
    const ks = Array.isArray(ksStocks) ? ksStocks.find(s => s.symbol === cleanTicker) : null;
    if (ks && Number(ks.close) > 0) {
      const prevClose = Number(ks.previous_price) || Number(ks.close);
      const change = Number(ks.close) - prevClose;
      const pct = prevClose > 0 ? (change / prevClose) * 100 : 0;
      const vol = Number(ks.volume) || 0;
      const mcap = Number(ks.market_cap) || (Number(ks.close) * Number(ks.shares_issued)) || 0;
      return {
        price: Number(ks.close),
        change,
        changesPercentage: pct,
        changePercent: pct,
        volume: vol,
        marketCap: mcap,
        dayHigh: Number(ks.high) || Number(ks.close),
        dayLow: Number(ks.low) || Number(ks.close),
        previousClose: prevClose,
        company_name: ks.company_name || cleanTicker,
        timestamp: Math.floor(Date.now() / 1000),
        lastUpdated: new Date().toISOString(),
        provider: 'kenyanstocks',
      };
    }
  } catch (e) { /* fall through to other sources */ }

  // 0b) mystocks.africa Partner API — primary, authoritative live (delayed) quotes
  let msaQuote = null;
  if (process.env.MYSTOCKS_AFRICA_API_KEY) {
    try {
      const msa = require('./mystocksAfricaApi');
      const msaQ = await msa.getQuoteForSymbol(symbol);
      if (msaQ && Number(msaQ.price) > 0) {
        msaQuote = {
          price: msaQ.price,
          change: msaQ.change || 0,
          changesPercentage: msaQ.changePercent || 0,
          changePercent: msaQ.changePercent || 0,
          volume: msaQ.volume || 0,
          marketCap: msaQ.marketCap || 0,
          dayHigh: msaQ.dayHigh || msaQ.price,
          dayLow: msaQ.dayLow || msaQ.price,
          previousClose: msaQ.previousClose || msaQ.price,
          company_name: msaQ.company_name || symbol,
          timestamp: Math.floor(Date.now() / 1000),
          lastUpdated: new Date().toISOString(),
          provider: 'mystocksAfrica',
        };
      }
    } catch (e) { /* fall through to other sources */ }
  }

  // If mystocksAfrica returned previousClose === price (API sometimes caches this),
  // try multiple sources in PARALLEL to fix previousClose (must complete within ~10s).
  if (msaQuote && msaQuote.previousClose === msaQuote.price && msaQuote.change === 0 && (msaQuote.dayHigh || 0) !== (msaQuote.dayLow || 0)) {
    const enrichTimeout = 10000;
    const cleanTicker = symbol.replace('NSE:', '');

    const afxResult = (async () => {
      try {
        const nseAfxMod = require('./nseAfxScraper');
        await Promise.race([nseAfxMod.fetchNseQuotes(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), enrichTimeout))]);
        const afxQ = nseAfxMod.getQuoteForSymbol(symbol);
        if (afxQ && Number(afxQ.price) > 0 && afxQ.previousClose && afxQ.previousClose !== afxQ.price) return { source: 'afx', prev: afxQ.previousClose };
      } catch (e) { /* best-effort */ }
      return null;
    })();

    const histResult = (async () => {
      try {
        const msaHist = require('./mystocksAfricaApi');
        const candles = await Promise.race([msaHist.fetchHistorical(symbol, '5d'), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), enrichTimeout))]);
        if (Array.isArray(candles) && candles.length >= 2) {
          const prevClose = Number(candles[candles.length - 2].close);
          if (prevClose > 0 && prevClose !== msaQuote.price) return { source: 'hist', prev: prevClose };
        }
      } catch (e) { /* best-effort */ }
      return null;
    })();

    const msResult = (async () => {
      try {
        const ms = require('./mystocksScraper');
        const msData = await Promise.race([ms.scrapeStockPage(cleanTicker), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), enrichTimeout))]);
        if (msData && Number(msData.price) > 0 && msData.change !== 0) return { source: 'mystocks', prev: msData.previousClose || (msaQuote.price - msData.change) };
      } catch (e) { /* best-effort */ }
      return null;
    })();

    const winner = await Promise.any([afxResult, histResult, msResult].map(p => p.then(r => r ? Promise.resolve(r) : Promise.reject('no data')))).catch(() => null);
    if (winner) {
      const realPrev = winner.prev;
      const derivedChange = msaQuote.price - realPrev;
      const derivedPct = realPrev > 0 ? (derivedChange / realPrev) * 100 : 0;
      msaQuote.previousClose = realPrev;
      msaQuote.change = derivedChange;
      msaQuote.changePercent = derivedPct;
      msaQuote.changesPercentage = derivedPct;
      msaQuote.provider = `mystocksAfrica+${winner.source}`;
      console.log(`[NSE enrich] ${symbol}: enriched via ${winner.source}, prevClose=${realPrev}, change=${derivedChange.toFixed(2)}, pct=${derivedPct.toFixed(2)}%`);
    } else {
      console.warn(`[NSE enrich] ${symbol}: all 3 enrichment sources failed`);
    }
  }

  if (msaQuote) {
    return msaQuote;
  }

  // 1) mystocks.co.ke — fallback (has marketCap, change, volume)
  let msq = null;
  try {
    const mysticks = require('./mystocksScraper');
    msq = await mysticks.getQuoteForSymbol(symbol);
  } catch (e) { /* mystocks optional / may be absent */ }

  if (msq && Number(msq.price) > 0) {
    return {
      price: msq.price,
      change: msq.change || 0,
      changesPercentage: msq.changePercent || 0,
      changePercent: msq.changePercent || 0,
      volume: msq.volume || 0,
      marketCap: msq.marketCap || 0,
      dayHigh: msq.dayHigh || msq.price,
      dayLow: msq.dayLow || msq.price,
      previousClose: msq.previousClose || msq.price,
      company_name: msq.name || msq.ticker || symbol,
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: new Date().toISOString(),
      provider: 'mystocks',
    };
  }

  // 2) AFX (afx.kwayisi.org) — free fallback for price/volume (only if mystocks lacked price)
  let afx = null;
  try {
    const nseAfxMod = require('./nseAfxScraper');
    await nseAfxMod.fetchNseQuotes();
    afx = nseAfxMod.getQuoteForSymbol(symbol);
  } catch (e) { /* afx optional */ }

  if (afx && Number(afx.price) > 0) {
    return {
      price: afx.price,
      change: afx.change || 0,
      changePercent: afx.changePercent || 0,
      volume: afx.volume || 0,
      dayHigh: afx.dayHigh || afx.price,
      dayLow: afx.dayLow || afx.price,
      previousClose: afx.previousClose || afx.price,
      company_name: afx.name || afx.ticker || symbol,
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: new Date().toISOString(),
      provider: 'afx',
    };
  }

  // 3) Apify (requires APIFY_API_KEY) — last-resort price source
  if (process.env.APIFY_API_KEY) {
    try {
      const apifySvc = require('./apifyNseService');
      await apifySvc.fetchNseQuotes();
      const apify = apifySvc.getQuoteForSymbol(symbol);
      if (apify && Number(apify.price) > 0) {
        return {
          price: apify.price,
          change: apify.change || 0,
          changePercent: apify.changePercent || 0,
          volume: apify.volume || 0,
          dayHigh: apify.dayHigh || apify.price,
          dayLow: apify.dayLow || apify.price,
          previousClose: apify.previousClose || apify.price,
          company_name: apify.name || apify.ticker || symbol,
          timestamp: Math.floor(Date.now() / 1000),
          lastUpdated: new Date().toISOString(),
          provider: 'apify',
        };
      }
    } catch (e) { /* apify optional */ }
  }

  return null;
}

async function getStockQuote(symbol) {
  if (!symbol) return null;

  const cached = quoteCache.get(symbol);
  if (cached && Number(cached.price) > 0 && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS)) {
    return cached;
  }

  let quote = null;

  // For NSE stocks, resolve a quote from mystocks -> AFX -> Apify (price/marketCap)
  if (symbol.startsWith('NSE:')) {
    const nseQuote = await getNseBaseQuote(symbol);
    if (nseQuote) {
      quote = nseQuote;
      await enrichVolumeFromAfx(quote, symbol);
    }
  }

  // Fallback: Yahoo Finance (skipped for NSE — Yahoo has no NSE data)
  if (!quote && !symbol.startsWith('NSE:')) {
    quote = await yahooService.fetchQuote(symbol);
  }

  if (quote) {
    quoteCache.set(symbol, { ...quote, symbol, marketCap: quote.marketCap || 0 });
    return quoteCache.get(symbol);
  }

  if (cached && Number(cached.price) > 0 && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS * 2)) {
    console.warn(`[marketService] Serving stale cache for ${symbol} (age: ${Math.round((Date.now() - (cached.timestamp * 1000)) / 1000)}s)`);
    return cached;
  }

  console.warn(`[marketService] No fresh quote available for ${symbol}`);
  return null;
}

const CONCURRENCY = 10;
const BATCH_DELAY_MS = 400;
const BATCH_TIMEOUT_MS = 240000;

function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) =>
    (timer = setTimeout(() => reject(new Error('timeout:' + label)), ms))
  );
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

async function fetchQuoteForSymbol(s) {
  let quote = null;

  if (s.startsWith('NSE:')) {
    try {
      const nseQuote = await withTimeout(getNseBaseQuote(s), 12000, s);
      if (nseQuote) {
        quote = nseQuote;
        try { await withTimeout(enrichVolumeFromAfx(quote, s), 8000, s + ':afx'); }
        catch (e) { /* afx volume is optional */ }
      }
    } catch (e) {
      console.warn(`[fetchQuoteForSymbol] NSE ${s} failed: ${e.message}`);
    }
  } else {
    try {
      quote = await withTimeout(yahooService.fetchQuote(s), 12000, s);
    } catch (e) {
      console.warn(`[fetchQuoteForSymbol] Yahoo ${s} failed: ${e.message}`);
    }
  }

  return quote;
}

async function getQuotesBatch(symbols) {
  const results = {};
  const missing = [];

  symbols.forEach(s => {
    const cached = quoteCache.get(s);
    if (cached && Number(cached.price) > 0 && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS)) {
      results[s] = cached;
    } else {
      missing.push(s);
    }
  });

  if (missing.length === 0) return results;

  let timedOut = false;
  const overallTimer = setTimeout(() => {
    timedOut = true;
    console.warn(`[getQuotesBatch] global timeout after ${BATCH_TIMEOUT_MS}ms, partial results (${Object.keys(results).length}/${missing.length})`);
  }, BATCH_TIMEOUT_MS);

  // Bulk spark warm-up: one Yahoo request covers up to 20 non-NSE symbols,
  // cutting cold-cycle request volume ~20x vs. per-symbol fetches. Any symbols
  // spark misses fall through to the per-symbol loop below.
  const nonNse = missing.filter(s => !s.startsWith('NSE:'));
  if (nonNse.length > 0) {
    try {
      const bulk = await yahooService.fetchQuotesBulk(nonNse);
      for (const s of Object.keys(bulk)) {
        const q = bulk[s];
        if (q && Number(q.price) > 0) {
          quoteCache.set(s, { ...q, symbol: s });
          results[s] = quoteCache.get(s);
        }
      }
    } catch (e) {
      console.warn(`[getQuotesBatch] bulk spark failed: ${e.message}`);
    }
  }

  const remaining = missing.filter(s => !results[s]);
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    if (timedOut) break;
    const batch = remaining.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(s => fetchQuoteForSymbol(s)));

    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const r = batchResults[j];
      const quote = r.status === 'fulfilled' ? r.value : null;

      if (quote && Number(quote.price) > 0) {
        quoteCache.set(s, { ...quote, symbol: s });
        results[s] = quoteCache.get(s);
      } else {
        const stale = quoteCache.get(s);
        if (stale && Number(stale.price) > 0) results[s] = stale;
      }
    }

    if (i + CONCURRENCY < remaining.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  clearTimeout(overallTimer);
  return results;
}

module.exports = { getStockQuote, getQuotesBatch, getCompanyName };
