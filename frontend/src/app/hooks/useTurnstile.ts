import { useEffect, useRef, useCallback, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
      getResponse: (widgetId: string) => string | undefined;
    };
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export function useTurnstile() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [token, setToken] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    if (document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
      setLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => setLoaded(true);
    script.onerror = () => setUnavailable(true);
    document.head.appendChild(script);
  }, []);

  // Best-effort: if no token within 10s, stop gating the submit button so the
  // CAPTCHA being unavailable never blocks login (backend fails open too).
  useEffect(() => {
    if (!SITE_KEY) return;
    watchdogRef.current = setTimeout(() => setUnavailable(true), 10000);
    return () => { if (watchdogRef.current) clearTimeout(watchdogRef.current); };
  }, []);

  useEffect(() => {
    if (token) {
      setUnavailable(false);
      if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    }
  }, [token]);

  const renderWidget = useCallback(() => {
    if (!SITE_KEY || !loaded || !containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      try { window.turnstile.remove(widgetIdRef.current); } catch {}
    }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (t: string) => setToken(t),
      'expired-callback': () => setToken(''),
      'error-callback': () => setToken(''),
      theme: 'auto',
      appearance: 'always',
    });
  }, [loaded]);

  useEffect(() => {
    // window.turnstile can lag the script's onload event; retry briefly so the
    // widget always renders. Without it the submit button (gated on the token)
    // stays disabled forever when the challenge never appears.
    let attempts = 0;
    const mount = () => {
      if (!containerRef.current) return;
      if (window.turnstile) { renderWidget(); return; }
      if (attempts++ < 20) setTimeout(mount, 250);
    };
    mount();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
      }
    };
  }, [renderWidget]);

  const reset = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      setToken('');
      try { window.turnstile.reset(widgetIdRef.current); } catch {}
    }
  }, []);

  return { containerRef, token, reset, enabled: !!SITE_KEY, unavailable };
}
