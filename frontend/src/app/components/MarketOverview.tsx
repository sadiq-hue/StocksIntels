import { Card } from "./ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export function MarketOverview() {
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
      <div className="mt-4 p-3 bg-[#0D7490] rounded-lg">
        <div className="text-sm text-white">Market Sentiment: <span className="font-semibold">Bullish</span></div>
      </div>
    </Card>
  );
}
