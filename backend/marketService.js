const { eodhd, fmp } = require('./apiClient');
const { KENYAN_STOCKS } = require('./newsService');
const { fetchNseQuotes, getQuoteForSymbol } = require('./nseAfxScraper');

const FMP_API_KEY = process.env.FMP_API_KEY;
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const EODHD_API_KEY = process.env.EODHD_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const MARKET_DATA_PROVIDER = process.env.MARKET_DATA_PROVIDER || 'fmp';

// Unified Quote Cache and Base Data
const quoteCache = new Map();
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000; // 5 minutes cache for market data

const BASE_QUOTES = {
  'NSE:KUKZ': { company_name: 'Kakuzi PLC', price: 365, previousClose: 365, volume: 100000 },
  'NSE:KAPC': { company_name: 'Kapchorua Tea Kenya PLC', price: 275, previousClose: 275, volume: 100000 },
  'NSE:LIMT': { company_name: 'Limuru Tea Plc', price: 265, previousClose: 265, volume: 100000 },
  'NSE:WTK': { company_name: 'Williamson Tea Kenya PLC', price: 255, previousClose: 255, volume: 100000 },
  'NSE:SASN': { company_name: 'Sasini PLC', price: 21.75, previousClose: 21.75, volume: 100000 },
  'NSE:REA': { company_name: 'Rea Vipingo Plantations Ltd', price: 18.5, previousClose: 18.5, volume: 100000 },
  'NSE:EGAD': { company_name: 'Eaagads Ltd', price: 15, previousClose: 15, volume: 100000 },
  'NSE:CGEN': { company_name: 'Car & General (Kenya) PLC', price: 58, previousClose: 58, volume: 100000 },
  'NSE:EQTY': { company_name: 'Equity Group Holdings PLC', price: 46, previousClose: 46, volume: 100000 },
  'NSE:KCB': { company_name: 'KCB Group PLC', price: 39.55, previousClose: 39.55, volume: 100000 },
  'NSE:COOP': { company_name: 'Co-operative Bank of Kenya Ltd', price: 15.7, previousClose: 15.7, volume: 100000 },
  'NSE:ABSA': { company_name: 'Absa Bank Kenya PLC', price: 17.2, previousClose: 17.2, volume: 100000 },
  'NSE:SBIC': { company_name: 'Stanbic Holdings PLC', price: 140, previousClose: 140, volume: 100000 },
  'NSE:NCBA': { company_name: 'NCBA Group PLC', price: 52.5, previousClose: 52.5, volume: 100000 },
  'NSE:IMH': { company_name: 'I&M Group PLC', price: 42, previousClose: 42, volume: 100000 },
  'NSE:DTK': { company_name: 'Diamond Trust Bank Kenya Ltd', price: 65, previousClose: 65, volume: 100000 },
  'NSE:SCBK': { company_name: 'Standard Chartered Bank Kenya Ltd', price: 215, previousClose: 215, volume: 100000 },
  'NSE:BKG': { company_name: 'BK Group PLC', price: 38.5, previousClose: 38.5, volume: 100000 },
  'NSE:HFCK': { company_name: 'HF Group PLC', price: 5.85, previousClose: 5.85, volume: 100000 },
  'NSE:NMG': { company_name: 'Nation Media Group PLC', price: 185, previousClose: 185, volume: 100000 },
  'NSE:SGL': { company_name: 'Standard Group PLC', price: 12.5, previousClose: 12.5, volume: 100000 },
  'NSE:TPSE': { company_name: 'TPS Eastern Africa Ltd', price: 22, previousClose: 22, volume: 100000 },
  'NSE:SCAN': { company_name: 'WPP Scangroup Ltd', price: 3.85, previousClose: 3.85, volume: 100000 },
  'NSE:KQ': { company_name: 'Kenya Airways PLC', price: 4.35, previousClose: 4.35, volume: 100000 },
  'NSE:XPRS': { company_name: 'Express Kenya Ltd', price: 6.5, previousClose: 6.5, volume: 100000 },
  'NSE:SMER': { company_name: 'Sameer Africa PLC', price: 2.95, previousClose: 2.95, volume: 100000 },
  'NSE:BAMB': { company_name: 'Bamburi Cement PLC', price: 85, previousClose: 85, volume: 100000 },
  'NSE:PORT': { company_name: 'E.A. Portland Cement Co. Ltd', price: 25.5, previousClose: 25.5, volume: 100000 },
  'NSE:CRWN': { company_name: 'Crown Paints Kenya PLC', price: 58, previousClose: 58, volume: 100000 },
  'NSE:ARM': { company_name: 'ARM Cement PLC', price: 12, previousClose: 12, volume: 100000 },
  'NSE:KPLC': { company_name: 'Kenya Power & Lighting Co PLC', price: 2.15, previousClose: 2.15, volume: 100000 },
  'NSE:KEGN': { company_name: 'KenGen Co. PLC', price: 6.85, previousClose: 6.85, volume: 100000 },
  'NSE:TOTL': { company_name: 'TotalEnergies Marketing Kenya PLC', price: 42.5, previousClose: 42.5, volume: 100000 },
  'NSE:UMME': { company_name: 'Umeme Ltd', price: 18, previousClose: 18, volume: 100000 },
  'NSE:JUB': { company_name: 'Jubilee Holdings Ltd', price: 285, previousClose: 285, volume: 100000 },
  'NSE:KNRE': { company_name: 'Kenya Re-Insurance Corp Ltd', price: 3.25, previousClose: 3.25, volume: 100000 },
  'NSE:CIC': { company_name: 'CIC Insurance Group PLC', price: 2.95, previousClose: 2.95, volume: 100000 },
  'NSE:BRIT': { company_name: 'Britam Holdings PLC', price: 6.25, previousClose: 6.25, volume: 100000 },
  'NSE:LBTY': { company_name: 'Liberty Kenya Holdings Ltd', price: 8.5, previousClose: 8.5, volume: 100000 },
  'NSE:SLAM': { company_name: 'Sanlam Kenya PLC', price: 11.5, previousClose: 11.5, volume: 100000 },
  'NSE:CTUM': { company_name: 'Centum Investment Company PLC', price: 12.5, previousClose: 12.5, volume: 100000 },
  'NSE:OCH': { company_name: 'Olympia Capital Holdings Ltd', price: 3.75, previousClose: 3.75, volume: 100000 },
  'NSE:HAFR': { company_name: 'Home Afrika Ltd', price: 1.05, previousClose: 1.05, volume: 100000 },
  'NSE:NSE': { company_name: 'Nairobi Securities Exchange PLC', price: 11.5, previousClose: 11.5, volume: 100000 },
  'NSE:AMAC': { company_name: 'Africa Mega Agricorp PLC', price: 45, previousClose: 45, volume: 100000 },
  'NSE:EABL': { company_name: 'East African Breweries PLC', price: 175.25, previousClose: 175.25, volume: 100000 },
  'NSE:BAT': { company_name: 'British American Tobacco Kenya PLC', price: 395, previousClose: 395, volume: 100000 },
  'NSE:BOC': { company_name: 'B.O.C Kenya Ltd', price: 155, previousClose: 155, volume: 100000 },
  'NSE:CARB': { company_name: 'Carbacid Investments Ltd', price: 28.5, previousClose: 28.5, volume: 100000 },
  'NSE:UNGA': { company_name: 'Unga Group PLC', price: 18.5, previousClose: 18.5, volume: 100000 },
  'NSE:MSC': { company_name: 'Mumias Sugar Co. Ltd', price: 1.45, previousClose: 1.45, volume: 100000 },
  'NSE:FTGH': { company_name: 'Flame Tree Group Holdings Ltd', price: 2.15, previousClose: 2.15, volume: 100000 },
  'NSE:EVRD': { company_name: 'Eveready East Africa PLC', price: 1.15, previousClose: 1.15, volume: 100000 },
  'NSE:SCOM': { company_name: 'Safaricom PLC', price: 27.6, previousClose: 27.6, volume: 100000 },
  'NSE:LKL': { company_name: 'Longhorn Publishers Ltd', price: 3.25, previousClose: 3.25, volume: 100000 },
  'NSE:NBV': { company_name: 'Nairobi Business Ventures Ltd', price: 1.85, previousClose: 1.85, volume: 100000 },
  'NSE:UCHM': { company_name: 'Uchumi Supermarkets PLC', price: 0.85, previousClose: 0.85, volume: 100000 },
  'NSE:ALP': { company_name: 'ALP Real Estate Investment Trust', price: 1.02, previousClose: 1.02, volume: 1000 },
  'NSE:CABL': { company_name: 'East African Cables', price: 1.71, previousClose: 1.71, volume: 1000 },
  'NSE:DCON': { company_name: 'Deacons East Africa', price: 0.45, previousClose: 0.45, volume: 1000 },
  'NSE:GLD': { company_name: 'Absa NewGold ETF', price: 5315, previousClose: 5315, volume: 100 },
  'NSE:HBE': { company_name: 'Homeboyz Entertainment', price: 4.66, previousClose: 4.66, volume: 10000 },
  'NSE:KPC': { company_name: 'Kenya Pipeline Company', price: 9.12, previousClose: 9.10, volume: 158000 },
  'NSE:KPLC-P4': { company_name: 'Kenya Power 4% Preference Shares', price: 5.00, previousClose: 5.00, volume: 100 },
  'NSE:KPLC-P7': { company_name: 'Kenya Power 7% Preference Shares', price: 6.00, previousClose: 6.00, volume: 100 },
  'NSE:KURV': { company_name: 'Kurwitu Ventures Ltd', price: 1500, previousClose: 1500, volume: 100 },
  'NSE:LAPR': { company_name: 'Laptrust Imara Income-REIT', price: 20.00, previousClose: 20.00, volume: 1000 },
  'NSE:SKL': { company_name: 'Shri Krishana Overseas Ltd', price: 8.70, previousClose: 8.78, volume: 5000 },
  'NSE:SMWF': { company_name: 'Satrix MSCI World Feeder ETF', price: 950, previousClose: 948, volume: 13 },
  'NSE:TCL': { company_name: 'TransCentury Plc', price: 1.12, previousClose: 1.12, volume: 1000 },
  'AAL': { company_name: 'American Airlines Group, Inc.', price: 13.57, previousClose: 13.93, volume: 71520667 },
  'AAPL': { company_name: 'Apple Inc.', price: 310.26, previousClose: 315.2, volume: 50459550 },
  'ABBV': { company_name: 'AbbVie Inc.', price: 217.13, previousClose: 215.4, volume: 5568786 },
  'ABNB': { company_name: 'Airbnb, Inc.', price: 133.59, previousClose: 134.35, volume: 3588435 },
  'ABT': { company_name: 'Abbott Laboratories', price: 86.99, previousClose: 86.97, volume: 10377121 },
  'ACGL': { company_name: 'Arch Capital Group Ltd.', price: 87.89, previousClose: 87.62, volume: 2243716 },
  'ACI': { company_name: 'Albertsons Companies, Inc.', price: 15.71, previousClose: 15.59, volume: 3974669 },
  'ACN': { company_name: 'Accenture plc', price: 177.43, previousClose: 186.22, volume: 4715258 },
  'ADBE': { company_name: 'Adobe Inc.', price: 256.24, previousClose: 262.11, volume: 4851106 },
  'ADI': { company_name: 'Analog Devices, Inc.', price: 437.67, previousClose: 423.2, volume: 5666146 },
  'ADP': { company_name: 'Automatic Data Processing, Inc.', price: 227.75, previousClose: 231.18, volume: 2563924 },
  'AEP': { company_name: 'American Electric Power Company', price: 126.31, previousClose: 127.11, volume: 4943466 },
  'AFL': { company_name: 'AFLAC Incorporated', price: 114.5, previousClose: 113.63, volume: 3930897 },
  'AFRM': { company_name: 'Affirm Holdings, Inc.', price: 66.27, previousClose: 71.01, volume: 5308536 },
  'AIG': { company_name: 'American International Group, I', price: 72.55, previousClose: 73.8, volume: 2169513 },
  'ALB': { company_name: 'Albemarle Corporation', price: 168.34, previousClose: 171.77, volume: 1174095 },
  'ALGN': { company_name: 'Align Technology, Inc.', price: 161.71, previousClose: 166.69, volume: 1068896 },
  'ALL': { company_name: 'Allstate Corporation (The)', price: 209.34, previousClose: 210.46, volume: 1314414 },
  'AMAT': { company_name: 'Applied Materials, Inc.', price: 500.77, previousClose: 490.05, volume: 8232105 },
  'AMC': { company_name: 'AMC Entertainment Holdings, Inc', price: 1.83, previousClose: 2.07, volume: 27753062 },
  'AMD': { company_name: 'Advanced Micro Devices, Inc.', price: 542.52, previousClose: 521.54, volume: 28701602 },
  'AME': { company_name: 'AMETEK, Inc.', price: 228.23, previousClose: 227.73, volume: 631670 },
  'AMGN': { company_name: 'Amgen Inc.', price: 338.22, previousClose: 328.26, volume: 2279106 },
  'AMT': { company_name: 'American Tower Corporation (REI', price: 182.24, previousClose: 185.53, volume: 5076279 },
  'AMZN': { company_name: 'Amazon.com, Inc.', price: 250.02, previousClose: 256.52, volume: 50988687 },
  'APD': { company_name: 'Air Products and Chemicals, Inc', price: 282.27, previousClose: 279.29, volume: 633278 },
  'APH': { company_name: 'Amphenol Corporation', price: 147.62, previousClose: 148.4, volume: 8449756 },
  'AVB': { company_name: 'AvalonBay Communities, Inc.', price: 183.19, previousClose: 183.38, volume: 446393 },
  'AVGO': { company_name: 'Broadcom Inc.', price: 479.23, previousClose: 481.57, volume: 36128462 },
  'AXP': { company_name: 'American Express Company', price: 300.57, previousClose: 310.97, volume: 3066790 },
  'AZO': { company_name: 'AutoZone, Inc.', price: 3061.65, previousClose: 3029.36, volume: 392710 },
  'BA': { company_name: 'Boeing Company (The)', price: 210.58, previousClose: 217.7, volume: 9070534 },
  'BAC': { company_name: 'Bank of America Corporation', price: 52.4, previousClose: 52.48, volume: 47867902 },
  'BBY': { company_name: 'Best Buy Co., Inc.', price: 71.73, previousClose: 72.78, volume: 4364172 },
  'BDX': { company_name: 'Becton, Dickinson and Company', price: 145.61, previousClose: 144.43, volume: 1304633 },
  'BIIB': { company_name: 'Biogen Inc.', price: 195.96, previousClose: 188.83, volume: 891412 },
  'BK': { company_name: 'The Bank of New York Mellon Cor', price: 137.16, previousClose: 137.16, volume: 2204204 },
  'BKR': { company_name: 'Baker Hughes Company', price: 64.27, previousClose: 64.54, volume: 6185134 },
  'BLK': { company_name: 'BlackRock, Inc.', price: 990.87, previousClose: 1018.96, volume: 790781 },
  'BSX': { company_name: 'Boston Scientific Corporation', price: 47.69, previousClose: 47.68, volume: 24106899 },
  'C': { company_name: 'Citigroup, Inc.', price: 129.93, previousClose: 131.26, volume: 8868680 },
  'CARR': { company_name: 'Carrier Global Corporation', price: 67.58, previousClose: 66.42, volume: 4670845 },
  'CAT': { company_name: 'Caterpillar, Inc.', price: 926.18, previousClose: 909.81, volume: 2397476 },
  'CB': { company_name: 'Chubb Limited', price: 312.75, previousClose: 312.27, volume: 1741453 },
  'CCI': { company_name: 'Crown Castle Inc.', price: 88.62, previousClose: 89.92, volume: 3315223 },
  'CDNS': { company_name: 'Cadence Design Systems, Inc.', price: 408, previousClose: 416.39, volume: 2842220 },
  'CF': { company_name: 'CF Industries Holdings, Inc.', price: 116.6, previousClose: 113.48, volume: 2426002 },
  'CFG': { company_name: 'Citizens Financial Group, Inc.', price: 61.53, previousClose: 62.31, volume: 2495366 },
  'CHD': { company_name: 'Church & Dwight Company, Inc.', price: 92.89, previousClose: 96.14, volume: 2403731 },
  'CHPT': { company_name: 'ChargePoint Holdings, Inc.', price: 7.61, previousClose: 8.17, volume: 839774 },
  'CHTR': { company_name: 'Charter Communications, Inc.', price: 129.01, previousClose: 140.27, volume: 4346195 },
  'CHWY': { company_name: 'Chewy, Inc.', price: 21.04, previousClose: 21.47, volume: 7015122 },
  'CI': { company_name: 'The Cigna Group', price: 270.73, previousClose: 272.72, volume: 975776 },
  'CL': { company_name: 'Colgate-Palmolive Company', price: 84.87, previousClose: 88.27, volume: 6012747 },
  'CLSK': { company_name: 'CleanSpark, Inc.', price: 17.61, previousClose: 17.58, volume: 22149978 },
  'CMCSA': { company_name: 'Comcast Corporation', price: 23.52, previousClose: 24.85, volume: 43150334 },
  'CME': { company_name: 'CME Group Inc.', price: 252.64, previousClose: 250.53, volume: 4732103 },
  'CMG': { company_name: 'Chipotle Mexican Grill, Inc.', price: 28.74, previousClose: 29.26, volume: 20576694 },
  'CMI': { company_name: 'Cummins Inc.', price: 682.33, previousClose: 672.67, volume: 642291 },
  'COIN': { company_name: 'Coinbase Global, Inc.', price: 163.22, previousClose: 173.99, volume: 9234671 },
  'COP': { company_name: 'ConocoPhillips', price: 119.05, previousClose: 116.87, volume: 6635924 },
  'COST': { company_name: 'Costco Wholesale Corporation', price: 961.83, previousClose: 954.27, volume: 1944764 },
  'CPRT': { company_name: 'Copart, Inc.', price: 30.35, previousClose: 30.86, volume: 9395118 },
  'CRM': { company_name: 'Salesforce, Inc.', price: 190.61, previousClose: 200.84, volume: 13965525 },
  'CRWD': { company_name: 'CrowdStrike Holdings, Inc.', price: 747.61, previousClose: 768.95, volume: 4865502 },
  'CSCO': { company_name: 'Cisco Systems, Inc.', price: 126.5, previousClose: 128, volume: 29265646 },
  'CTAS': { company_name: 'Cintas Corporation', price: 174.72, previousClose: 173.31, volume: 1926924 },
  'CVX': { company_name: 'Chevron Corporation', price: 189.71, previousClose: 187.55, volume: 7216830 },
  'CZR': { company_name: 'Caesars Entertainment, Inc.', price: 29.18, previousClose: 29.22, volume: 8650085 },
  'DAL': { company_name: 'Delta Air Lines, Inc.', price: 78.78, previousClose: 80.02, volume: 4581009 },
  'DASH': { company_name: 'DoorDash, Inc.', price: 154.58, previousClose: 156.95, volume: 3964610 },
  'DD': { company_name: 'DuPont de Nemours, Inc.', price: 47.97, previousClose: 48.66, volume: 2223821 },
  'DDOG': { company_name: 'Datadog, Inc.', price: 250.33, previousClose: 269.13, volume: 8238490 },
  'DE': { company_name: 'Deere & Company', price: 588.29, previousClose: 579.25, volume: 1838741 },
  'DG': { company_name: 'Dollar General Corporation', price: 105.09, previousClose: 106.27, volume: 4592866 },
  'DHI': { company_name: 'D.R. Horton, Inc.', price: 144.5, previousClose: 147.91, volume: 1666776 },
  'DHR': { company_name: 'Danaher Corporation', price: 178.08, previousClose: 176.11, volume: 2274263 },
  'DIS': { company_name: 'Walt Disney Company (The)', price: 99.39, previousClose: 101.41, volume: 7402411 },
  'DKNG': { company_name: 'DraftKings Inc.', price: 25.11, previousClose: 25.3, volume: 7208605 },
  'DLR': { company_name: 'Digital Realty Trust, Inc.', price: 183.5, previousClose: 187.26, volume: 2602554 },
  'DLTR': { company_name: 'Dollar Tree, Inc.', price: 112.5, previousClose: 109.39, volume: 2927124 },
  'DOCU': { company_name: 'DocuSign, Inc.', price: 52.4, previousClose: 55.1, volume: 3196864 },
  'DOV': { company_name: 'Dover Corporation', price: 213.51, previousClose: 211.84, volume: 655468 },
  'DOW': { company_name: 'Dow Inc.', price: 35.4, previousClose: 34.72, volume: 10379927 },
  'DUK': { company_name: 'Duke Energy Corporation (Holdin', price: 121.04, previousClose: 121.09, volume: 2294243 },
  'DVN': { company_name: 'Devon Energy Corporation', price: 46.18, previousClose: 46.22, volume: 11223738 },
  'DXCM': { company_name: 'DexCom, Inc.', price: 72.77, previousClose: 73.45, volume: 4004984 },
  'EA': { company_name: 'Electronic Arts Inc.', price: 202.63, previousClose: 202.01, volume: 1572320 },
  'EBAY': { company_name: 'eBay Inc.', price: 108.82, previousClose: 108.88, volume: 3002957 },
  'ECL': { company_name: 'Ecolab Inc.', price: 255.67, previousClose: 256.26, volume: 866688 },
  'ED': { company_name: 'Consolidated Edison, Inc.', price: 103.48, previousClose: 103.79, volume: 1994333 },
  'EIX': { company_name: 'Edison International', price: 70.86, previousClose: 70.92, volume: 2370525 },
  'ELV': { company_name: 'Elevance Health, Inc.', price: 391.27, previousClose: 389.03, volume: 797138 },
  'EMR': { company_name: 'Emerson Electric Company', price: 140.88, previousClose: 142.03, volume: 2241517 },
  'ENPH': { company_name: 'Enphase Energy, Inc.', price: 69.02, previousClose: 72.33, volume: 4830657 },
  'ENTG': { company_name: 'Entegris, Inc.', price: 140.33, previousClose: 142.92, volume: 2261329 },
  'EOG': { company_name: 'EOG Resources, Inc.', price: 141.5, previousClose: 138.58, volume: 3031279 },
  'EQIX': { company_name: 'Equinix, Inc.', price: 1077, previousClose: 1071.8, volume: 703736 },
  'EQR': { company_name: 'Equity Residential', price: 66.14, previousClose: 66.21, volume: 1773244 },
  'ETN': { company_name: 'Eaton Corporation, PLC', price: 421.21, previousClose: 417.62, volume: 2147169 },
  'ETSY': { company_name: 'Etsy, Inc.', price: 67.05, previousClose: 69.73, volume: 2580596 },
  'EW': { company_name: 'Edwards Lifesciences Corporatio', price: 86, previousClose: 87.66, volume: 4141426 },
  'EXC': { company_name: 'Exelon Corporation', price: 45.08, previousClose: 45, volume: 11370219 },
  'F': { company_name: 'Ford Motor Company', price: 15.71, previousClose: 16.15, volume: 58122004 },
  'FANG': { company_name: 'Diamondback Energy, Inc.', price: 210.59, previousClose: 202.4, volume: 3015505 },
  'FAST': { company_name: 'Fastenal Company', price: 46.46, previousClose: 44.73, volume: 8074648 },
  'FCX': { company_name: 'Freeport-McMoRan, Inc.', price: 70.64, previousClose: 71.72, volume: 13627016 },
  'FDS': { company_name: 'FactSet Research Systems Inc.', price: 253.44, previousClose: 255.82, volume: 634570 },
  'FDX': { company_name: 'FedEx Corporation', price: 324.46, previousClose: 329, volume: 1589445 },
  'FIS': { company_name: 'Fidelity National Information S', price: 40.86, previousClose: 42.52, volume: 6941562 },
  'FITB': { company_name: 'Fifth Third Bancorp', price: 49.49, previousClose: 50.31, volume: 6561786 },
  'FOXA': { company_name: 'Fox Corporation', price: 64.28, previousClose: 65.69, volume: 1864143 },
  'FTNT': { company_name: 'Fortinet, Inc.', price: 146.48, previousClose: 148.86, volume: 7650752 },
  'GD': { company_name: 'General Dynamics Corporation', price: 337.04, previousClose: 337.61, volume: 628547 },
  'GE': { company_name: 'GE Aerospace', price: 314.64, previousClose: 317.72, volume: 3184733 },
  'GILD': { company_name: 'Gilead Sciences, Inc.', price: 128.99, previousClose: 127.57, volume: 6206384 },
  'GIS': { company_name: 'General Mills, Inc.', price: 32.17, previousClose: 33.07, volume: 11248251 },
  'GLW': { company_name: 'Corning Incorporated', price: 200.76, previousClose: 200.4, volume: 11710019 },
  'GM': { company_name: 'General Motors Company', price: 81.7, previousClose: 81.73, volume: 7060277 },
  'GME': { company_name: 'GameStop Corporation', price: 22.18, previousClose: 20.92, volume: 17734037 },
  'GOOGL': { company_name: 'Alphabet Inc.', price: 358.99, previousClose: 361.85, volume: 52636770 },
  'GPC': { company_name: 'Genuine Parts Company', price: 98.28, previousClose: 99.35, volume: 905339 },
  'GPN': { company_name: 'Global Payments Inc.', price: 67.85, previousClose: 74.03, volume: 10802912 },
  'GS': { company_name: 'Goldman Sachs Group, Inc. (The)', price: 1041.02, previousClose: 1064.58, volume: 1830392 },
  'GWW': { company_name: 'W.W. Grainger, Inc.', price: 1284.22, previousClose: 1268.36, volume: 232632 },
  'HAL': { company_name: 'Halliburton Company', price: 41.03, previousClose: 39.96, volume: 8576312 },
  'HBAN': { company_name: 'Huntington Bancshares Incorpora', price: 15.93, previousClose: 16.23, volume: 29506089 },
  'HCA': { company_name: 'HCA Healthcare, Inc.', price: 363.23, previousClose: 367.35, volume: 1906908 },
  'HD': { company_name: 'Home Depot, Inc. (The)', price: 312.97, previousClose: 311.52, volume: 3250047 },
  'HLT': { company_name: 'Hilton Worldwide Holdings Inc.', price: 331.37, previousClose: 332.85, volume: 912506 },
  'HMC': { company_name: 'Honda Motor Company, Ltd.', price: 27.71, previousClose: 26.48, volume: 2731003 },
  'HOLX': { company_name: 'Hologic, Inc.', price: 76.01, previousClose: 76.01, volume: 101956189 },
  'HON': { company_name: 'Honeywell International Inc.', price: 223.26, previousClose: 235.23, volume: 6129946 },
  'HOOD': { company_name: 'Robinhood Markets, Inc.', price: 82.85, previousClose: 88.16, volume: 23782951 },
  'HSY': { company_name: 'The Hershey Company', price: 183.2, previousClose: 184.09, volume: 1119748 },
  'IBM': { company_name: 'International Business Machines', price: 305.63, previousClose: 329.23, volume: 13648193 },
  'ICE': { company_name: 'Intercontinental Exchange Inc.', price: 138.45, previousClose: 142.38, volume: 3972258 },
  'IDXX': { company_name: 'IDEXX Laboratories, Inc.', price: 560.73, previousClose: 550.82, volume: 882409 },
  'IFF': { company_name: 'International Flavors & Fragran', price: 73.56, previousClose: 73.24, volume: 1819152 },
  'INTC': { company_name: 'Intel Corporation', price: 112.71, previousClose: 107.93, volume: 116558375 },
  'IP': { company_name: 'International Paper Company', price: 33.4, previousClose: 33.83, volume: 3259380 },
  'IR': { company_name: 'Ingersoll Rand Inc.', price: 70.07, previousClose: 71.62, volume: 3437401 },
  'ISRG': { company_name: 'Intuitive Surgical, Inc.', price: 407.29, previousClose: 402.3, volume: 2631489 },
  'ITW': { company_name: 'Illinois Tool Works Inc.', price: 250.26, previousClose: 248.58, volume: 723500 },
  'JCI': { company_name: 'Johnson Controls International ', price: 146.96, previousClose: 141.99, volume: 5297300 },
  'JNJ': { company_name: 'Johnson & Johnson', price: 223.24, previousClose: 222.89, volume: 4565701 },
  'JPM': { company_name: 'JP Morgan Chase & Co.', price: 300.85, previousClose: 300.96, volume: 4995890 },
  'KEY': { company_name: 'KeyCorp', price: 20.88, previousClose: 21.18, volume: 9537744 },
  'KEYS': { company_name: 'Keysight Technologies Inc.', price: 350.48, previousClose: 346.57, volume: 1469908 },
  'KHC': { company_name: 'The Kraft Heinz Company', price: 22.76, previousClose: 23.33, volume: 17946798 },
  'KLAC': { company_name: 'KLA Corporation', price: 2125.11, previousClose: 2045.2, volume: 1001212 },
  'KMB': { company_name: 'Kimberly-Clark Corporation', price: 94.76, previousClose: 97.49, volume: 6629459 },
  'KMI': { company_name: 'Kinder Morgan, Inc.', price: 31.37, previousClose: 31.44, volume: 6052528 },
  'KO': { company_name: 'Coca-Cola Company (The)', price: 78.76, previousClose: 78.41, volume: 14783800 },
  'KR': { company_name: 'Kroger Company (The)', price: 61.23, previousClose: 61.56, volume: 5534550 },
  'LCID': { company_name: 'Lucid Group, Inc.', price: 5.72, previousClose: 6.17, volume: 15549258 },
  'LEN': { company_name: 'Lennar Corporation', price: 89.46, previousClose: 90.9, volume: 1378099 },
  'LHX': { company_name: 'L3Harris Technologies, Inc.', price: 303.45, previousClose: 308.12, volume: 703663 },
  'LLY': { company_name: 'Eli Lilly and Company', price: 1078.78, previousClose: 1064.15, volume: 1965898 },
  'LMT': { company_name: 'Lockheed Martin Corporation', price: 512.03, previousClose: 513.43, volume: 1042089 },
  'LOW': { company_name: 'Lowe\u0027s Companies, Inc.', price: 207.65, previousClose: 206.64, volume: 3181549 },
  'LRCX': { company_name: 'Lam Research Corporation', price: 343.71, previousClose: 334.41, volume: 8478289 },
  'LULU': { company_name: 'lululemon athletica inc.', price: 126.03, previousClose: 126.47, volume: 2852861 },
  'LUV': { company_name: 'Southwest Airlines Company', price: 40.87, previousClose: 42.34, volume: 3732288 },
  'LVS': { company_name: 'Las Vegas Sands Corp.', price: 50.86, previousClose: 51.21, volume: 2247130 },
  'LYV': { company_name: 'Live Nation Entertainment, Inc.', price: 164.25, previousClose: 167.64, volume: 1669755 },
  'MAR': { company_name: 'Marriott International', price: 376.75, previousClose: 373.76, volume: 976187 },
  'MARA': { company_name: 'MARA Holdings, Inc.', price: 13.96, previousClose: 14.28, volume: 31634053 },
  'MAS': { company_name: 'Masco Corporation', price: 69.56, previousClose: 69, volume: 2049745 },
  'MCD': { company_name: 'McDonald\u0027s Corporation', price: 273.29, previousClose: 276.36, volume: 4233643 },
  'MCHP': { company_name: 'Microchip Technology Incorporat', price: 96.55, previousClose: 96.96, volume: 10234581 },
  'MCK': { company_name: 'McKesson Corporation', price: 739.53, previousClose: 736.78, volume: 556832 },
  'MCO': { company_name: 'Moody\u0027s Corporation', price: 448.39, previousClose: 453.6, volume: 605463 },
  'MDB': { company_name: 'MongoDB, Inc.', price: 368.32, previousClose: 398.46, volume: 2032384 },
  'MDLZ': { company_name: 'Mondelez International, Inc.', price: 61.31, previousClose: 61.07, volume: 6359122 },
  'MDT': { company_name: 'Medtronic plc.', price: 77.95, previousClose: 73.75, volume: 16480972 },
  'MET': { company_name: 'MetLife, Inc.', price: 80.96, previousClose: 82.82, volume: 2508854 },
  'META': { company_name: 'Meta Platforms, Inc.', price: 622.98, previousClose: 597.63, volume: 20346772 },
  'MGM': { company_name: 'MGM Resorts International', price: 48.3, previousClose: 48.36, volume: 4741553 },
  'MHK': { company_name: 'Mohawk Industries, Inc.', price: 104.88, previousClose: 105.66, volume: 344188 },
  'MLM': { company_name: 'Martin Marietta Materials, Inc.', price: 583.15, previousClose: 576.93, volume: 316961 },
  'MMM': { company_name: '3M Company', price: 151.65, previousClose: 152.9, volume: 1904046 },
  'MNST': { company_name: 'Monster Beverage Corporation', price: 89.04, previousClose: 88.24, volume: 4310287 },
  'MOS': { company_name: 'Mosaic Company (The)', price: 23.3, previousClose: 23.3, volume: 5163657 },
  'MPC': { company_name: 'Marathon Petroleum Corporation', price: 267.21, previousClose: 263.06, volume: 1894032 },
  'MPWR': { company_name: 'Monolithic Power Systems, Inc.', price: 1689.89, previousClose: 1624.99, volume: 423394 },
  'MRK': { company_name: 'Merck & Company, Inc.', price: 114.7, previousClose: 115.65, volume: 6012833 },
  'MRNA': { company_name: 'Moderna, Inc.', price: 49.06, previousClose: 45.64, volume: 6750360 },
  'MS': { company_name: 'Morgan Stanley', price: 210.14, previousClose: 214.98, volume: 5951526 },
  'MSCI': { company_name: 'MSCI Inc.', price: 613.58, previousClose: 630.27, volume: 483356 },
  'MSFT': { company_name: 'Microsoft Corporation', price: 427.34, previousClose: 441.31, volume: 35953959 },
  'MTB': { company_name: 'M&T Bank Corporation', price: 214.03, previousClose: 217.29, volume: 630809 },
  'MU': { company_name: 'Micron Technology, Inc.', price: 1079.57, previousClose: 1064.1, volume: 39267880 },
  'NDAQ': { company_name: 'Nasdaq, Inc.', price: 86.81, previousClose: 87.91, volume: 3609330 },
  'NDSN': { company_name: 'Nordson Corporation', price: 289.45, previousClose: 287.73, volume: 238043 },
  'NEE': { company_name: 'NextEra Energy, Inc.', price: 84.58, previousClose: 85.68, volume: 11889021 },
  'NEM': { company_name: 'Newmont Corporation', price: 107.47, previousClose: 109.5, volume: 5909539 },
  'NET': { company_name: 'Cloudflare, Inc.', price: 265.33, previousClose: 272.66, volume: 3881387 },
  'NFLX': { company_name: 'Netflix, Inc.', price: 81.52, previousClose: 83.33, volume: 35883664 },
  'NKE': { company_name: 'Nike, Inc.', price: 43.81, previousClose: 43.73, volume: 18777926 },
  'NOC': { company_name: 'Northrop Grumman Corporation', price: 526.06, previousClose: 536.59, volume: 1153703 },
  'NOW': { company_name: 'ServiceNow, Inc.', price: 117.9, previousClose: 127.65, volume: 32944378 },
  'NTRS': { company_name: 'Northern Trust Corporation', price: 168.45, previousClose: 169.79, volume: 824550 },
  'NUE': { company_name: 'Nucor Corporation', price: 257.73, previousClose: 258.46, volume: 1081868 },
  'NVDA': { company_name: 'NVIDIA Corporation', price: 214.75, previousClose: 222.82, volume: 150147825 },
  'NVR': { company_name: 'NVR, Inc.', price: 6119.41, previousClose: 6180.96, volume: 22397 },
  'NWSA': { company_name: 'News Corporation', price: 26.05, previousClose: 26.41, volume: 3578783 },
  'NXPI': { company_name: 'NXP Semiconductors N.V.', price: 321.88, previousClose: 323.62, volume: 2820092 },
  'O': { company_name: 'Realty Income Corporation', price: 59.72, previousClose: 59.91, volume: 5716554 },
  'OKE': { company_name: 'ONEOK, Inc.', price: 86.75, previousClose: 86.72, volume: 2758205 },
  'OMC': { company_name: 'Omnicom Group Inc.', price: 73.74, previousClose: 75.22, volume: 2489826 },
  'ON': { company_name: 'ON Semiconductor Corporation', price: 133.93, previousClose: 128.64, volume: 9600734 },
  'ORCL': { company_name: 'Oracle Corporation', price: 230.33, previousClose: 244.58, volume: 22677033 },
  'ORLY': { company_name: 'O\u0027Reilly Automotive, Inc.', price: 87.38, previousClose: 86.23, volume: 7270526 },
  'OTIS': { company_name: 'Otis Worldwide Corporation', price: 69.92, previousClose: 70.33, volume: 2945518 },
  'OXY': { company_name: 'Occidental Petroleum Corporatio', price: 59.64, previousClose: 59.09, volume: 8576429 },
  'PANW': { company_name: 'Palo Alto Networks, Inc.', price: 280.43, previousClose: 297.18, volume: 14527883 },
  'PCAR': { company_name: 'PACCAR Inc.', price: 114.38, previousClose: 112.89, volume: 2999208 },
  'PEG': { company_name: 'Public Service Enterprise Group', price: 77.75, previousClose: 78.32, volume: 2020646 },
  'PEP': { company_name: 'Pepsico, Inc.', price: 142.54, previousClose: 142, volume: 5729566 },
  'PFE': { company_name: 'Pfizer, Inc.', price: 25.34, previousClose: 25.55, volume: 30890224 },
  'PG': { company_name: 'Procter & Gamble Company (The)', price: 140.19, previousClose: 140.82, volume: 9333006 },
  'PGR': { company_name: 'Progressive Corporation (The)', price: 193.46, previousClose: 196.82, volume: 2138495 },
  'PH': { company_name: 'Parker-Hannifin Corporation', price: 850.76, previousClose: 836.32, volume: 1096931 },
  'PHM': { company_name: 'PulteGroup, Inc.', price: 117.21, previousClose: 117.77, volume: 1164452 },
  'PINS': { company_name: 'Pinterest, Inc.', price: 20.67, previousClose: 20.87, volume: 13135210 },
  'PLD': { company_name: 'Prologis, Inc.', price: 141.82, previousClose: 140.41, volume: 2460778 },
  'PLTR': { company_name: 'Palantir Technologies Inc.', price: 142.2, previousClose: 152.17, volume: 40559578 },
  'PLUG': { company_name: 'Plug Power, Inc.', price: 3.69, previousClose: 4.09, volume: 70392267 },
  'PNC': { company_name: 'PNC Financial Services Group, I', price: 218.27, previousClose: 221, volume: 1803329 },
  'PPG': { company_name: 'PPG Industries, Inc.', price: 111.39, previousClose: 113.64, volume: 1087276 },
  'PRU': { company_name: 'Prudential Financial, Inc.', price: 100.79, previousClose: 102.72, volume: 1815373 },
  'PSA': { company_name: 'Public Storage', price: 301.97, previousClose: 299.14, volume: 501269 },
  'PSX': { company_name: 'Phillips 66', price: 184.68, previousClose: 182.56, volume: 1817763 },
  'PTC': { company_name: 'PTC Inc.', price: 139.72, previousClose: 142.34, volume: 1381405 },
  'PWR': { company_name: 'Quanta Services, Inc.', price: 715.67, previousClose: 706.06, volume: 695700 },
  'PYPL': { company_name: 'PayPal Holdings, Inc.', price: 42.61, previousClose: 44.53, volume: 19172430 },
  'QCOM': { company_name: 'QUALCOMM Incorporated', price: 250.01, previousClose: 240.84, volume: 19283012 },
  'QRVO': { company_name: 'Qorvo, Inc.', price: 104.73, previousClose: 102.74, volume: 1064625 },
  'RBLX': { company_name: 'Roblox Corporation', price: 43.68, previousClose: 45, volume: 8654721 },
  'REGN': { company_name: 'Regeneron Pharmaceuticals, Inc.', price: 618.95, previousClose: 602.92, volume: 951536 },
  'RF': { company_name: 'Regions Financial Corporation', price: 27.4, previousClose: 28.03, volume: 10920532 },
  'RIOT': { company_name: 'Riot Platforms, Inc.', price: 27.65, previousClose: 27.32, volume: 15776666 },
  'RIVN': { company_name: 'Rivian Automotive, Inc.', price: 18.27, previousClose: 17.29, volume: 50341145 },
  'RMD': { company_name: 'ResMed Inc.', price: 186.46, previousClose: 182.82, volume: 1313602 },
  'ROK': { company_name: 'Rockwell Automation, Inc.', price: 461.73, previousClose: 463.41, volume: 514947 },
  'ROST': { company_name: 'Ross Stores, Inc.', price: 232.62, previousClose: 223.82, volume: 2666513 },
  'RSG': { company_name: 'Republic Services, Inc.', price: 204.2, previousClose: 201.67, volume: 1517530 },
  'RTX': { company_name: 'RTX Corporation', price: 172.55, previousClose: 174.26, volume: 4228575 },
  'SBAC': { company_name: 'SBA Communications Corporation', price: 196.58, previousClose: 196.21, volume: 1447590 },
  'SBUX': { company_name: 'Starbucks Corporation', price: 95.89, previousClose: 95.51, volume: 8524490 },
  'SCHW': { company_name: 'Charles Schwab Corporation (The', price: 86.59, previousClose: 87.61, volume: 11222984 },
  'SEDG': { company_name: 'SolarEdge Technologies, Inc.', price: 74.02, previousClose: 78.51, volume: 2586131 },
  'SFM': { company_name: 'Sprouts Farmers Market, Inc.', price: 78.98, previousClose: 78.05, volume: 1595451 },
  'SHW': { company_name: 'Sherwin-Williams Company (The)', price: 296.49, previousClose: 293, volume: 2037884 },
  'SIRI': { company_name: 'SiriusXM Holdings Inc.', price: 28.08, previousClose: 28.77, volume: 3645785 },
  'SLB': { company_name: 'SLB Limited', price: 56.85, previousClose: 56.265, volume: 11386488 },
  'SNA': { company_name: 'Snap-On Incorporated', price: 377.39, previousClose: 372.45, volume: 167490 },
  'SNAP': { company_name: 'Snap Inc.', price: 5.73, previousClose: 5.76, volume: 33273140 },
  'SNOW': { company_name: 'Snowflake Inc.', price: 241.28, previousClose: 261.14, volume: 10252542 },
  'SNPS': { company_name: 'Synopsys, Inc.', price: 498.02, previousClose: 508.35, volume: 1483647 },
  'SO': { company_name: 'Southern Company (The)', price: 90.49, previousClose: 90.51, volume: 6560807 },
  'SOFI': { company_name: 'SoFi Technologies, Inc.', price: 16.68, previousClose: 17.74, volume: 71943015 },
  'SPG': { company_name: 'Simon Property Group, Inc.', price: 203.55, previousClose: 203.53, volume: 1125013 },
  'SPGI': { company_name: 'S&P Global Inc.', price: 412.29, previousClose: 417.46, volume: 1599411 },
  'SPOT': { company_name: 'Spotify Technology S.A.', price: 487.54, previousClose: 501.5, volume: 1732009 },
  'SRE': { company_name: 'DBA Sempra', price: 89.53, previousClose: 89.55, volume: 3615128 },
  'STLD': { company_name: 'Steel Dynamics, Inc.', price: 275.13, previousClose: 271.41, volume: 1044549 },
  'STT': { company_name: 'State Street Corporation', price: 157.88, previousClose: 159.78, volume: 879080 },
  'STX': { company_name: 'Seagate Technology Holdings PLC', price: 940.69, previousClose: 926.61, volume: 2883334 },
  'STZ': { company_name: 'Constellation Brands, Inc.', price: 135.4, previousClose: 136.76, volume: 921674 },
  'SWK': { company_name: 'Stanley Black & Decker, Inc.', price: 78.59, previousClose: 79.14, volume: 695831 },
  'SWKS': { company_name: 'Skyworks Solutions, Inc.', price: 80.66, previousClose: 79.12, volume: 3347306 },
  'SYK': { company_name: 'Stryker Corporation', price: 295, previousClose: 293.3, volume: 1767167 },
  'SYY': { company_name: 'Sysco Corporation', price: 75.24, previousClose: 74.1, volume: 1928611 },
  'T': { company_name: 'AT&T Inc.', price: 23.55, previousClose: 24.64, volume: 51623772 },
  'TDG': { company_name: 'Transdigm Group Incorporated', price: 1211.57, previousClose: 1246.98, volume: 357069 },
  'TEL': { company_name: 'TE Connectivity plc', price: 218.39, previousClose: 214.73, volume: 2201995 },
  'TER': { company_name: 'Teradyne, Inc.', price: 409.67, previousClose: 392.62, volume: 3096667 },
  'TFC': { company_name: 'Truist Financial Corporation', price: 47.42, previousClose: 48.12, volume: 6047551 },
  'TGT': { company_name: 'Target Corporation', price: 124.8, previousClose: 123.18, volume: 3168480 },
  'TJX': { company_name: 'TJX Companies, Inc. (The)', price: 157.9, previousClose: 153.69, volume: 5841451 },
  'TM': { company_name: 'Toyota Motor Corporation', price: 180.22, previousClose: 180.49, volume: 475025 },
  'TMO': { company_name: 'Thermo Fisher Scientific Inc', price: 473.95, previousClose: 482.08, volume: 1498404 },
  'TRMB': { company_name: 'Trimble Inc.', price: 55.52, previousClose: 57.74, volume: 2243440 },
  'TRV': { company_name: 'The Travelers Companies, Inc.', price: 289.95, previousClose: 291.86, volume: 1376820 },
  'TSCO': { company_name: 'Tractor Supply Company', price: 29.14, previousClose: 30.01, volume: 22311947 },
  'TSLA': { company_name: 'Tesla, Inc.', price: 423.7, previousClose: 423.74, volume: 43747438 },
  'TT': { company_name: 'Trane Technologies plc', price: 465.84, previousClose: 458.92, volume: 1127429 },
  'TTWO': { company_name: 'Take-Two Interactive Software, ', price: 215.8, previousClose: 222.38, volume: 2163947 },
  'TWLO': { company_name: 'Twilio Inc.', price: 227.26, previousClose: 229.3, volume: 3211479 },
  'TXN': { company_name: 'Texas Instruments Incorporated', price: 308.59, previousClose: 308.12, volume: 6681268 },
  'UAL': { company_name: 'United Airlines Holdings, Inc.', price: 105.14, previousClose: 108.82, volume: 3695615 },
  'UBER': { company_name: 'Uber Technologies, Inc.', price: 71.69, previousClose: 71.62, volume: 14037793 },
  'UNH': { company_name: 'UnitedHealth Group Incorporated', price: 377, previousClose: 377.92, volume: 6796062 },
  'UPS': { company_name: 'United Parcel Service, Inc.', price: 108.67, previousClose: 108.93, volume: 6001281 },
  'UPST': { company_name: 'Upstart Holdings, Inc.', price: 30.29, previousClose: 32.39, volume: 5285878 },
  'USB': { company_name: 'U.S. Bancorp', price: 53.14, previousClose: 54.6, volume: 6188498 },
  'V': { company_name: 'Visa Inc.', price: 312.4, previousClose: 317.32, volume: 8958651 },
  'VLO': { company_name: 'Valero Energy Corporation', price: 261.45, previousClose: 258.26, volume: 2240237 },
  'VMC': { company_name: 'Vulcan Materials Company (Holdi', price: 285.3, previousClose: 281.84, volume: 751364 },
  'VRTX': { company_name: 'Vertex Pharmaceuticals Incorpor', price: 428.34, previousClose: 425.09, volume: 1324326 },
  'VZ': { company_name: 'Verizon Communications Inc.', price: 46.65, previousClose: 47.87, volume: 27800521 },
  'W': { company_name: 'Wayfair Inc.', price: 69.38, previousClose: 72.32, volume: 2470602 },
  'WAB': { company_name: 'Westinghouse Air Brake Technolo', price: 262.78, previousClose: 264.51, volume: 475809 },
  'WBD': { company_name: 'Warner Bros. Discovery, Inc. - ', price: 27, previousClose: 27.18, volume: 16151436 },
  'WDAY': { company_name: 'Workday, Inc.', price: 146.9, previousClose: 148.88, volume: 4430475 },
  'WDC': { company_name: 'Western Digital Corporation', price: 594.11, previousClose: 563.1, volume: 7226527 },
  'WELL': { company_name: 'Welltower Inc.', price: 199.59, previousClose: 195.35, volume: 5466021 },
  'WFC': { company_name: 'Wells Fargo & Company', price: 78.68, previousClose: 79.44, volume: 15225688 },
  'WM': { company_name: 'Waste Management, Inc.', price: 218, previousClose: 211.93, volume: 2360125 },
  'WMB': { company_name: 'Williams Companies, Inc. (The)', price: 71.66, previousClose: 71.31, volume: 5249621 },
  'WMT': { company_name: 'Walmart Inc.', price: 116.89, previousClose: 113.06, volume: 29821282 },
  'WST': { company_name: 'West Pharmaceutical Services, I', price: 316.31, previousClose: 312.17, volume: 509778 },
  'WYNN': { company_name: 'Wynn Resorts, Limited', price: 104.95, previousClose: 104.62, volume: 1439298 },
  'XEL': { company_name: 'Xcel Energy Inc.', price: 77.39, previousClose: 77.87, volume: 7381621 },
  'XOM': { company_name: 'Exxon Mobil Corporation', price: 152.53, previousClose: 149.56, volume: 14339198 },
  'XYL': { company_name: 'Xylem Inc.', price: 109.69, previousClose: 110.29, volume: 1614297 },
  'ZBRA': { company_name: 'Zebra Technologies Corporation', price: 249.3, previousClose: 254.44, volume: 950904 },
  'ZM': { company_name: 'Zoom Communications, Inc.', price: 106.2, previousClose: 111.88, volume: 3085602 },
  'ZS': { company_name: 'Zscaler, Inc.', price: 134.37, previousClose: 144.15, volume: 7606496 },
  'ZTS': { company_name: 'Zoetis Inc.', price: 77.59, previousClose: 76.39, volume: 8103334 },
  'SPCX': { company_name: 'SpaceX Inc.', price: 85.50, previousClose: 85.00, volume: 0 },
  'NOK': { company_name: 'Nokia Corp.', price: 14.80, previousClose: 14.80, volume: 0 },
  'SMCI': { company_name: 'Super Micro Computer Inc.', price: 30.46, previousClose: 30.46, volume: 0 },
  'RKLB': { company_name: 'Rocket Lab USA Inc.', price: 102.39, previousClose: 102.39, volume: 0 },
  'RDW': { company_name: 'Redwire Corp.', price: 15.12, previousClose: 15.12, volume: 0 },
  'ASTS': { company_name: 'AST SpaceMobile Inc.', price: 82.41, previousClose: 82.41, volume: 0 },
  'SATS': { company_name: 'EchoStar Corp.', price: 114.08, previousClose: 114.08, volume: 0 },
  'IREN': { company_name: 'IREN Ltd.', price: 59.77, previousClose: 59.77, volume: 0 },
  'GRAB': { company_name: 'Grab Holdings Ltd.', price: 3.30, previousClose: 3.30, volume: 0 },
  'PATH': { company_name: 'UiPath Inc.', price: 10.55, previousClose: 10.55, volume: 0 },
  'MRVL': { company_name: 'Marvell Technology Inc.', price: 279.70, previousClose: 279.70, volume: 0 },
  'CPNG': { company_name: 'Coupang Inc.', price: 16.82, previousClose: 16.82, volume: 0 },
  'NU': { company_name: 'Nu Holdings Ltd.', price: 12.19, previousClose: 12.19, volume: 0 },
  'TTD': { company_name: 'The Trade Desk Inc.', price: 19.28, previousClose: 19.28, volume: 0 },
  'ITUB': { company_name: 'Itau Unibanco Holding SA', price: 7.99, previousClose: 7.99, volume: 0 },
  'CCL': { company_name: 'Carnival Corp.', price: 29.18, previousClose: 29.18, volume: 0 },
  'SOUN': { company_name: 'SoundHound AI Inc.', price: 6.90, previousClose: 6.90, volume: 0 },
  'HPE': { company_name: 'Hewlett Packard Enterprise', price: 48.17, previousClose: 48.17, volume: 0 },
  'VALE': { company_name: 'Vale S.A.', price: 15.71, previousClose: 15.71, volume: 0 },
  'NIO': { company_name: 'NIO Inc.', price: 5.21, previousClose: 5.21, volume: 0 },
  'ARM': { company_name: 'Arm Holdings plc', price: 380.81, previousClose: 380.81, volume: 0 },
  'MSTR': { company_name: 'Strategy Inc.', price: 123.97, previousClose: 123.97, volume: 0 },
  'ROKU': { company_name: 'Roku Inc.', price: 143.66, previousClose: 143.66, volume: 0 },
  'IONQ': { company_name: 'IonQ Inc.', price: 57.85, previousClose: 57.85, volume: 0 },
  'HIMS': { company_name: 'Hims & Hers Health Inc.', price: 26.82, previousClose: 26.82, volume: 0 },
  'STLA': { company_name: 'Stellantis N.V.', price: 6.87, previousClose: 6.87, volume: 0 },
  'CAG': { company_name: 'Conagra Brands Inc.', price: 13.74, previousClose: 13.74, volume: 0 },
  'ACHR': { company_name: 'Archer Aviation Inc.', price: 5.08, previousClose: 5.08, volume: 0 },
  'PL': { company_name: 'Planet Labs PBC', price: 31.15, previousClose: 31.15, volume: 0 },
};


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
 * Generates a synthetic quote when live providers are unavailable
 */
