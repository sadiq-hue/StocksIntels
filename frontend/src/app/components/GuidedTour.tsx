import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { ChevronRight, ChevronLeft, X, Sparkles } from "lucide-react";
import { useBeginnerMode } from "../contexts/BeginnerModeContext";

export interface TourStep {
  target: string;          // CSS selector for the element to highlight
  title: string;
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface PageTour {
  page: string;            // route path segment (e.g. "dashboard", "signals")
  steps: TourStep[];
}

// Registry of all page tours
const tours: Record<string, TourStep[]> = {};

export function registerTour(page: string, steps: TourStep[]) {
  tours[page] = steps;
}

interface TourState {
  active: boolean;
  page: string | null;
  stepIndex: number;
}

export function GuidedTour() {
  const { beginnerMode } = useBeginnerMode();
  const [state, setState] = useState<TourState>({ active: false, page: null, stepIndex: 0 });
  const [rect, setRect] = useState<DOMRect | null>(null);

  const startTour = useCallback((page: string) => {
    const steps = tours[page];
    if (!steps || steps.length === 0) return;
    const dismissed = localStorage.getItem(`tour_dismissed_${page}`);
    if (dismissed === "true" && !beginnerMode) return;
    setState({ active: true, page, stepIndex: 0 });
  }, [beginnerMode]);

  const stopTour = useCallback(() => {
    setState({ active: false, page: null, stepIndex: 0 });
  }, []);

  const next = useCallback(() => {
    if (!state.page) return;
    const steps = tours[state.page];
    if (state.stepIndex < steps.length - 1) {
      setState(s => ({ ...s, stepIndex: s.stepIndex + 1 }));
    } else {
      localStorage.setItem(`tour_dismissed_${state.page}`, "true");
      stopTour();
    }
  }, [state, stopTour]);

  const prev = useCallback(() => {
    if (state.stepIndex > 0) {
      setState(s => ({ ...s, stepIndex: s.stepIndex - 1 }));
    }
  }, [state]);

  const dismiss = useCallback(() => {
    if (state.page) localStorage.setItem(`tour_dismissed_${state.page}`, "true");
    stopTour();
  }, [state, stopTour]);

  // Recalculate highlight position on step change or scroll/resize
  useEffect(() => {
    if (!state.active || !state.page) { setRect(null); return; }
    const steps = tours[state.page];
    const step = steps?.[state.stepIndex];
    if (!step) { setRect(null); return; }

    const updateRect = () => {
      const el = document.querySelector(step.target);
      if (el) setRect(el.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [state, stopTour]);

  // Listen for page changes
  useEffect(() => {
    const handle = () => {
      const path = window.location.pathname.replace("/app/", "").replace("/app", "dashboard") || "dashboard";
      const page = path.split("/")[0];
      if (beginnerMode) startTour(page);
    };
    handle();
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, [beginnerMode, startTour]);

  if (!state.active || !state.page) return null;
  const steps = tours[state.page];
  if (!steps || steps.length === 0) return null;
  const step = steps[state.stepIndex];

  const position = step.position || "bottom";

  let tooltipStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: 10001,
    maxWidth: 380,
  };

  if (rect) {
    const padding = 16;
    switch (position) {
      case "bottom":
        tooltipStyle.top = rect.bottom + padding;
        tooltipStyle.left = Math.max(padding, rect.left + rect.width / 2 - 190);
        break;
      case "top":
        tooltipStyle.bottom = window.innerHeight - rect.top + padding;
        tooltipStyle.left = Math.max(padding, rect.left + rect.width / 2 - 190);
        break;
      case "right":
        tooltipStyle.top = rect.top + rect.height / 2 - 80;
        tooltipStyle.left = rect.right + padding;
        break;
      case "left":
        tooltipStyle.top = rect.top + rect.height / 2 - 80;
        tooltipStyle.right = window.innerWidth - rect.left + padding;
        break;
    }
  }
  // Clamp to viewport
  const leftVal = typeof tooltipStyle.left === 'number' ? tooltipStyle.left : (typeof tooltipStyle.left === 'string' ? parseFloat(tooltipStyle.left) : NaN);
  if (!isNaN(leftVal)) {
    if (leftVal < 8) tooltipStyle.left = 8;
    if (leftVal + 380 > window.innerWidth - 8) tooltipStyle.left = window.innerWidth - 388;
  }

  return (
    <>
      {/* Overlay with cutout */}
      {rect && (
        <div className="fixed inset-0 z-[9999] pointer-events-none">
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute bg-transparent pointer-events-none"
            style={{
              top: rect.top - 4,
              left: rect.left - 4,
              width: rect.width + 8,
              height: rect.height + 8,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
              borderRadius: 10,
            }}
          />
        </div>
      )}

      {/* Tooltip */}
      <div
        style={tooltipStyle}
        className="bg-card border border-border rounded-xl shadow-2xl p-5 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-primary flex items-center gap-1.5">
            <Sparkles className="size-3" />
            Step {state.stepIndex + 1} of {steps.length}
          </span>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>
        <h3 className="font-semibold text-sm text-foreground mb-1">{step.title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{step.content}</p>
        <div className="flex items-center justify-between">
          <button
            onClick={dismiss}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {state.stepIndex > 0 && (
              <button
                onClick={prev}
                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                <ChevronLeft className="size-3.5" /> Back
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {state.stepIndex < steps.length - 1 ? (
                <>Next <ChevronRight className="size-3.5" /></>
              ) : (
                "Got it!"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
