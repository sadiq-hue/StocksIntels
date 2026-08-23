// X (Twitter) Pixel for X Ads tracking.
// Set VITE_X_PIXEL_ID in your environment to enable.

interface TwqCall {
  (...args: unknown[]): void;
  exe?: (...args: unknown[]) => void;
  queue: unknown[];
  version: string;
}

declare global {
  interface Window {
    twq?: TwqCall;
  }
}

const PIXEL_ID = import.meta.env.VITE_X_PIXEL_ID as string | undefined;

let initialized = false;

/** Standard X Pixel events relevant to this app's funnel. */
export const XEvents = {
  PageView: "PageView",
  ViewContent: "ViewContent",
  Signup: "Signup",
  Purchase: "Purchase",
} as const;

/** Injects the X Pixel base code once, if a pixel ID is configured. */
export function initXPixel(): void {
  if (initialized || !PIXEL_ID || typeof window === "undefined") return;

  if (!window.twq) {
    const twq = function (...args: unknown[]) {
      const pixel = window.twq;
      if (pixel?.exe) pixel.exe(...args);
      else pixel?.queue.push(args);
    } as TwqCall;

    window.twq = twq;
    twq.version = "1.1";
    twq.queue = [];

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://static.ads-twitter.com/uwt.js";
    document.head.appendChild(script);
  }

  window.twq("config", PIXEL_ID);
  initialized = true;
}

export function isXPixelEnabled(): boolean {
  return initialized && !!window.twq;
}

/** Fire PageView — called automatically on every route change in App.tsx. */
export function trackXPageView(): void {
  if (!isXPixelEnabled()) return;
  try {
    window.twq!("track", XEvents.PageView);
  } catch (err) {
    console.warn("X Pixel PageView failed:", err);
  }
}

/**
 * Track an X Pixel event with optional parameters.
 * No-ops when the pixel is not configured (dev / no ads setup).
 */
export function trackXEvent(
  event: string,
  params?: Record<string, unknown>
): void {
  if (!isXPixelEnabled()) return;
  try {
    window.twq!("track", event, params);
  } catch (err) {
    console.warn(`X Pixel event "${event}" failed:`, err);
  }
}
