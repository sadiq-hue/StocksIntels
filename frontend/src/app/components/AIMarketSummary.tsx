import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Sparkles, Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface MarketSummary {
  summary: string;
  sentiment: string;
  confidence: string;
  timestamp: string;
  signals: {
    total: number;
    strongBuy: number;
    buys: number;
    sells: number;
  };
}

export function AIMarketSummary() {
  const [data, setData] = useState<MarketSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/ai/market-summary`)
      .then(res => res.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const sentimentColors: Record<string, string> = {
    'Bullish': 'bg-green-500',
    'Slightly Bullish': 'bg-green-400',
    'Neutral': 'bg-yellow-500',
    'Slightly Bearish': 'bg-orange-400',
    'Bearish': 'bg-red-500',
  };

  return (
    <Card className="bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] border-[#0D7490] p-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-white" />
        <h3 className="text-white">AI Market Summary</h3>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-white/70">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Analyzing markets...</span>
        </div>
      ) : data ? (
        <>
          <p className="text-white/95 leading-relaxed">{data.summary}</p>
          <div className="mt-4 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${sentimentColors[data.sentiment] || 'bg-gray-400'}`} />
              <span className="text-white/80">{data.sentiment}</span>
            </div>
            <div className="text-white/80">Confidence: <span className="text-white font-semibold">{data.confidence}</span></div>
            <div className="text-white/80">{data.signals.total} stocks tracked</div>
          </div>
        </>
      ) : (
        <p className="text-white/70">Market summary temporarily unavailable.</p>
      )}
    </Card>
  );
}
