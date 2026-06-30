import { useEffect, useRef } from "react";

interface TradingViewChartProps {
  symbol: string;
  market: "nse" | "global";
  theme?: "light" | "dark";
}

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

    function init() {
      if (containerRef.current && typeof TradingView !== "undefined") {
        widgetRef.current = createWidget(containerRef.current.id, tvSymbol, theme);
      }
    }

    if (typeof TradingView !== "undefined") {
      init();
      return () => {
        if (widgetRef.current) {
          try { widgetRef.current.remove(); } catch {}
          widgetRef.current = null;
        }
      };
    }

    const check = setInterval(() => {
      if (typeof TradingView !== "undefined") {
        clearInterval(check);
        init();
      }
    }, 300);

    return () => {
      clearInterval(check);
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
