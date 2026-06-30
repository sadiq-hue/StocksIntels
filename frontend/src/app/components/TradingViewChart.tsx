import { useEffect, useRef } from "react";

interface TradingViewChartProps {
  symbol: string;
  market: "nse" | "global";
  theme?: "light" | "dark";
}

export function TradingViewChart({ symbol, market, theme = "light" }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  const tvSymbol = market === "nse"
    ? `NSE:${symbol}`
    : symbol.includes(":") ? symbol : symbol;

  useEffect(() => {
    if (!containerRef.current) return;

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (typeof TradingView !== "undefined" && containerRef.current) {
        widgetRef.current = new TradingView.widget({
          container_id: containerRef.current.id,
          symbol: tvSymbol,
          interval: "D",
          timezone: "exchange",
          theme,
          style: "1",
          locale: "en",
          toolbar_bg: theme === "dark" ? "#1e222d" : "#f1f3f6",
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          save_image: false,
          height: 480,
          width: "100%",
          studies: [
            "RSI@tv-basicstudies",
            "MACD@tv-basicstudies",
            "BB@tv-basicstudies",
            "Volume@tv-basicstudies",
          ],
          disabled_features: [
            "use_localstorage_for_settings",
            "header_symbol_search",
          ],
          overrides: {
            "paneProperties.background": theme === "dark" ? "#1e222d" : "#ffffff",
            "paneProperties.vertGridProperties.color": theme === "dark" ? "#2a2e39" : "#e5e7eb",
            "paneProperties.horzGridProperties.color": theme === "dark" ? "#2a2e39" : "#e5e7eb",
          },
        });
      }
    };
    document.head.appendChild(script);

    return () => {
      if (widgetRef.current) {
        try { widgetRef.current.remove(); } catch {}
        widgetRef.current = null;
      }
    };
  }, [tvSymbol, theme]);

  return (
    <div
      id={`tv-chart-${symbol}`}
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: 480 }}
    />
  );
}

declare global {
  interface Window {
    TradingView: any;
  }
}
