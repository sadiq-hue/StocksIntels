// Single source of truth for the Core / Pro / Premium plans.
//
// Every pricing surface imports this so a price or plan name can only be
// changed in one place: the marketing pricing page, the landing-page pricing
// block, and the checkout page all render from PLANS. Before this existed the
// same three tiers carried four different price lists across the site, and the
// pricing page linked to a /subscribe/core route that did not exist.
//
// Prices are USD. KES is derived with the same 130 rate the M-Pesa flow uses
// (backend index.js: USD_TO_KES_RATE).

export const USD_TO_KES = 130;

export type PlanId = "core" | "pro" | "premium";

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
  {
    id: "core",
    name: "Core",
    tagline: "Understand the market",
    monthlyPrice: 9.83,
    yearlyPrice: 79,
    popular: false,
    highlights: [
      "AI market intelligence",
      "Essential fundamentals analysis",
      "Basic technical intelligence",
      "Portfolio tracking",
    ],
    features: [
      { text: "AI market intelligence", included: true },
      { text: "Essential fundamentals analysis", included: true },
      { text: "Basic technical intelligence", included: true },
      { text: "News & sentiment (Basic)", included: true },
      { text: "Portfolio tracking", included: true },
      { text: "AI stock comparison", included: false },
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
      { text: "AI market intelligence", included: true },
      { text: "Advanced fundamentals analysis", included: true },
      { text: "Advanced technical intelligence", included: true },
      { text: "News & sentiment", included: true },
      { text: "Insider activity intelligence", included: true },
      { text: "AI stock comparison", included: true },
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
      "AI multi-market stock screening",
      "Cross-market intelligence",
      "Human analyst insights & research",
    ],
    features: [
      { text: "AI market intelligence", included: true },
      { text: "Advanced fundamentals analysis", included: true },
      { text: "Advanced technical intelligence", included: true },
      { text: "News & sentiment", included: true },
      { text: "Insider activity intelligence", included: true },
      { text: "AI stock comparison", included: true },
      { text: "AI multi-market stock screening", included: true },
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
];

/** Legacy /subscribe/:planId slugs still resolve to a real plan. */
const PLAN_ALIASES: Record<string, PlanId> = {
  starter: "core",
  core: "core",
  pro: "pro",
  premium: "premium",
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

/** Shown on every plan card and in the pricing FAQ. */
export const MONEY_BACK_GUARANTEE = "30-day money-back guarantee";