function getSyntheticQuote(symbol) {
  const isGlobal = !symbol.startsWith('NSE:');
  const base = BASE_QUOTES[symbol] || { 
    price: isGlobal ? 150 : 10, 
    previousClose: isGlobal ? 150 : 10, 
    volume: 100000,
    company_name: ''
  };
  
  const price = base.price;
  const previousClose = base.previousClose;
  const change = price - previousClose;

  const synthetic = {
    symbol,
    company_name: base.company_name || getCompanyName(symbol),
    currency: symbol.startsWith('NSE:') ? 'KES' : 'USD',
    price,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    changesPercentage: previousClose ? (change / previousClose) * 100 : 0,
    volume: base.volume,
    dayHigh: price,
    dayLow: price,
    previousClose,
    timestamp: Math.floor(Date.now() / 1000),
    lastUpdated: new Date().toISOString(),
    provider: 'synthetic',
    exchange: isGlobal ? 'Global' : 'NSE'
  };

  return synthetic;
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

  // 2. For NSE stocks, try AFX scraper first (free, real-time)
  // Handle both "NSE:BAT" and plain "BAT"
  if (!quote) {
    const nseSymbol = symbol.startsWith('NSE:') ? symbol : `NSE:${symbol}`;
    if (symbol.startsWith('NSE:') || BASE_QUOTES[nseSymbol]) {
      await fetchNseQuotes();
      const afxQuote = getQuoteForSymbol(symbol);
      if (afxQuote) {
        quote = { ...afxQuote, symbol: symbol.replace('NSE:', '').toUpperCase() };
      }
    }
  }

  // 4. Try preferred provider based on MARKET_DATA_PROVIDER (only if AFX didn't already find data)
  if (!quote) {
    if (false && MARKET_DATA_PROVIDER === 'polygon' && POLYGON_API_KEY) {
      const { fetchFromPolygon } = require('./polygonService');
      quote = await fetchFromPolygon(symbol);
    } else if (false && MARKET_DATA_PROVIDER === 'eodhd' && EODHD_API_KEY) {
      quote = await fetchFromEODHD(symbol);
    }
  }
  // 5. Fallback: try other providers in order (all disabled — 402/429 paid keys)
  if (!quote && false && MARKET_DATA_PROVIDER !== 'polygon' && POLYGON_API_KEY) {
    const { fetchFromPolygon } = require('./polygonService');
    quote = await fetchFromPolygon(symbol);
  }
  if (!quote && false && MARKET_DATA_PROVIDER !== 'eodhd' && EODHD_API_KEY) {
    quote = await fetchFromEODHD(symbol);
  }
  if (!quote && false && FMP_API_KEY) {
    quote = await fetchFromFMP(symbol);
  }
  // 6. Try free Yahoo Finance for NSE stocks (yahoo-finance2, no API key needed)
  if (!quote && symbol.startsWith('NSE:')) {
    const { fetchNSEQuote } = require('./rapidApiService');
    quote = await fetchNSEQuote(symbol);
  }
  // 7. Try free Yahoo Finance (yahoo-finance2) for global stocks
  if (!quote && !symbol.startsWith('NSE:')) {
    const { fetchGlobalQuote } = require('./rapidApiService');
    quote = await fetchGlobalQuote(symbol);
  }

  // 8. Update Cache and return (or return synthetic)
  if (quote) {
    console.log(`[MarketService] Caching quote for ${symbol}:`, quote);
    quoteCache.set(symbol, quote);
    return quote;
  }

  return getSyntheticQuote(symbol);
}

