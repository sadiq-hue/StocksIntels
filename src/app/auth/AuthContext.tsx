import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface UserInfo {
  name: string;
  email: string;
  picture?: string;
}

interface AuthContextType {
  user: UserInfo | null;
  setUser: (user: UserInfo | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
