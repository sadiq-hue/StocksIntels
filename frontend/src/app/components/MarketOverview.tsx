import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface MarketStatus {
  open: boolean;
  label: string;
  openTime: string;
  closeTime: string;
}

export function MarketOverview() {
  const [marketStatus, setMarketStatus] = useState<{ nse: MarketStatus; global: MarketStatus } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/market/status`)
      .then((r) => r.json())
      .then(setMarketStatus)
      .catch(() => {});
    const interval = setInterval(() => {
      fetch(`${API_URL}/market/status`)
        .then((r) => r.json())
        .then(setMarketStatus)
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const indices = [
    { name: "NSE All Share Index", value: "145.23", change: "+1.24%", isPositive: true },
    { name: "NSE 20 Share Index", value: "1,847.56", change: "+0.87%", isPositive: true },
    { name: "NSE 25 Share Index", value: "3,254.12", change: "-0.34%", isPositive: false },
  ];

  return (
    <Card className="bg-white border-gray-200 p-6">
      <h3 className="text-gray-900 mb-4">NSE Market Overview</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {indices.map((index) => (
          <div key={index.name} className="bg-gray-50 p-4 rounded-lg border border-gray-100">
            <div className="text-gray-600 text-sm mb-1">{index.name}</div>
            <div className="flex items-center justify-between">
              <div className="text-gray-900 text-2xl">{index.value}</div>
              <div className={`flex items-center gap-1 ${index.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {index.isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                <span>{index.change}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {marketStatus && (
        <div className="mt-4 flex gap-4">
          <div className={`flex-1 p-3 rounded-lg ${marketStatus.nse.open ? "bg-[#0D7490]" : "bg-gray-500"}`}>
            <div className="text-sm text-white/80">NSE</div>
            <div className="text-sm text-white font-semibold">
              {marketStatus.nse.open ? "Open" : "Closed"}
              {" · Closes "}{marketStatus.nse.closeTime}
            </div>
          </div>
          <div className={`flex-1 p-3 rounded-lg ${marketStatus.global.open ? "bg-[#0D7490]" : "bg-gray-500"}`}>
            <div className="text-sm text-white/80">Global</div>
            <div className="text-sm text-white font-semibold">
              {marketStatus.global.open ? "Open" : "Closed"}
              {" · Closes "}{marketStatus.global.closeTime}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}