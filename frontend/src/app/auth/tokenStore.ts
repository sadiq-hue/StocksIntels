let _token: string | null = null;
let _listeners: Array<(token: string | null) => void> = [];

export function getToken(): string | null {
  return _token;
}

export function setToken(token: string | null) {
  _token = token;
  _listeners.forEach(fn => fn(token));
}

export function onTokenChange(fn: (token: string | null) => void) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(f => f !== fn); };
}
