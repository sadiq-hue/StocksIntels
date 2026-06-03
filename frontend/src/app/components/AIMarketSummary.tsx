import { Card } from "./ui/card";
import { Sparkles } from "lucide-react";

export function AIMarketSummary() {
  return (
    <Card className="bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] border-[#0D7490] p-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-white" />
        <h3 className="text-white">AI Market Summary</h3>
      </div>
      <p className="text-white/95 leading-relaxed">
        The NSE is showing strong bullish momentum with telecommunications and banking sectors leading gains.
        Safaricom continues its upward trend following positive earnings guidance. Key support levels remain
        intact across major indices. Watch for potential profit-taking in overextended positions. Foreign
        investor sentiment remains positive with increased activity in blue-chip stocks.
      </p>
      <div className="mt-4 flex items-center gap-4 text-sm">
        <div className="text-white/80">Confidence: <span className="text-white font-semibold">87%</span></div>
        <div className="text-white/80">Updated: <span className="text-white">2 mins ago</span></div>
      </div>
    </Card>
  );
}
