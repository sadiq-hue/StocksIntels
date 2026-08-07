import { registerTour } from "../components/GuidedTour";

registerTour("financials", [
  {
    target: "[data-tour='fin-search']",
    title: "Find a Stock",
    content: "Type a ticker symbol (like AAPL for Apple or SCOM for Safaricom) and click Load to pull up that company's financial reports. You can also click the quick-access button bubbles for popular stocks.",
    position: "bottom",
  },
  {
    target: "[data-tour='fin-kpi']",
    title: "Key Performance Indicators",
    content: "These cards give you the company's vital stats at a glance. Market Cap = total company worth. P/E Ratio = how much you pay per dollar of earnings. Revenue = total sales. Net Income = profit after all costs. EPS = earnings per share. Div Yield = dividend payout as a percentage of the stock price.",
    position: "bottom",
  },
  {
    target: "[data-tour='fin-controls']",
    title: "Period & Data Source",
    content: "Switch between Annual (yearly) and Quarterly (3-month) reports. Choose Yahoo Finance for standard data or SEC EDGAR for official company filings directly from the US regulator. The Refresh button reloads the latest data.",
    position: "bottom",
  },
  {
    target: "[data-tour='fin-tabs']",
    title: "Financial Statements",
    content: "Summary shows revenue and profit trends as charts. Income = the company's sales and expenses (like a payslip). Balance = what the company owns vs owes (assets vs liabilities). Cash Flow = actual money moving in and out. Ratios = key health metrics like debt-to-equity.",
    position: "bottom",
  },
  {
    target: "[data-tour='fin-chart']",
    title: "Revenue & Profit Charts",
    content: "These charts show how the company's sales and earnings have trended over time. An upward-sloping green line means growing revenue or profit — a good sign. Red bars mean the company lost money that year.",
    position: "bottom",
  },
]);
