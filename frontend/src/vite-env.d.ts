/// <reference types="vite/client" />

interface TradingViewWidgetOptions {
  container_id: string;
  symbol: string;
  interval: string;
  timezone?: string;
  theme?: string;
  style?: string;
  locale?: string;
  toolbar_bg?: string;
  enable_publishing?: boolean;
  hide_side_toolbar?: boolean;
  allow_symbol_change?: boolean;
  save_image?: boolean;
  autosize?: boolean;
  studies?: string[];
  disabled_features?: string[];
  overrides?: Record<string, string>;
  [key: string]: unknown;
}

interface TradingViewApi {
  widget: new (options: TradingViewWidgetOptions) => unknown;
  [key: string]: unknown;
}

declare const TradingView: TradingViewApi;
