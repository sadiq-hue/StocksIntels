import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

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

export function getTrialInfo(user: UserInfo | null): { isWithinTrial: boolean; daysRemaining: number } {
  if (!user?.trial_start_date) return { isWithinTrial: false, daysRemaining: 0 };
  const start = new Date(user.trial_start_date);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return { isWithinTrial: diffDays < 7, daysRemaining: Math.max(0, 7 - diffDays) };
}

interface AuthContextType {
  user: UserInfo | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  sendOtp: (email: string) => Promise<{ expiresIn: number }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  requestLoginOtp: (email: string, password: string) => Promise<{ expiresIn: number }>;
  verifyLoginOtp: (email: string, code: string) => Promise<void>;
  sendVerificationCode: (email: string) => Promise<{ expiresIn: number }>;
  verifyEmailAndRegister: (fullName: string, email: string, password: string, code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<{ expiresIn: number }>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("stockintel_token");
    const storedUser = localStorage.getItem("stockintel_user");
    if (storedToken && storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsed);
        // Validate token by fetching /auth/me
        fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        })
          .then(r => r.ok ? r.json() : Promise.reject('Not found'))
          .then(data => {
            if (data.user) {
              setUser(data.user);
              localStorage.setItem("stockintel_user", JSON.stringify(data.user));
            }
          })
          .catch(() => {
            localStorage.removeItem("stockintel_user");
            localStorage.removeItem("stockintel_token");
            setUser(null);
            setToken(null);
          })
          .finally(() => setIsLoading(false));
      } catch {
        localStorage.removeItem("stockintel_user");
        localStorage.removeItem("stockintel_token");
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const setUserAndStore = (u: UserInfo, t?: string) => {
    setUser(u);
    localStorage.setItem("stockintel_user", JSON.stringify(u));
    if (t) {
      setToken(t);
      localStorage.setItem("stockintel_token", t);
    }
  };

  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_URL}${url}`, { ...options, headers });
  };

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setUserAndStore(data.user, data.token);
  };

  const register = async (fullName: string, email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, password }),
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

  const verifyEmailAndRegister = async (fullName: string, email: string, password: string, code: string) => {
    const res = await fetch(`${API_URL}/auth/verify-email-and-register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, password, code }),
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

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("stockintel_user");
    localStorage.removeItem("stockintel_token");
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
        localStorage.setItem("stockintel_user", JSON.stringify(data.user));
      }
    } catch {
      // silently ignore refresh errors
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, sendOtp, verifyOtp, requestLoginOtp, verifyLoginOtp, sendVerificationCode, verifyEmailAndRegister, forgotPassword, resetPassword, logout, refreshUser, apiFetch }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
