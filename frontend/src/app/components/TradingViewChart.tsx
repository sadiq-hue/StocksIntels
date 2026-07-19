import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

interface TradingViewChartProps {
  symbol: string;
  market: "nse" | "global";
  theme?: "light" | "dark";
  onError?: () => void;
}

function buildTvSymbol(symbol: string, market: "nse" | "global"): string {
  if (market === "nse") return `NSE:${symbol}`;
  // TradingView uses EXCHANGE:SYMBOL format; pass through if already prefixed
  return symbol.includes(":") ? symbol : symbol;
}

function createWidget(
  containerId: string,
  tvSymbol: string,
  theme: string,
  onError?: () => void,
): any {
  try {
    if (typeof TradingView === "undefined") {
      onError?.();
      return null;
    }
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
      autosize: true,
      studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "BB@tv-basicstudies", "Volume@tv-basicstudies"],
      disabled_features: ["use_localstorage_for_settings", "header_symbol_search"],
      overrides: {
        "paneProperties.background": theme === "dark" ? "#1e222d" : "#ffffff",
        "paneProperties.vertGridProperties.color": theme === "dark" ? "#2a2e39" : "#e5e7eb",
        "paneProperties.horzGridProperties.color": theme === "dark" ? "#2a2e39" : "#e5e7eb",
      },
    });
  } catch {
    onError?.();
    return null;
  }
}

function destroyWidget(widget: any) {
  try {
    widget?.remove();
  } catch {
    // ignore
  }
}

export function TradingViewChart({ symbol, market, theme = "light", onError }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);

  const tvSymbol = buildTvSymbol(symbol, market);
  const containerId = `tv-chart-${symbol}-${market}`;

  // Load the TradingView library once
  useEffect(() => {
    if (typeof TradingView !== "undefined") {
      setScriptLoaded(true);
      return;
    }
    let cancelled = false;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => { if (!cancelled) setScriptLoaded(true); };
    script.onerror = () => { if (!cancelled) { setScriptFailed(true); onError?.(); } };
    document.head.appendChild(script);
    return () => { cancelled = true; };
  }, [onError]);

  // Create / recreate widget when symbol, theme, or library changes
  useEffect(() => {
    if (!scriptLoaded || scriptFailed) return;

    const container = containerRef.current;
    if (!container) return;

    // Destroy existing widget before re-initializing
    destroyWidget(widgetRef.current);
    widgetRef.current = null;
    container.innerHTML = "";

    // Small delay to ensure DOM is ready
    const id = setTimeout(() => {
      widgetRef.current = createWidget(containerId, tvSymbol, theme, onError);
    }, 50);

    return () => {
      clearTimeout(id);
      destroyWidget(widgetRef.current);
      widgetRef.current = null;
    };
  }, [tvSymbol, theme, scriptLoaded, scriptFailed, containerId, onError]);

  return (
    <div className="relative w-full">
      {!scriptLoaded && !scriptFailed && (
        <div className="flex items-center justify-center h-[320px] sm:h-[480px] text-sm text-muted-foreground bg-muted/20 rounded-lg">
          <Loader2 className="size-5 animate-spin mr-2" /> Loading TradingView chart...
        </div>
      )}
      {scriptFailed && (
        <div className="flex items-center justify-center h-[320px] sm:h-[480px] text-sm text-muted-foreground bg-muted/20 rounded-lg">
          Failed to load TradingView chart library
        </div>
      )}
      <div
        id={containerId}
        ref={containerRef}
        className={`w-full rounded-lg h-[320px] sm:h-[480px] ${!scriptLoaded ? "hidden" : ""}`}
      />
    </div>
  );
}

declare global {
  interface Window {
    TradingView: any;
  }
}
