import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface BeginnerModeContextValue {
  beginnerMode: boolean;
  toggleBeginnerMode: () => void;
}

const BeginnerModeContext = createContext<BeginnerModeContextValue | null>(null);

export function BeginnerModeProvider({ children }: { children: ReactNode }) {
  const [beginnerMode, setBeginnerMode] = useState(() => {
    return localStorage.getItem("beginnerMode") === "true";
  });

  const toggleBeginnerMode = useCallback(() => {
    setBeginnerMode(prev => {
      const next = !prev;
      localStorage.setItem("beginnerMode", String(next));
      return next;
    });
  }, []);

  return (
    <BeginnerModeContext.Provider value={{ beginnerMode, toggleBeginnerMode }}>
      {children}
    </BeginnerModeContext.Provider>
  );
}

export function useBeginnerMode() {
  const ctx = useContext(BeginnerModeContext);
  if (!ctx) throw new Error("useBeginnerMode must be used within BeginnerModeProvider");
  return ctx;
}
