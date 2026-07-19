import { Card } from "./ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

export function TopMovers() {
  const gainers = [
    { ticker: "SCOM", name: "Safaricom PLC", change: "+5.2%" },
    { ticker: "EQTY", name: "Equity Group", change: "+3.8%" },
    { ticker: "KCB", name: "KCB Group", change: "+2.1%" },
  ];

  const losers = [
    { ticker: "BAMB", name: "Bamburi Cement", change: "-2.4%" },
    { ticker: "TOTL", name: "TotalEnergies", change: "-1.9%" },
    { ticker: "ARMS", name: "ARM Cement", change: "-1.5%" },
  ];

  return (
    <Card className="bg-card border-border p-6">
      <h3 className="text-foreground mb-4">Top Movers</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center gap-2 text-green-600 mb-3">
            <TrendingUp className="w-5 h-5" />
            <span className="font-semibold">Gainers</span>
          </div>
          <div className="space-y-2">
            {gainers.map((stock) => (
              <div key={stock.ticker} className="bg-muted p-3 rounded border border-border flex justify-between items-center">
                <div>
                  <div className="text-foreground font-semibold">{stock.ticker}</div>
                  <div className="text-muted-foreground text-xs">{stock.name}</div>
                </div>
                <div className="text-green-600 font-semibold">{stock.change}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 text-red-600 mb-3">
            <TrendingDown className="w-5 h-5" />
            <span className="font-semibold">Losers</span>
          </div>
          <div className="space-y-2">
            {losers.map((stock) => (
              <div key={stock.ticker} className="bg-muted p-3 rounded border border-border flex justify-between items-center">
                <div>
                  <div className="text-foreground font-semibold">{stock.ticker}</div>
                  <div className="text-muted-foreground text-xs">{stock.name}</div>
                </div>
                <div className="text-red-600 font-semibold">{stock.change}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
