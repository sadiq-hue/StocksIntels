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
}

interface AuthContextType {
  user: UserInfo | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  sendOtp: (email: string) => Promise<{ expiresIn: number }>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<{ expiresIn: number }>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("stockintel_user");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
        fetch(`${API_URL}/auth/me?userId=${parsed.id}`)
          .then(r => r.ok ? r.json() : Promise.reject('Not found'))
          .then(data => {
            if (data.user) {
              setUser(data.user);
              localStorage.setItem("stockintel_user", JSON.stringify(data.user));
            }
          })
          .catch(() => {})
          .finally(() => setIsLoading(false));
      } catch {
        localStorage.removeItem("stockintel_user");
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  }, []);

  const setUserAndStore = (u: UserInfo) => {
    setUser(u);
    localStorage.setItem("stockintel_user", JSON.stringify(u));
  };

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setUserAndStore(data.user);
  };

  const register = async (fullName: string, email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    setUserAndStore(data.user);
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
    setUserAndStore(data.user);
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
    localStorage.removeItem("stockintel_user");
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, sendOtp, verifyOtp, forgotPassword, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