/**
 * EODHD Implementation
 */
async function fetchFromEODHD(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const isIndex = cleanSymbol.startsWith('NSE') || cleanSymbol.startsWith('^');
  const isKenyan = !!KENYAN_STOCKS[cleanSymbol] || isIndex;

  // EODHD requires exchange suffixes (e.g. .XNSE, .US, .INDX)
  let fetchSymbol = cleanSymbol;
  if (isKenyan && !isIndex) {
    fetchSymbol = `${cleanSymbol}.XNSE`;
  } else if (isIndex) {
    // Kenyan indices on EODHD typically use .INDX suffix
    fetchSymbol = `${cleanSymbol}.INDX`;
  } else if (!isKenyan && !isIndex && !cleanSymbol.includes('.')) {
    // Default to US exchange for global stocks like AAPL to ensure EODHD finds them
    fetchSymbol = `${cleanSymbol}.US`;
  }

  try {
    console.log(`[MarketService] Fetching EODHD data for: ${fetchSymbol}`);
    const response = await eodhd.get(`https://eodhd.com/api/real-time/${fetchSymbol}?api_token=${EODHD_API_KEY}&fmt=json`);
    const data = response.data;

    // Ensure we have a valid quote object and not an error response (EODHD errors also have a 'code' field)
    if (data && (data.code || data.symbol) && data.close !== undefined) {
      console.log(`[MarketService] EODHD Success: ${fetchSymbol} @ ${data.close}`);
      const timestamp = data.timestamp || Math.floor(Date.now() / 1000);
      return {
        symbol: isKenyan ? `NSE:${cleanSymbol}` : cleanSymbol,
        company_name: KENYAN_STOCKS[cleanSymbol] || cleanSymbol,
        price: Number(data.close || data.price) || 0,
        currency: symbol.startsWith('NSE:') ? 'KES' : 'USD',
        change: Number(data.change) || 0,
        changePercent: Number(data.change_p) || 0,
        changesPercentage: Number(data.change_p) || 0,
        volume: data.volume,
        dayHigh: data.high,
        dayLow: data.low,
        previousClose: data.previousClose || data.previous_close,
        timestamp,
        lastUpdated: new Date(timestamp * 1000).toISOString(),
        exchange: isKenyan ? 'NSE' : 'Global',
        provider: 'eodhd'
      };
    }
    console.warn(`[MarketService] EODHD returned no data for ${fetchSymbol}:`, data);
    return null;
  } catch (error) {
    console.error(`[MarketService] EODHD error for ${fetchSymbol}: ${error.message}`);
    return null;
  }
}

