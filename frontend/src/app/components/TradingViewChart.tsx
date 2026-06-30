import { useEffect, useRef } from "react";

interface TradingViewChartProps {
  symbol: string;
  market: "nse" | "global";
  theme?: "light" | "dark";
  onError?: () => void;
}

function createWidget(containerId: string, tvSymbol: string, theme: string) {
  try {
    if (typeof TradingView === "undefined") return null;
    return new TradingView.widget({
      container_id: containerId,
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
  } catch {
    return null;
  }
}

export function TradingViewChart({ symbol, market, theme = "light", onError }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const initAttempted = useRef(false);

  const tvSymbol = market === "nse"
    ? `NSE:${symbol}`
    : symbol.includes(":") ? symbol : symbol;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initAttempted.current) return;
    initAttempted.current = true;

    container.innerHTML = "";

    function init() {
      if (widgetRef.current) return;
      widgetRef.current = createWidget(container.id, tvSymbol, theme);
      if (!widgetRef.current && onError) {
        setTimeout(onError, 100);
      }
    }

    const doInit = () => setTimeout(init, 100);

    if (typeof TradingView !== "undefined") {
      doInit();
      return () => {
        try { widgetRef.current?.remove(); } catch {}
        widgetRef.current = null;
        initAttempted.current = false;
      };
    }

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = doInit;
    document.head.appendChild(script);

    return () => {
      try { widgetRef.current?.remove(); } catch {}
      widgetRef.current = null;
      initAttempted.current = false;
    };
  }, [tvSymbol, theme, onError]);

  return (
    <div
      id={`tv-chart-${symbol}`}
      ref={containerRef}
      className="w-full rounded-lg"
      style={{ height: 480 }}
    />
  );
}

declare global {
  interface Window {
    TradingView: any;
  }
}
