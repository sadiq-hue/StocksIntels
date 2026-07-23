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
  const [token, setToken] = useState('');
  const [loaded, setLoaded] = useState(false);

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
    document.head.appendChild(script);
  }, []);

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
      appearance: 'interaction-only',
    });
  }, [loaded]);

  useEffect(() => {
    renderWidget();
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

  return { containerRef, token, reset, enabled: !!SITE_KEY };
}
