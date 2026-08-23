// Meta (Facebook) Pixel for Meta Ads tracking.
// Set VITE_META_PIXEL_ID in your environment to enable.

interface FbqCall {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: (...args: unknown[]) => void;
}

declare global {
  interface Window {
    fbq?: FbqCall;
    _fbq?: FbqCall;
  }
}

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;

let initialized = false;

/** Standard Meta Pixel events relevant to this app's funnel. */
export const MetaEvents = {
  ViewContent: "ViewContent",
  InitiateCheckout: "InitiateCheckout",
  AddPaymentInfo: "AddPaymentInfo",
  Purchase: "Purchase",
  Lead: "Lead",
  CompleteRegistration: "CompleteRegistration",
  StartTrial: "StartTrial",
} as const;

/** Injects the Meta Pixel base code once, if a pixel ID is configured. */
export function initMetaPixel(): void {
  if (initialized || !PIXEL_ID || typeof window === "undefined") return;

  if (!window.fbq) {
    const fbq = function (...args: unknown[]) {
      const pixel = window.fbq;
      if (pixel?.callMethod) pixel.callMethod(...args);
      else pixel?.queue.push(args);
    } as FbqCall;

    window.fbq = fbq;
    window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "3.0";
    fbq.queue = [];

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }

  window.fbq!("init", PIXEL_ID);
  initialized = true;
}

export function isMetaPixelEnabled(): boolean {
  return initialized && !!window.fbq;
}

/** Fire PageView — called automatically on every route change in App.tsx. */
export function trackPageView(): void {
  if (!isMetaPixelEnabled()) return;
  window.fbq!("track", "PageView");
}

/**
 * Track a standard or custom event with optional parameters.
 * No-ops when the pixel is not configured (dev / no ads setup).
 */
export function trackEvent(
  event: string,
  params?: Record<string, unknown>
): void {
  if (!isMetaPixelEnabled()) return;
  try {
    window.fbq!("track", event, params);
  } catch (err) {
    console.warn(`Meta Pixel event "${event}" failed:`, err);
  }
}
