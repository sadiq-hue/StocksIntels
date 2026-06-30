import { useEffect, useRef, useState } from "react";

interface TradingViewChartProps {
  symbol: string;
  market: "nse" | "global";
  theme?: "light" | "dark";
}

export function TradingViewChart({ symbol, market, theme = "light" }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const widgetCreated = useRef(false);

  const tvSymbol = market === "nse"
    ? `NSE:${symbol}`
    : symbol.includes(":") ? symbol : symbol;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    widgetCreated.current = false;
    setFailed(false);

    container.innerHTML = "";

    function createWidget() {
      if (widgetCreated.current) return;
      try {
        if (typeof TradingView === "undefined") return;
        widgetCreated.current = true;
        new TradingView.widget({
          container_id: container.id,
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
        setFailed(true);
      }
    }

    if (typeof TradingView !== "undefined") {
      createWidget();
      return;
    }

    const check = setInterval(() => {
      if (typeof TradingView !== "undefined") {
        clearInterval(check);
        createWidget();
      }
    }, 200);

    setTimeout(() => clearInterval(check), 15000);

    return () => {
      widgetCreated.current = true;
      clearInterval(check);
      container.innerHTML = "";
    };
  }, [tvSymbol, theme]);

  if (failed) {
    return (
      <div className="flex items-center justify-center h-[340px] text-sm text-muted-foreground rounded-lg bg-muted/20 border">
        Chart unavailable for this symbol
      </div>
    );
  }

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
