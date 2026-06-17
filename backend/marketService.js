const { KENYAN_STOCKS } = require('./newsService');
const apifyNse = require('./apifyNseService');
const { fetchNseQuotes: fetchAfxQuotes, getQuoteForSymbol: getAfxQuote } = require('./nseAfxScraper');

apifyNse.startAutoRefresh();

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

// Unified Quote Cache
const quoteCache = new Map();
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000; // 5 minutes cache for market data




/**
 * Shared name mapper for consistent display
 */
function getCompanyName(symbol) {
  const ticker = symbol.replace('NSE:', '').toUpperCase();
  const names = {
    'SCOM': 'Safaricom', 'EQTY': 'Equity Group', 'KCB': 'KCB Group', 'EABL': 'EABL',
    'ABSA': 'Absa Bank', 'SBIC': 'Stanbic Holdings', 'KLG': 'Kenya Airways',
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



/**
 * Fetches real-time price data using a unified logic for both NSE and Global stocks.
 */
async function getStockQuote(symbol) {
  if (!symbol) return null;
  let quote;
  
  // 1. Check Cache
  const cached = quoteCache.get(symbol);
  if (cached && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS)) {
    return cached;
  }

  // 2. For NSE stocks, try Apify actor first (most reliable)
  if (!quote && symbol.startsWith('NSE:')) {
    const cleanSym = symbol.replace('NSE:', '').toUpperCase();
    await apifyNse.fetchNseQuotes();
    const apifyQ = apifyNse.getQuoteForSymbol(symbol);
    if (apifyQ) {
      quote = { ...apifyQ, symbol: cleanSym };
    }
  }

  // 3. Try AFX scraper fallback for NSE stocks
  if (!quote && symbol.startsWith('NSE:')) {
    await fetchAfxQuotes();
    const afxQ = getAfxQuote(symbol);
    if (afxQ) {
      quote = { ...afxQ, symbol: symbol.replace('NSE:', '').toUpperCase() };
    }
  }

  // 4. Try Yahoo/RapidAPI for NSE stocks
  if (!quote && symbol.startsWith('NSE:')) {
    const { fetchNSEQuote } = require('./rapidApiService');
    quote = await fetchNSEQuote(symbol);
  }
  // 5. Try Yahoo/RapidAPI for global stocks
  if (!quote && !symbol.startsWith('NSE:')) {
    const { fetchGlobalQuote } = require('./rapidApiService');
    quote = await fetchGlobalQuote(symbol);
  }

  // 5. Update Cache and return
  if (quote) {
    console.log(`[MarketService] Caching quote for ${symbol}:`, quote);
    quoteCache.set(symbol, quote);
    return quote;
  }

  return null;
}

/**
 * Fetches multiple stock quotes in batch.
 */
async function getQuotesBatch(symbols) {
  let results = {};
  const missingSymbols = [];

  // Check cache first
  symbols.forEach(s => {
    const cached = quoteCache.get(s);
    if (cached && (Date.now() - (cached.timestamp * 1000) < MAX_QUOTE_AGE_MS)) {
      results[s] = cached;
    } else {
      missingSymbols.push(s);
    }
  });

  if (missingSymbols.length === 0) return results;
  
  const liveResults = await fetchLiveBatch(missingSymbols);
  
  // Merge live results (keep stale cache only if it was from a live provider)
  symbols.forEach(s => {
    if (liveResults[s]) {
      quoteCache.set(s, liveResults[s]);
      results[s] = liveResults[s];
    } else if (!results[s]) {
      const stale = quoteCache.get(s);
      if (stale && stale.provider !== 'synthetic') {
        results[s] = stale;
      }
    }
  });

  return results;
}

async function fetchLiveBatch(symbols) {
  let results = {};

  const hasNse = symbols.some(s => s.startsWith('NSE:'));

  // 0. For NSE stocks, try Apify actor first (most reliable)
  if (hasNse) {
    const apifyQuotes = await apifyNse.fetchNseQuotes();
    if (apifyQuotes && Object.keys(apifyQuotes).length > 0) {
      for (const sym of symbols) {
        const cleanSym = sym.replace('NSE:', '').toUpperCase();
        if (apifyQuotes[cleanSym]) {
          results[sym] = { ...apifyQuotes[cleanSym], symbol: cleanSym };
        }
      }
    }
  }

  // 1. For NSE stocks still missing, try AFX scraper fallback
  const missingNse = symbols.filter(s => s.startsWith('NSE:') && !results[s]);
  if (missingNse.length > 0) {
    const afxQuotes = await fetchAfxQuotes();
    if (afxQuotes) {
      for (const sym of missingNse) {
        const cleanSym = sym.replace('NSE:', '').toUpperCase();
        if (afxQuotes[cleanSym]) {
          results[sym] = { ...afxQuotes[cleanSym], symbol: cleanSym };
        }
      }
    }
  }

  // 2. Try Yahoo Finance via RapidAPI for remaining NSE stocks
  const stillMissingNse = symbols.filter(s => s.startsWith('NSE:') && !results[s]);
  if (stillMissingNse.length > 0 && RAPIDAPI_KEY) {
    const { fetchBatchNSEQuotes } = require('./rapidApiService');
    const rapidResults = await fetchBatchNSEQuotes(stillMissingNse);
    results = { ...results, ...rapidResults };
  }

  // 3. Try Yahoo/RapidAPI for global stocks
  const missingGlobal = symbols.filter(s => !results[s] && !s.startsWith('NSE:'));
  if (missingGlobal.length > 0) {
    const { fetchBatchGlobalQuotes } = require('./rapidApiService');
    const yahooResults = await fetchBatchGlobalQuotes(missingGlobal);
    results = { ...results, ...yahooResults };
  }
  return results;
}

module.exports = { getStockQuote, getQuotesBatch, getCompanyName };
