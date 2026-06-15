import { useState, useMemo, useEffect } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Search, TrendingUp, TrendingDown,
  ExternalLink, Clock, Database,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useRealtimeQuotes } from "../../contexts/RealtimeQuotesContext";
import { kenyanStocks } from "../../data/stockUniverses";

interface DisplayStock {
  ticker: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  volume: number;
}

type ExchangeStatus = "Open" | "Closed" | "Pre-Market" | "After-Hours";

interface Exchange {
  id: string;
  name: string;
  shortName: string;
  country: string;
  currency: string;
  region: string;
  timezone: string;
  timezoneOffset: number;
  openHour: number;
  closeHour: number;
  listedCompanies: number;
  marketCap: string;
  description: string;
  flag: string;
}

const exchanges: Exchange[] = [
  { id: "nse", name: "Nairobi Securities Exchange", shortName: "NSE", country: "Kenya", currency: "KES", region: "Africa", timezone: "Africa/Nairobi", timezoneOffset: 3, openHour: 9, closeHour: 15, listedCompanies: 68, marketCap: "1.8T", description: "The principal stock exchange of Kenya. Third largest stock exchange in Africa by market capitalization.", flag: "🇰🇪" },
  { id: "jse", name: "Johannesburg Stock Exchange", shortName: "JSE", country: "South Africa", currency: "ZAR", region: "Africa", timezone: "Africa/Johannesburg", timezoneOffset: 2, openHour: 9, closeHour: 17, listedCompanies: 320, marketCap: "1.2T", description: "The largest stock exchange in Africa. Home to many of Africa's largest companies.", flag: "🇿🇦" },
  { id: "dse", name: "Dar es Salaam Stock Exchange", shortName: "DSE", country: "Tanzania", currency: "TZS", region: "Africa", timezone: "Africa/Nairobi", timezoneOffset: 3, openHour: 9, closeHour: 15, listedCompanies: 28, marketCap: "0.5T", description: "The stock exchange of Tanzania, located in Dar es Salaam.", flag: "🇹🇿" },
  { id: "use", name: "Uganda Securities Exchange", shortName: "USE", country: "Uganda", currency: "UGX", region: "Africa", timezone: "Africa/Nairobi", timezoneOffset: 3, openHour: 9, closeHour: 15, listedCompanies: 17, marketCap: "0.3T", description: "The stock exchange of Uganda, based in Kampala.", flag: "🇺🇬" },
  { id: "rse", name: "Rwanda Stock Exchange", shortName: "RSE", country: "Rwanda", currency: "RWF", region: "Africa", timezone: "Africa/Maputo", timezoneOffset: 2, openHour: 9, closeHour: 15, listedCompanies: 11, marketCap: "0.2T", description: "The stock exchange of Rwanda, based in Kigali.", flag: "🇷🇼" },
  { id: "nyse", name: "New York Stock Exchange", shortName: "NYSE", country: "United States", currency: "USD", region: "North America", timezone: "America/New_York", timezoneOffset: -5, openHour: 9.5, closeHour: 16, listedCompanies: 2400, marketCap: "28.5T", description: "The world's largest stock exchange by market capitalization. Located on Wall Street in New York City.", flag: "🇺🇸" },
  { id: "nasdaq", name: "NASDAQ", shortName: "NASDAQ", country: "United States", currency: "USD", region: "North America", timezone: "America/New_York", timezoneOffset: -5, openHour: 9.5, closeHour: 16, listedCompanies: 3300, marketCap: "19.6T", description: "The second-largest stock exchange. Known for high concentration of technology companies.", flag: "🇺🇸" },
  { id: "tsx", name: "Toronto Stock Exchange", shortName: "TSX", country: "Canada", currency: "CAD", region: "North America", timezone: "America/Toronto", timezoneOffset: -5, openHour: 9.5, closeHour: 16, listedCompanies: 1500, marketCap: "2.3T", description: "Canada's primary stock exchange. Home to major financial and resource companies.", flag: "🇨🇦" },
  { id: "lse", name: "London Stock Exchange", shortName: "LSE", country: "United Kingdom", currency: "GBP", region: "Europe", timezone: "Europe/London", timezoneOffset: 0, openHour: 8, closeHour: 16.5, listedCompanies: 1800, marketCap: "3.6T", description: "One of the world's oldest stock exchanges and the largest in Europe.", flag: "🇬🇧" },
  { id: "euronext", name: "Euronext", shortName: "EURONEXT", country: "Netherlands", currency: "EUR", region: "Europe", timezone: "Europe/Paris", timezoneOffset: 1, openHour: 9, closeHour: 17.5, listedCompanies: 1900, marketCap: "6.6T", description: "Largest stock exchange in continental Europe, operating in Amsterdam, Brussels, Paris, Lisbon, Dublin.", flag: "🇪🇺" },
  { id: "xetra", name: "Deutsche Börse Xetra", shortName: "XETRA", country: "Germany", currency: "EUR", region: "Europe", timezone: "Europe/Berlin", timezoneOffset: 1, openHour: 9, closeHour: 17.5, listedCompanies: 1300, marketCap: "2.1T", description: "Germany's primary electronic trading platform. Europe's largest by trading volume.", flag: "🇩🇪" },
  { id: "tse", name: "Tokyo Stock Exchange", shortName: "TSE", country: "Japan", currency: "JPY", region: "Asia", timezone: "Asia/Tokyo", timezoneOffset: 9, openHour: 9, closeHour: 15, listedCompanies: 3700, marketCap: "6.2T", description: "The third-largest stock exchange in the world by market capitalization.", flag: "🇯🇵" },
  { id: "hke", name: "Hong Kong Stock Exchange", shortName: "HKEX", country: "Hong Kong", currency: "HKD", region: "Asia", timezone: "Asia/Hong_Kong", timezoneOffset: 8, openHour: 9.5, closeHour: 16, listedCompanies: 2500, marketCap: "4.5T", description: "Asia's third-largest stock exchange and a major global financial hub.", flag: "🇭🇰" },
  { id: "sse", name: "Shanghai Stock Exchange", shortName: "SSE", country: "China", currency: "CNY", region: "Asia", timezone: "Asia/Shanghai", timezoneOffset: 8, openHour: 9.5, closeHour: 15, listedCompanies: 2200, marketCap: "7.3T", description: "China's main stock exchange. One of the largest exchanges in the world.", flag: "🇨🇳" },
  { id: "shenzhen", name: "Shenzhen Stock Exchange", shortName: "SZSE", country: "China", currency: "CNY", region: "Asia", timezone: "Asia/Shanghai", timezoneOffset: 8, openHour: 9.5, closeHour: 15, listedCompanies: 2500, marketCap: "4.8T", description: "China's second main exchange, known for high-growth technology companies.", flag: "🇨🇳" },
  { id: "asx", name: "Australian Securities Exchange", shortName: "ASX", country: "Australia", currency: "AUD", region: "Oceania", timezone: "Australia/Sydney", timezoneOffset: 10, openHour: 10, closeHour: 16, listedCompanies: 2200, marketCap: "1.8T", description: "Australia's primary securities exchange. Major hub for mining and financial stocks.", flag: "🇦🇺" },
  { id: "bse", name: "BSE Sensex", shortName: "BSE", country: "India", currency: "INR", region: "Asia", timezone: "Asia/Kolkata", timezoneOffset: 5.5, openHour: 9.25, closeHour: 15.5, listedCompanies: 5000, marketCap: "4.0T", description: "Asia's oldest stock exchange. One of the largest exchanges by number of listed companies.", flag: "🇮🇳" },
  { id: "sgx", name: "Singapore Exchange", shortName: "SGX", country: "Singapore", currency: "SGD", region: "Asia", timezone: "Asia/Singapore", timezoneOffset: 8, openHour: 9, closeHour: 17, listedCompanies: 750, marketCap: "0.6T", description: "Singapore's primary exchange. Major hub for Asian equities and derivatives.", flag: "🇸🇬" },
  { id: "kospi", name: "Korea Exchange", shortName: "KRX", country: "South Korea", currency: "KRW", region: "Asia", timezone: "Asia/Seoul", timezoneOffset: 9, openHour: 9, closeHour: 15.5, listedCompanies: 2300, marketCap: "1.8T", description: "South Korea's sole securities exchange. Home to global tech giants.", flag: "🇰🇷" },
];

