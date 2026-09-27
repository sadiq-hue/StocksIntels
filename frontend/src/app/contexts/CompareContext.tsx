import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

const STORAGE_KEY = "stockintel_compare";
export const COMPARE_MAX = 5;

const norm = (raw: string) => String(raw || "").toUpperCase().replace(/^NSE:/, "").trim();

interface CompareContextValue {
  list: string[];
  add: (t: string) => void;
  remove: (t: string) => void;
  toggle: (t: string) => void;
  clear: () => void;
  has: (t: string) => boolean;
  isFull: boolean;
}

const CompareContext = createContext<CompareContextValue | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(norm).filter(Boolean).slice(0, COMPARE_MAX) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }, [list]);

  const add = useCallback((raw: string) => {
    const t = norm(raw);
    if (!t) return;
    setList((prev) => (prev.includes(t) || prev.length >= COMPARE_MAX ? prev : [...prev, t]));
  }, []);
  const remove = useCallback((raw: string) => {
    const t = norm(raw);
    setList((prev) => prev.filter((x) => x !== t));
  }, []);
  const toggle = useCallback((raw: string) => {
    const t = norm(raw);
    if (!t) return;
    setList((prev) => prev.includes(t)
      ? prev.filter((x) => x !== t)
      : (prev.length >= COMPARE_MAX ? prev : [...prev, t]));
  }, []);
  const clear = useCallback(() => setList([]), []);
  const has = useCallback((raw: string) => list.includes(norm(raw)), [list]);

  return (
    <CompareContext.Provider value={{ list, add, remove, toggle, clear, has, isFull: list.length >= COMPARE_MAX }}>
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare(): CompareContextValue {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used within a CompareProvider");
  return ctx;
}
