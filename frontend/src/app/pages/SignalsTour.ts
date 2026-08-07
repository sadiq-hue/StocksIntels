import { registerTour } from "../components/GuidedTour";

registerTour("signals", [
  {
    target: "[data-tour='signals-stats']",
    title: "Signal Overview",
    content: "These stats give you a quick snapshot: how many signals are active, how many are Buy vs Sell ratings, and the average confidence level. Use this to gauge the market's overall direction.",
    position: "bottom",
  },
  {
    target: "[data-tour='signals-filters']",
    title: "Filtering Signals",
    content: "Narrow down signals by typing a stock name, or by selecting a signal type (Swing Trade, Long Term, etc.), rating (Buy/Sell), or sector. Click the Sort dropdown to order by confidence or price change.",
    position: "bottom",
  },
  {
    target: "[data-tour='signal-card']",
    title: "Reading a Signal Card",
    content: "Each card is a trade idea. The colored bar on the left shows the rating: green = Strong Buy, amber = Hold, red = Strong Sell. The badges tell you the strategy type, sector, and expected holding period.",
    position: "right",
  },
  {
    target: "[data-tour='signal-levels']",
    title: "Entry, Stop & Targets",
    content: "Entry = the price the engine recommends buying at. Stop Loss = your safety net — if the price drops this low, you exit to limit losses. Target 1 = the first profit-taking level. These are based on the stock's volatility and risk profile.",
    position: "right",
  },
  {
    target: "[data-tour='signal-confidence']",
    title: "Confidence & Risk/Reward",
    content: "Confidence = how sure the engine is about this signal (higher is better). R:R = Reward-to-Risk ratio — how much you stand to gain for every shilling you risk. A ratio above 2:1 means you could make twice what you risk.",
    position: "right",
  },
]);