function getExchangeStatus(ex: Exchange): { status: ExchangeStatus; label: string } {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const local = new Date(utc + ex.timezoneOffset * 3600000);
  const day = local.getDay();
  const hour = local.getHours() + local.getMinutes() / 60;
  if (day === 0 || day === 6) return { status: "Closed", label: "Weekend" };
  if (hour < ex.openHour - 0.5) return { status: "Closed", label: `Opens ${formatTime(ex.openHour)}` };
  if (hour < ex.openHour) return { status: "Pre-Market", label: "Pre-market" };
  if (hour < ex.closeHour) return { status: "Open", label: `Closes ${formatTime(ex.closeHour)}` };
  if (hour < ex.closeHour + 1) return { status: "After-Hours", label: "After-hours" };
  return { status: "Closed", label: `Closed at ${formatTime(ex.closeHour)}` };
}

function formatTime(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function parseVolume(vol: string): number {
  const num = parseFloat(vol.replace("M", "").replace("K", "").replace("B", ""));
  if (vol.includes("B")) return num * 1000000000;
  if (vol.includes("M")) return num * 1000000;
  if (vol.includes("K")) return num * 1000;
  return num;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function toApiFormat(stocks: typeof kenyanStocks, prefixNse = false) {
  return stocks.map(s => ({
    symbol: prefixNse ? `NSE:${s.ticker}` : s.ticker,
    ticker: s.ticker,
    name: s.name,
    price: s.price,
    changePercent: 0,
    volume: parseVolume(s.volume),
    currency: s.currency || "KES",
    market_cap: s.marketCap,
    sector: s.sector,
  }));
}

export function StockExchanges() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "marketCap" | "companies">("marketCap");
  const [regionFilter, setRegionFilter] = useState("All");
  const navigate = useNavigate();
  const { getQuote } = useRealtimeQuotes();

  const regions = useMemo(() =>
    ["All", ...Array.from(new Set(exchanges.map(e => e.region)))],
  []);

  const filtered = useMemo(() => {
    let list = exchanges.filter(e =>
      (regionFilter === "All" || e.region === regionFilter) &&
      (e.name.toLowerCase().includes(search.toLowerCase()) ||
       e.shortName.toLowerCase().includes(search.toLowerCase()) ||
       e.country.toLowerCase().includes(search.toLowerCase()))
    );
    if (sortBy === "marketCap") {
      list.sort((a, b) => {
        const aVal = parseFloat(a.marketCap.replace("T", "")) * (a.marketCap.includes("T") ? 1e12 : 1e9);
        const bVal = parseFloat(b.marketCap.replace("T", "")) * (b.marketCap.includes("T") ? 1e12 : 1e9);
        return bVal - aVal;
      });
    } else if (sortBy === "companies") {
      list.sort((a, b) => b.listedCompanies - a.listedCompanies);
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [search, sortBy, regionFilter]);

  // Build display stocks the exact same way as MarketPage's nseStocksDisplay:
  // start from hardcoded kenyanStocks, overlay live quotes from RealtimeQuotesContext
  const localNseStocks = useMemo(() => toApiFormat(kenyanStocks, true), []);
  const nseLiveStocks = useMemo<DisplayStock[]>(() => {
    return localNseStocks.map(local => {
      const live = getQuote(local.symbol);
      if (live && live.provider !== 'synthetic') {
        return {
          ticker: local.ticker,
          name: local.name,
          price: live.price ?? local.price,
          changePercent: live.changePercent ?? 0,
          volume: live.volume ?? local.volume,
        };
      }
      return { ticker: local.ticker, name: local.name, price: null, changePercent: null, volume: 0 };
    });
  }, [localNseStocks, getQuote]);

  const nseUpCount = useMemo(() => nseLiveStocks.filter(s => s.changePercent !== null && s.changePercent > 0).length, [nseLiveStocks]);
  const nseDownCount = useMemo(() => nseLiveStocks.filter(s => s.changePercent !== null && s.changePercent < 0).length, [nseLiveStocks]);
  const nseFlatCount = useMemo(() => nseLiveStocks.filter(s => s.changePercent !== null && s.changePercent === 0).length, [nseLiveStocks]);

  const nseTopGainers = useMemo(() =>
    [...nseLiveStocks].filter(s => s.changePercent !== null).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 5),
  [nseLiveStocks]);

  const nseTopLosers = useMemo(() =>
    [...nseLiveStocks].filter(s => s.changePercent !== null).sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 5),
  [nseLiveStocks]);

  const renderMoverRow = (s: DisplayStock) => {
    const isPositive = (s.changePercent ?? 0) >= 0;
    return (
      <div key={s.ticker} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => navigate(`/app/stock/${s.ticker}?market=nse`)}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground w-14">{s.ticker}</span>
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{s.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold text-foreground">{s.price?.toFixed(2) ?? "--"}</span>
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${isPositive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {isPositive ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
            {isPositive ? "+" : ""}{s.changePercent?.toFixed(2) ?? "0.00"}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Stock Exchanges</h2>
          <p className="text-sm text-muted-foreground">Major stock exchanges around the world</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search exchanges..."
              className="w-56 pl-9 pr-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
          >
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            className="px-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#0D7490]/20"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
          >
            <option value="marketCap">Market Cap</option>
            <option value="name">Name</option>
            <option value="companies">Listings</option>
          </select>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 bg-gradient-to-br from-[#0D7490]/10 to-transparent border-[#0D7490]/20">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Open Now</p>
          <p className="text-lg font-bold text-foreground">{filtered.filter(e => getExchangeStatus(e).status === "Open").length}</p>
          <p className="text-[10px] text-muted-foreground">of {filtered.length} exchanges</p>
        </Card>
        <Card className="p-3 bg-emerald-50/50 border-emerald-200/50">
          <p className="text-[10px] uppercase font-semibold text-emerald-700 tracking-wider">NSE Stocks Up</p>
          <p className="text-lg font-bold text-emerald-700">{nseUpCount}</p>
          <p className="text-[10px] text-emerald-600">{nseUpCount > 0 ? `Gainers leading` : "No gainers"}</p>
        </Card>
        <Card className="p-3 bg-red-50/50 border-red-200/50">
          <p className="text-[10px] uppercase font-semibold text-red-700 tracking-wider">NSE Stocks Down</p>
          <p className="text-lg font-bold text-red-700">{nseDownCount}</p>
          <p className="text-[10px] text-red-600">{nseDownCount > 0 ? `Losers dragging` : "No losers"}</p>
        </Card>
        <Card className="p-3 bg-gray-50/50 border-gray-200/50">
          <p className="text-[10px] uppercase font-semibold text-gray-600 tracking-wider">NSE Unchanged</p>
          <p className="text-lg font-bold text-gray-600">{nseFlatCount}</p>
          <p className="text-[10px] text-gray-500">Flat on the day</p>
        </Card>
      </div>

      {/* Exchange Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(exchange => {
          const exStatus = getExchangeStatus(exchange);
          const isOpen = exStatus.status === "Open";
          const isPre = exStatus.status === "Pre-Market";
          const isAfter = exStatus.status === "After-Hours";
          return (
            <Card key={exchange.id} className="p-5 hover:shadow-md transition-all border-l-4" style={{
              borderLeftColor: isOpen ? "#10B981" : isPre ? "#F59E0B" : isAfter ? "#6366F1" : "#6B7280"
            }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-lg flex items-center justify-center text-lg" style={{ backgroundColor: exchange.region === "Africa" ? "#0D749015" : "#6366f115" }}>
                    {exchange.flag}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground">{exchange.name}</h3>
                      <Badge variant="outline" className="text-[10px] font-mono">{exchange.shortName}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{exchange.country} · {exchange.region}</p>
                  </div>
                </div>
                <div className="text-right">
                  <Badge className={`text-[10px] ${isOpen ? "bg-emerald-50 text-emerald-700" : isPre ? "bg-amber-50 text-amber-700" : isAfter ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-600"}`}>
                    <span className={`size-1.5 rounded-full mr-1.5 inline-block ${isOpen ? "bg-emerald-500" : isPre ? "bg-amber-500" : isAfter ? "bg-indigo-500" : "bg-gray-400"}`} />
                    {exStatus.label}
                  </Badge>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{exchange.description}</p>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Market Cap</p>
                  <p className="text-sm font-bold text-foreground">{exchange.marketCap}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Listed</p>
                  <p className="text-sm font-bold text-foreground">{exchange.listedCompanies.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Currency</p>
                  <p className="text-sm font-bold text-foreground">{exchange.currency}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3" />
                <span>{formatTime(exchange.openHour)} – {formatTime(exchange.closeHour)} {exchange.timezone}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* NSE Real-Time Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 border-emerald-200/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-600" />
              NSE Top Gainers
            </h3>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/app/stocks")}>
              View All <ExternalLink className="size-3 ml-1" />
            </Button>
          </div>
          <div className="space-y-1">
            {nseTopGainers.map(renderMoverRow)}
          </div>
        </Card>
        <Card className="p-5 border-red-200/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <TrendingDown className="size-4 text-red-600" />
              NSE Top Losers
            </h3>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/app/stocks")}>
              View All <ExternalLink className="size-3 ml-1" />
            </Button>
          </div>
          <div className="space-y-1">
            {nseTopLosers.map(renderMoverRow)}
          </div>
        </Card>
      </div>

      {/* NSE All Stocks */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Database className="size-4 text-[#0D7490]" />
            NSE Listed Stocks · <span className="text-xs text-muted-foreground font-normal">{nseLiveStocks.length} companies</span>
          </h3>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/app/stocks")}>
            Full Screener <ExternalLink className="size-3 ml-1" />
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {nseLiveStocks.map(s => {
            const isPositive = (s.changePercent ?? 0) >= 0;
            return (
              <div key={s.ticker} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => navigate(`/app/stock/${s.ticker}?market=nse`)}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{s.ticker}</p>
                  <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">{s.name}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono font-bold text-foreground">{s.price?.toFixed(2) ?? "--"}</p>
                  <p className={`text-[10px] font-semibold flex items-center gap-0.5 justify-end ${isPositive ? "text-emerald-600" : "text-red-600"}`}>
                    {isPositive ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                    {isPositive ? "+" : ""}{s.changePercent?.toFixed(2) ?? "0.00"}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
