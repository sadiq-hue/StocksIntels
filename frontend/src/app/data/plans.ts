// Single source of truth for all pricing plans.
//
// Every pricing surface imports this so a price or plan name can only be
// changed in one place: the marketing pricing page, the landing-page pricing
// block, the developer portal pricing, and the checkout page all render from PLANS.

export const USD_TO_KES = 130;

export type PlanId = "core" | "pro" | "premium" | "free" | "starter" | "enterprise" | "api-pro";

export interface PlanFeature {
  text: string;
  included: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** One-line positioning shown under the plan name. */
  tagline: string;
  monthlyPrice: number;
  yearlyPrice: number;
  popular: boolean;
  /** Short included-only bullets for the landing page and checkout summary. */
  highlights: string[];
  /** Full checklist for the pricing cards; excluded rows render with a cross. */
  features: PlanFeature[];
}

export const PLANS: Plan[] = [
  // Marketing plans (Core, Pro, Premium)
  {
    id: "core",
    name: "Core",
    tagline: "Understand the market",
    monthlyPrice: 9.83,
    yearlyPrice: 79,
    popular: false,
    highlights: [
      "Market intelligence workspace",
      "Essential fundamentals analysis",
      "Basic technical intelligence",
      "Portfolio tracking",
    ],
    features: [
      { text: "Market intelligence workspace", included: true },
      { text: "Essential fundamentals analysis", included: true },
      { text: "Basic technical intelligence", included: true },
      { text: "News & sentiment (Basic)", included: true },
      { text: "Portfolio tracking", included: true },
      { text: "Company comparison", included: false },
      { text: "Advanced stock screening", included: false },
      { text: "Investment thesis & analysis", included: false },
      { text: "Advanced portfolio risk analysis", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Research better",
    monthlyPrice: 19.78,
    yearlyPrice: 159,
    popular: true,
    highlights: [
      "Advanced fundamentals & technicals",
      "Insider activity intelligence",
      "Investment thesis & bull/bear cases",
      "Advanced portfolio risk analysis",
    ],
    features: [
      { text: "Market intelligence workspace", included: true },
      { text: "Advanced fundamentals analysis", included: true },
      { text: "Advanced technical intelligence", included: true },
      { text: "News & sentiment", included: true },
      { text: "Insider activity intelligence", included: true },
      { text: "Company comparison", included: true },
      { text: "Advanced stock screening", included: true },
      { text: "Investment thesis & analysis", included: true },
      { text: "Bull / Bear case analysis", included: true },
      { text: "Advanced portfolio risk analysis", included: true },
      { text: "Priority support", included: true },
    ],
  },
  {
    id: "premium",
    name: "Premium",
    tagline: "Operate like a serious investor",
    monthlyPrice: 49.63,
    yearlyPrice: 399,
    popular: false,
    highlights: [
      "Everything in Pro",
      "Multi-market stock screening",
      "Cross-market intelligence",
      "Human analyst insights & research",
    ],
    features: [
      { text: "Market intelligence workspace", included: true },
      { text: "Advanced fundamentals analysis", included: true },
      { text: "Advanced technical intelligence", included: true },
      { text: "News & sentiment", included: true },
      { text: "Insider activity intelligence", included: true },
      { text: "Company comparison", included: true },
      { text: "Multi-market stock screening", included: true },
      { text: "Investment thesis & analysis", included: true },
      { text: "Bull / Bear case analysis", included: true },
      { text: "Advanced portfolio risk analysis", included: true },
      { text: "Cross-market intelligence", included: true },
      { text: "Human analyst insights & research", included: true },
      { text: "Analyst market commentary", included: true },
      { text: "Analyst Q&A support", included: true },
      { text: "Dedicated support", included: true },
    ],
  },
  // Developer API plans (Free, Starter, Pro, Enterprise)
  {
    id: "free",
    name: "Free",
    tagline: "Start building",
    monthlyPrice: 0,
    yearlyPrice: 0,
    popular: false,
    highlights: [
      "REST API access",
      "End-of-day market data",
      "1,000 requests/day",
      "Basic recommended positions",
    ],
    features: [
      { text: "REST API access", included: true },
      { text: "End-of-day market data", included: true },
      { text: "1,000 requests/day", included: true },
      { text: "Basic recommended positions", included: true },
      { text: "Community support", included: true },
      { text: "WebSocket streaming", included: false },
      { text: "Real-time data", included: false },
      { text: "Webhooks", included: false },
    ],
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Build with live data",
    monthlyPrice: 29.94,
    yearlyPrice: 299,
    popular: false,
    highlights: [
      "REST API access",
      "Real-time market quotes",
      "10,000 requests/day",
      "Basic recommended positions",
    ],
    features: [
      { text: "REST API access", included: true },
      { text: "Real-time market quotes", included: true },
      { text: "10,000 requests/day", included: true },
      { text: "Basic recommended positions", included: true },
      { text: "Email support", included: true },
      { text: "WebSocket streaming", included: false },
      { text: "Advanced recommended positions", included: false },
      { text: "Webhooks", included: false },
    ],
  },
  {
    id: "api-pro",
    name: "Pro",
    tagline: "Scale your integration",
    monthlyPrice: 49.83,
    yearlyPrice: 499,
    popular: true,
    highlights: [
      "Real-time data, recommended positions, webhooks, WebSocket streaming",
    ],
    features: [
      { text: "REST API + WebSocket", included: true },
      { text: "Real-time market data", included: true },
      { text: "100,000 requests/day", included: true },
      { text: "Full recommended positions", included: true },
      { text: "Webhooks & event streaming", included: true },
      { text: "Priority email support", included: true },
      { text: "Advanced screening", included: true },
      { text: "SLA: 99.9% uptime", included: true },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Custom infrastructure",
    monthlyPrice: 0, // Custom pricing
    yearlyPrice: 0,
    popular: false,
    highlights: [
      "Dedicated infrastructure, SLA, tailored data access",
    ],
    features: [
      { text: "Dedicated infrastructure", included: true },
      { text: "Custom rate limits", included: true },
      { text: "Real-time global equities", included: true },
      { text: "Full recommended positions", included: true },
      { text: "Webhooks & WebSocket", included: true },
      { text: "Dedicated support engineer", included: true },
      { text: "Custom SLA & contracts", included: true },
      { text: "On-premise deployment option", included: true },
    ],
  },
];

/** Legacy /subscribe/:planId slugs still resolve to a real plan. */
const PLAN_ALIASES: Record<string, PlanId> = {
  starter: "starter",
  core: "core",
  pro: "pro",
  premium: "premium",
  free: "free",
  enterprise: "enterprise",
  "api-pro": "api-pro",
};

export function planById(id?: string): Plan {
  const key = String(id || "").toLowerCase();
  const resolved = PLAN_ALIASES[key];
  return PLANS.find((p) => p.id === resolved) || PLANS[0];
}

export function kesPrice(monthlyUsd: number): number {
  return Math.round(monthlyUsd * USD_TO_KES);
}

export const YEARLY_SAVINGS_LABEL = "Save 33%+";

/** Shown on every plan card and in the pricing FAQ. Applies to yearly plans. */
export const MONEY_BACK_GUARANTEE = "30-day money-back guarantee on yearly subscriptions";
