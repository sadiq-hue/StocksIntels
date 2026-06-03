"use client";

import { useState, useMemo } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Search, Globe, Landmark, TrendingUp, TrendingDown,
  ExternalLink, Clock, BarChart3, Database, ArrowUpDown,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useStockData } from "../../contexts/StockDataContext";

function formatCompactCurrency(value: number, currency = "KES") {
  if (!Number.isFinite(value) || value === 0) return `${currency} 0`;
  return new Intl.NumberFormat("en-KE", {
    style: "currency", currency, notation: "compact", maximumFractionDigits: 2,
  }).format(value);
}

const exchanges = [
  {
    id: "nse",
    name: "Nairobi Securities Exchange",
    shortName: "NSE",
    country: "Kenya",
    currency: "KES",
    region: "Africa",
    status: "Open",
    timezone: "EAT (UTC+3)",
    tradingHours: "Mon-Fri 9:30 AM - 3:00 PM",
    listedCompanies: 65,
    marketCap: "1.8T",
    description: "The principal stock exchange of Kenya. It is the third largest stock exchange in Africa by market capitalization.",
  },
  {
    id: "nyse",
    name: "New York Stock Exchange",
    shortName: "NYSE",
    country: "United States",
    currency: "USD",
    region: "North America",
    status: "Open",
    timezone: "ET (UTC-5)",
    tradingHours: "Mon-Fri 9:30 AM - 4:00 PM",
    listedCompanies: 2400,
    marketCap: "28.5T",
    description: "The world's largest stock exchange by market capitalization. Located on Wall Street in New York City.",
  },
  {
    id: "nasdaq",
    name: "NASDAQ",
    shortName: "NASDAQ",
    country: "United States",
    currency: "USD",
    region: "North America",
    status: "Open",
    timezone: "ET (UTC-5)",
    tradingHours: "Mon-Fri 9:30 AM - 4:00 PM",
    listedCompanies: 3300,
    marketCap: "19.6T",
    description: "The second-largest stock exchange in the world. Known for its high concentration of technology companies.",
  },
  {
    id: "lse",
    name: "London Stock Exchange",
    shortName: "LSE",
    country: "United Kingdom",
    currency: "GBP",
    region: "Europe",
    status: "Open",
    timezone: "GMT (UTC+0)",
    tradingHours: "Mon-Fri 8:00 AM - 4:30 PM",
    listedCompanies: 1800,
    marketCap: "3.6T",
    description: "One of the world's oldest stock exchanges and the largest in Europe.",
  },
  {
    id: "tse",
    name: "Tokyo Stock Exchange",
    shortName: "TSE",
    country: "Japan",
    currency: "JPY",
    region: "Asia",
    status: "Closed",
    timezone: "JST (UTC+9)",
    tradingHours: "Mon-Fri 9:00 AM - 3:00 PM",
    listedCompanies: 3700,
    marketCap: "6.2T",
    description: "The third-largest stock exchange in the world by market capitalization. Home to many of Japan's largest companies.",
  },
  {
    id: "hke",
    name: "Hong Kong Stock Exchange",
    shortName: "HKEX",
    country: "Hong Kong",
    currency: "HKD",
    region: "Asia",
    status: "Closed",
    timezone: "HKT (UTC+8)",
    tradingHours: "Mon-Fri 9:30 AM - 4:00 PM",
    listedCompanies: 2500,
    marketCap: "4.5T",
    description: "Asia's third-largest stock exchange and a major global financial hub.",
  },
  {
    id: "euronext",
    name: "Euronext",
    shortName: "EURONEXT",
    country: "Netherlands",
    currency: "EUR",
    region: "Europe",
    status: "Open",
    timezone: "CET (UTC+1)",
    tradingHours: "Mon-Fri 9:00 AM - 5:30 PM",
    listedCompanies: 1900,
    marketCap: "6.6T",
    description: "The largest stock exchange in continental Europe, operating markets in Amsterdam, Brussels, Paris, Lisbon, and Dublin.",
  },
  {
    id: "shenzhen",
    name: "Shenzhen Stock Exchange",
    shortName: "SZSE",
    country: "China",
    currency: "CNY",
    region: "Asia",
    status: "Closed",
    timezone: "CST (UTC+8)",
    tradingHours: "Mon-Fri 9:30 AM - 3:00 PM",
    listedCompanies: 2500,
    marketCap: "4.8T",
    description: "One of China's two main stock exchanges, known for its high-growth technology companies.",
  },
];

export function StockExchanges() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "marketCap" | "companies">("marketCap");
  const [regionFilter, setRegionFilter] = useState("All");
  const navigate = useNavigate();
  const { nseStocks } = useStockData();

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

  const nseListings = useMemo(() =>
    nseStocks.slice(0, 8).map(s => ({
      ticker: s.symbol.replace("NSE:", ""),
      name: s.company_name,
      price: s.price,
      change: s.changePercent,
    })),
  [nseStocks]);

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
              className="w-56 pl-9 pr-3 py-2 bg-background border rounded-lg focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490] transition-all text-sm outline-none"
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(exchange => (
          <Card key={exchange.id} className="p-5 hover:shadow-md transition-all border-l-4" style={{ borderLeftColor: exchange.status === "Open" ? "#10B981" : "#6B7280" }}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: exchange.region === "Africa" ? "#0D749015" : "#6366f115" }}>
                  {exchange.region === "Africa" ? <Landmark className="size-5 text-[#0D7490]" /> : <Globe className="size-5 text-indigo-500" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-foreground">{exchange.name}</h3>
                    <Badge variant="outline" className="text-[10px] font-mono">{exchange.shortName}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{exchange.country} &middot; {exchange.region}</p>
                </div>
              </div>
              <Badge className={`text-[10px] ${exchange.status === "Open" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                <span className={`size-1.5 rounded-full mr-1.5 inline-block ${exchange.status === "Open" ? "bg-emerald-500" : "bg-gray-400"}`} />
                {exchange.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{exchange.description}</p>
            <div className="grid grid-cols-3 gap-4 mb-4">
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
              <span>{exchange.tradingHours}</span>
            </div>
          </Card>
        ))}
      </div>

      {exchanges.find(e => e.id === "nse") && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Database className="size-4 text-[#0D7490]" />
              NSE Listed Stocks Preview
            </h3>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/app/stocks")}>
              View All <ExternalLink className="size-3 ml-1" />
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {nseListings.map(stock => (
              <div key={stock.ticker} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => navigate(`/app/stock/${stock.ticker}?market=nse`)}>
                <div>
                  <p className="text-sm font-bold text-foreground">{stock.ticker}</p>
                  <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">{stock.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono font-bold">{stock.price.toFixed(2)}</p>
                  <p className={`text-[10px] font-semibold flex items-center gap-0.5 ${stock.change >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {stock.change >= 0 ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                    {stock.change >= 0 ? "+" : ""}{stock.change.toFixed(2)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
