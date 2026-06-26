let _token: string | null = null;

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
