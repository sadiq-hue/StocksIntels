import { useEffect, useRef } from "react";

interface TradingViewChartProps {
  symbol: string;
  market: "nse" | "global";
  theme?: "light" | "dark";
}

const TV_SCRIPT_URL = "https://s3.tradingview.com/tv.js";

function createWidget(containerId: string, symbol: string, theme: string) {
  if (typeof TradingView === "undefined") return null;
  return new TradingView.widget({
    container_id: containerId,
    symbol,
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

export function TradingViewChart({ symbol, market, theme = "light" }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  const tvSymbol = market === "nse"
    ? `NSE:${symbol}`
    : symbol.includes(":") ? symbol : symbol;

  useEffect(() => {
    if (!containerRef.current) return;
    const id = containerRef.current.id;

    if (typeof TradingView !== "undefined") {
      widgetRef.current = createWidget(id, tvSymbol, theme);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TV_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        if (containerRef.current) {
          widgetRef.current = createWidget(id, tvSymbol, theme);
        }
      }, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TV_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (containerRef.current) {
        widgetRef.current = createWidget(id, tvSymbol, theme);
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
