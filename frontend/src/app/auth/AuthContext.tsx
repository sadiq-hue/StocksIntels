import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "/api";

export interface UserInfo {
  id: number;
  full_name: string;
  email: string;
  role?: string;
  trader_type?: string;
  is_verified?: boolean;
  picture?: string;
  subscription_tier?: string;
  subscription_status?: string;
  trial_start_date?: string | null;
}

export function getTrialInfo(user: UserInfo | null): { isWithinTrial: boolean; daysRemaining: number; canStartTrial: boolean } {
  if (!user?.trial_start_date) return { isWithinTrial: false, daysRemaining: 0, canStartTrial: true };
  const start = new Date(user.trial_start_date);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return { isWithinTrial: diffDays < 7, daysRemaining: Math.max(0, 7 - diffDays), canStartTrial: false };
}

interface AuthContextType {
  user: UserInfo | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string, ref?: string) => Promise<void>;
  sendOtp: (email: string) => Promise<{ expiresIn: number }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  requestLoginOtp: (email: string, password: string) => Promise<{ expiresIn: number }>;
  verifyLoginOtp: (email: string, code: string) => Promise<void>;
  sendVerificationCode: (email: string) => Promise<{ expiresIn: number }>;
  verifyEmailAndRegister: (fullName: string, email: string, password: string, code: string, ref?: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<{ expiresIn: number }>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  updateUser: (user: UserInfo) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(() => {
    try { return JSON.parse(localStorage.getItem("stockintel_user") || "null"); } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const refreshPromise = useRef<Promise<string | null> | null>(null);

  const doRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.token) {
        tokenRef.current = data.token;
        setToken(data.token);
        if (data.user) {
          setUser(data.user);
          localStorage.setItem("stockintel_user", JSON.stringify(data.user));
        }
        return data.token;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try refresh token cookie first
      const newToken = await doRefresh();
      if (cancelled) return;
      if (newToken) {
        setIsLoading(false);
        return;
      }
      // Fall back to localStorage token (backward compat, will be removed later)
      const storedToken = localStorage.getItem("stockintel_token");
      const storedUser = localStorage.getItem("stockintel_user");
      if (storedToken && storedUser) {
        try {
          const parsed = JSON.parse(storedUser);
          tokenRef.current = storedToken;
          setToken(storedToken);
          setUser(parsed);
          const res = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              setUser(data.user);
              localStorage.setItem("stockintel_user", JSON.stringify(data.user));
            }
          } else {
            // Token invalid, clear
            localStorage.removeItem("stockintel_token");
            setToken(null);
            tokenRef.current = null;
          }
        } catch {
          localStorage.removeItem("stockintel_token");
          setToken(null);
          tokenRef.current = null;
        }
      }
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [doRefresh]);

  const setUserAndStore = (u: UserInfo, t?: string) => {
    setUser(u);
    localStorage.setItem("stockintel_user", JSON.stringify(u));
    if (t) {
      tokenRef.current = t;
      setToken(t);
    }
  };

  // apiFetch with auto-refresh on 401
  const apiFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    const currentToken = tokenRef.current;
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }
    let res = await fetch(`${API_URL}${url}`, { ...options, credentials: 'include', headers });

    // Auto-refresh on 401 TOKEN_EXPIRED
    if (res.status === 401) {
      const body = await res.clone().json().catch(() => ({}));
      if (body.code === 'TOKEN_EXPIRED') {
        if (!refreshPromise.current) {
          refreshPromise.current = doRefresh();
        }
        const newToken = await refreshPromise.current;
        refreshPromise.current = null;
        if (newToken) {
          headers['Authorization'] = `Bearer ${newToken}`;
          res = await fetch(`${API_URL}${url}`, { ...options, credentials: 'include', headers });
        }
      }
    }
    return res;
  }, [doRefresh]);

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setUserAndStore(data.user, data.token);
  };

  const register = async (fullName: string, email: string, password: string, ref?: string) => {
    const body: Record<string, string> = { fullName, email, password };
    if (ref) body.ref = ref;
    const res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    setUserAndStore(data.user, data.token);
  };

  const sendOtp = async (email: string) => {
    const res = await fetch(`${API_URL}/auth/send-otp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send OTP");
    return { expiresIn: data.expiresIn };
  };

  const verifyOtp = async (email: string, code: string) => {
    const res = await fetch(`${API_URL}/auth/verify-otp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "OTP verification failed");
    setUserAndStore(data.user, data.token);
  };

  const requestLoginOtp = async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login-request-otp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send login OTP");
    return { expiresIn: data.expiresIn };
  };

  const verifyLoginOtp = async (email: string, code: string) => {
    const res = await fetch(`${API_URL}/auth/login-verify-otp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "OTP verification failed");
    setUserAndStore(data.user, data.token);
  };

  const sendVerificationCode = async (email: string) => {
    const res = await fetch(`${API_URL}/auth/send-verification-code`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send verification code");
    return { expiresIn: data.expiresIn };
  };

  const verifyEmailAndRegister = async (fullName: string, email: string, password: string, code: string, ref?: string) => {
    const body: Record<string, string> = { fullName, email, password, code };
    if (ref) body.ref = ref;
    const res = await fetch(`${API_URL}/auth/verify-email-and-register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Verification failed");
    setUserAndStore(data.user, data.token);
  };

  const forgotPassword = async (email: string) => {
    const res = await fetch(`${API_URL}/auth/forgot-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send reset code");
    return { expiresIn: data.expiresIn };
  };

  const resetPassword = async (email: string, code: string, newPassword: string) => {
    const res = await fetch(`${API_URL}/auth/reset-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Password reset failed");
  };

  const logout = async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* ignore */ }
    setUser(null);
    setToken(null);
    tokenRef.current = null;
    localStorage.removeItem("stockintel_user");
    localStorage.removeItem("stockintel_token");
    // Clear dismissed trial banner flags so it reappears on next login
    Object.keys(localStorage).filter(k => k.startsWith('trial_banner_dismissed_')).forEach(k => localStorage.removeItem(k));
  };

  const refreshUser = async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        localStorage.setItem("stockintel_user", JSON.stringify(data.user));
      }
    } catch { /* ignore */ }
  };

  const updateUser = (updated: UserInfo) => {
    setUser(updated);
    localStorage.setItem("stockintel_user", JSON.stringify(updated));
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, sendOtp, verifyOtp, requestLoginOtp, verifyLoginOtp, sendVerificationCode, verifyEmailAndRegister, forgotPassword, resetPassword, logout, refreshUser, apiFetch, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
