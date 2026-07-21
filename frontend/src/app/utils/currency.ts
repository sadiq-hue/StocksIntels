export interface CurrencyOption {
  code: string;
  symbol: string;
  name: string;
  locale: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: "KES", symbol: "KES", name: "Kenyan Shilling", locale: "en-KE" },
  { code: "USD", symbol: "$", name: "US Dollar", locale: "en-US" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", locale: "en-NG" },
  { code: "ZAR", symbol: "R", name: "South African Rand", locale: "en-ZA" },
  { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi", locale: "en-GH" },
  { code: "EUR", symbol: "€", name: "Euro", locale: "en-EU" },
  { code: "GBP", symbol: "£", name: "British Pound", locale: "en-GB" },
  { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling", locale: "en-TZ" },
];

// Rates relative to USD (approximate mid-market). KES is overridden by live rate.
const USD_RATES: Record<string, number> = {
  USD: 1,
  KES: 130,
  NGN: 1550,
  ZAR: 18.2,
  GHS: 15.8,
  EUR: 0.79,
  GBP: 0.74,
  TZS: 2500,
};

export function getUsdToTargetRate(target: string, liveKesRate?: number): number {
  const base = USD_RATES[target] || 1;
  if (target === "KES" && liveKesRate) return liveKesRate;
  return base;
}

export function convertFromUsd(amountUsd: number, target: string, liveKesRate?: number): number {
  return amountUsd * getUsdToTargetRate(target, liveKesRate);
}

export function convertFromKes(amountKes: number, target: string, liveKesRate?: number): number {
  const rate = liveKesRate || USD_RATES.KES;
  const amountUsd = amountKes / rate;
  return convertFromUsd(amountUsd, target, liveKesRate);
}

export function toDisplayCurrency(
  amount: number,
  sourceCurrency: "KES" | "USD",
  targetCurrency: string,
  liveKesRate?: number
): number {
  if (sourceCurrency === targetCurrency) return amount;
  if (sourceCurrency === "USD") return convertFromUsd(amount, targetCurrency, liveKesRate);
  return convertFromKes(amount, targetCurrency, liveKesRate);
}

export function formatCurrencyValue(amount: number, currencyCode: string): string {
  const opt = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0];
  if (currencyCode === "KES" || currencyCode === "NGN" || currencyCode === "TZS") {
    return `${opt.symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${opt.symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCompactCurrency(amount: number, currencyCode: string): string {
  const opt = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0];
  if (currencyCode === "KES" || currencyCode === "NGN" || currencyCode === "TZS") {
    return `${opt.symbol} ${Math.round(amount).toLocaleString()}`;
  }
  return `${opt.symbol}${Math.round(amount).toLocaleString()}`;
}

export const PORTFOLIO_CURRENCY_KEY = "portfolio_display_currency";
