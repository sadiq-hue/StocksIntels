import { registerTour } from "../components/GuidedTour";

registerTour("dashboard", [
  {
    target: "[data-tour='portfolio-cards']",
    title: "Your Portfolio at a Glance",
    content: "These cards show your total investment value, split between the Nairobi Securities Exchange (NSE) and global markets. Holdings = how many different stocks you own. AI Signals = automated buy/sell suggestions from the engine.",
    position: "bottom",
  },
  {
    target: "[data-tour='market-indices']",
    title: "Market Indices",
    content: "Track how the overall market is performing. The NSE 20 tracks Kenya's top companies. The S&P 500 tracks America's 500 largest. Green numbers mean the market is up today, red means it's down.",
    position: "bottom",
  },
  {
    target: "[data-tour='sector-performance']",
    title: "Sector Performance",
    content: "See which industries are leading or lagging today. Green bars mean the sector is up — useful for spotting where the market's money is flowing.",
    position: "bottom",
  },
  {
    target: "[data-tour='top-movers']",
    title: "Top Gainers & Top Losers",
    content: "The biggest price movers of the day. Green names are up, red names are down. Click any stock to see its full analysis page.",
    position: "bottom",
  },
  {
    target: "[data-tour='ai-signals-section']",
    title: "AI Trading Signals",
    content: "The engine scans all stocks and issues Buy or Sell recommendations when it finds strong evidence. Strong Buy = highest confidence. Each signal shows entry price, stop loss (your safety net), and price targets.",
    position: "bottom",
  },
]);