/**
 * FMP Implementation (Original)
 */
async function fetchFromFMP(symbol) {
  const cleanSymbol = symbol.replace('NSE:', '').toUpperCase();
  const isIndex = cleanSymbol.startsWith('NSE') || cleanSymbol.startsWith('^');
  const isKenyan = !!KENYAN_STOCKS[cleanSymbol] || isIndex;

  let fetchSymbol = cleanSymbol;
  if (isKenyan && !isIndex) {
    fetchSymbol = `${cleanSymbol}.NR`;
  }

  try {
    if (!FMP_API_KEY) throw new Error('FMP_API_KEY missing');
    const response = await fmp.get(`${FMP_BASE_URL}/quote`, {
      params: { symbol: fetchSymbol, apikey: FMP_API_KEY },
      timeout: 10000
    });
    const data = (Array.isArray(response.data) ? response.data[0] : response.data);

    if (data && data.symbol) {
      return {
        symbol: isKenyan ? `NSE:${cleanSymbol}` : cleanSymbol,
        company_name: data.name || cleanSymbol,
        price: Number(data.price) || 0,
        currency: symbol.startsWith('NSE:') ? 'KES' : (data.currency || 'USD'),
        change: Number(data.change) || 0,
        changePercent: Number(data.changePercentage ?? data.changesPercentage) || 0,
        changesPercentage: Number(data.changePercentage ?? data.changesPercentage) || 0,
        volume: data.volume,
        dayHigh: data.dayHigh,
        dayLow: data.dayLow,
        previousClose: data.previousClose,
        timestamp: data.timestamp || Math.floor(Date.now() / 1000),
        lastUpdated: new Date((data.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        exchange: data.exchange,
        provider: 'fmp'
      };
    }
    return null;
  } catch (error) {
    if (error.response?.status === 403) {
      console.warn(`[MarketService] 403 Forbidden for ${fetchSymbol}. Using fallback.`);
    } else if (error.response?.status === 401) {
      console.error(`[MarketService] 401 Unauthorized. Check if your FMP_API_KEY is correct.`);
    } else {
      console.error(`[MarketService] FMP error for ${fetchSymbol}: ${error.message}`);
    }
    return null;
  }
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
  
  // Merge and fallback to synthetic for anything still missing (but prefer stale cache over synthetic)
  symbols.forEach(s => {
    if (liveResults[s]) {
      quoteCache.set(s, liveResults[s]);
      results[s] = liveResults[s];
    } else if (!results[s]) {
      // Check for stale cache entry — prefer live provider data over synthetic
      const stale = quoteCache.get(s);
      if (stale && stale.provider !== 'synthetic') {
        results[s] = stale;
      } else {
        results[s] = getSyntheticQuote(s);
      }
    }
  });

  return results;
}

async function fetchLiveBatch(symbols) {
  let results = {};

  // 0. For NSE stocks, try AFX scraper first (free, real-time)
  // Symbols may come as plain tickers ("BAT") or NSE-prefixed ("NSE:BAT")
  const afxQuotes = await fetchNseQuotes();
  if (afxQuotes) {
    for (const sym of symbols) {
      if (results[sym]) continue;
      const cleanSym = sym.replace('NSE:', '').toUpperCase();
      if (afxQuotes[cleanSym]) {
        results[sym] = { ...afxQuotes[cleanSym], symbol: cleanSym };
      }
    }
  }

  // 1. Try RapidAPI next for NSE stocks (complementary)
  if (RAPIDAPI_KEY) {
    const { fetchBatchNSEQuotes } = require('./rapidApiService');
    const rapidResults = await fetchBatchNSEQuotes(symbols);
    results = { ...results, ...rapidResults };
  }

  // 1. Try primary provider (all disabled — 402/429 paid keys)
  const missing0 = symbols.filter(s => !results[s]);
  if (false && MARKET_DATA_PROVIDER === 'polygon' && POLYGON_API_KEY) {
    const { fetchBatchFromPolygon } = require('./polygonService');
    results = { ...results, ...(await fetchBatchFromPolygon(missing0)) };
  } else if (false && MARKET_DATA_PROVIDER === 'eodhd' && EODHD_API_KEY) {
    results = { ...results, ...(await fetchBatchFromEODHD(missing0)) };
  }

  // 2. Fallback: try other providers for missing symbols
  const missing1 = symbols.filter(s => !results[s]);
  if (missing1.length > 0 && false && MARKET_DATA_PROVIDER !== 'polygon' && POLYGON_API_KEY) {
    const { fetchBatchFromPolygon } = require('./polygonService');
    const polyResults = await fetchBatchFromPolygon(missing1);
    results = { ...results, ...polyResults };
  }
  const missing2 = symbols.filter(s => !results[s]);
  if (missing2.length > 0 && false && MARKET_DATA_PROVIDER !== 'eodhd' && EODHD_API_KEY) {
    const eodhdResults = await fetchBatchFromEODHD(missing2);
    results = { ...results, ...eodhdResults };
  }
  const missing3 = symbols.filter(s => !results[s]);
  if (missing3.length > 0 && false && FMP_API_KEY) {
    const fmpResults = await fetchBatchFromFMP(missing3);
    results = { ...results, ...fmpResults };
  }
  // 3. Try free Yahoo Finance for remaining global stocks
  const missingGlobal = symbols.filter(s => !results[s] && !s.startsWith('NSE:'));
  if (missingGlobal.length > 0) {
    const { fetchBatchGlobalQuotes } = require('./rapidApiService');
    const yahooResults = await fetchBatchGlobalQuotes(missingGlobal);
    results = { ...results, ...yahooResults };
  }
  return results;
}

/**
 * Internal EODHD Batch Fetcher
 */
async function fetchBatchFromEODHD(symbols) {
  const results = {};
  const mappedSymbols = symbols.map(s => {
    const clean = s.replace('NSE:', '').toUpperCase();
    const isIndex = clean.startsWith('NSE') || clean.startsWith('^') || clean.includes('INDEX');
    const isKenyan = !!KENYAN_STOCKS[clean] || isIndex;
    
    let fetchSymbol = clean;
    if (isKenyan && !isIndex) {
      fetchSymbol = `${clean}.XNSE`;
    } else if (isIndex) {
      fetchSymbol = `${clean}.INDX`;
    } else if (!isKenyan && !isIndex && !clean.includes('.')) {
      fetchSymbol = `${clean}.US`;
    }
    return { original: s, fetch: fetchSymbol };
  });

  try {
    // Correct Bulk Pattern: Anchor with first ticker, rest in 's' param
    const anchor = mappedSymbols[0].fetch;
    const others = mappedSymbols.slice(1).map(m => m.fetch).join(',');
    
    console.log(`[MarketService] EODHD Batch Fetch: ${anchor} + [${others}]`);
    const response = await eodhd.get(`https://eodhd.com/api/real-time/${anchor}`, {
      params: { api_token: EODHD_API_KEY, fmt: 'json', s: others || undefined }
    });

    const data = response.data;
    const dataArray = Array.isArray(data) ? data : [data];

    dataArray.forEach(q => {
      if (!q || (!q.code && !q.symbol)) return;
      const receivedCode = (q.code || q.symbol).toUpperCase();
      const mapping = mappedSymbols.find(m => 
        m.fetch.toUpperCase() === receivedCode || 
        m.fetch.split('.')[0].toUpperCase() === receivedCode
      );
      
      const originalSymbol = mapping ? mapping.original : (q.code || q.symbol);
      const isKenyan = originalSymbol?.startsWith('NSE:');

      results[originalSymbol] = {
        symbol: originalSymbol,
        company_name: isKenyan ? (KENYAN_STOCKS[originalSymbol.replace('NSE:', '')] || receivedCode) : receivedCode,
        price: Number(q.close || q.price) || 0,
        currency: originalSymbol.startsWith('NSE:') ? 'KES' : 'USD',
        change: Number(q.change) || 0,
        changePercent: Number(q.change_p) || 0,
        changesPercentage: Number(q.change_p) || 0,
        volume: q.volume,
        dayHigh: q.high,
        dayLow: q.low,
        previousClose: q.previousClose || q.previous_close,
        timestamp: q.timestamp || Math.floor(Date.now() / 1000),
        lastUpdated: new Date((q.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        exchange: isKenyan ? 'NSE' : 'Global',
        provider: 'eodhd'
      };
    });
  } catch (error) {
    console.error('[MarketService] EODHD Batch Error:', error.message);
  }
  return results;
}

/**
 * Internal FMP Batch Fetcher
 */
async function fetchBatchFromFMP(symbols) {
  const results = {};
  const fmpSymbols = symbols.map(s => {
    const clean = s.replace('NSE:', '').toUpperCase();
    const isIndex = clean.startsWith('NSE') || clean.startsWith('^');
    return (isIndex || !KENYAN_STOCKS[clean]) ? clean : `${clean}.NR`;
  });

  try {
    const response = await fmp.get(`${FMP_BASE_URL}/quote`, {
      params: { symbol: fmpSymbols.join(','), apikey: FMP_API_KEY },
      timeout: 10000
    });
    // Stable API returns an array for comma-separated symbols
    const data = Array.isArray(response.data) ? response.data : [response.data].filter(Boolean);
    data.forEach(q => {
      if (!q || !q.symbol) return;
      const originalSymbol = symbols.find(s => s.includes(q.symbol.replace('.NR', '')));
      if (originalSymbol) {
        results[originalSymbol] = {
          symbol: q.symbol,
          company_name: q.name || q.symbol,
          price: Number(q.price) || 0,
          currency: originalSymbol.startsWith('NSE:') ? 'KES' : (q.currency || 'USD'),
          change: Number(q.change) || 0,
          changePercent: Number(q.changePercentage ?? q.changesPercentage) || 0,
          changesPercentage: Number(q.changePercentage ?? q.changesPercentage) || 0,
          volume: q.volume,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          previousClose: q.previousClose,
          timestamp: q.timestamp || Math.floor(Date.now() / 1000),
          lastUpdated: new Date((q.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          exchange: q.exchange,
          provider: 'fmp'
        };
      }
    });
  } catch (error) {
    console.error('[MarketService] FMP Batch Error:', error.message);
  }
  return results;
}

module.exports = { getStockQuote, getQuotesBatch, getCompanyName, getSyntheticQuote };