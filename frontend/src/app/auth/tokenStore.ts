let _token: string | null = null;
let _patched = false;

export function getToken(): string | null {
  return _token;
}

export function setToken(token: string | null) {
  _token = token;
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  const token = _token;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

/** Patch global fetch to include auth token for API requests */
export function patchGlobalFetch() {
  if (_patched) return;
  _patched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : 'url' in input ? input.url : '';
    if (url.startsWith('/api/')) {
      const headers: Record<string, string> = { ...(init?.headers as Record<string, string> || {}) };
      const token = _token;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return originalFetch(input, { ...init, headers, credentials: init?.credentials || 'include' });
    }
    return originalFetch(input, init);
  };
}
