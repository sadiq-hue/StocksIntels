import { registerTour } from "../components/GuidedTour";

registerTour("dashboard", [
  {
    target: "[data-tour='portfolio-cards']",
    title: "Your Portfolio at a Glance",
    content: "These cards show your total investment value, split between African exchanges and global markets. Holdings = how many different stocks you own. Market Intelligence = automated buy/sell suggestions from the engine.",
    position: "bottom",
  },
  {
    target: "[data-tour='market-indices']",
    title: "Market Indices",
    content: "Track major African and global benchmarks, including the NSE All Share, NGX All Share, FTSE/JSE All Share and S&P 500. Green numbers mean the market is up today, red means it's down.",
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
