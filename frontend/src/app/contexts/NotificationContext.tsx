import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { getSocket } from "../services/socketService";
import { useAuth } from "../auth/AuthContext";
import { formatNotificationTime } from "../utils/timeFormat";
import { authFetch } from "../auth/tokenStore";
const API_URL = import.meta.env.VITE_API_URL || "/api";

export interface Notification {
  id: number;
  user_id: number;
  title: string;
  body: string;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
}

export interface NotificationPrefs {
  priceAlerts: boolean;
  tradingSignals: boolean;
  marketNews: boolean;
  portfolioUpdates: boolean;
  chatMessages: boolean;
}

// Read the user's notification preferences (set on the Settings page).
// Mapping: signal -> tradingSignals, message -> chatMessages, news ->
// marketNews, portfolio -> portfolioUpdates, price alert -> priceAlerts.
// nse_report is admin-operational (detector approve/manual-upload alerts) and is
// always filtered out of the user bell; info/unknown types always show.
export function getNotificationPrefs(): NotificationPrefs {
  try {
    const saved = localStorage.getItem("notificationSettings");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { priceAlerts: true, tradingSignals: true, marketNews: true, portfolioUpdates: true, chatMessages: false };
}

export function shouldShowNotification(n: { type: string }): boolean {
  const prefs = getNotificationPrefs();
  switch (n.type) {
    case "signal": return prefs.tradingSignals;
    case "message": return prefs.chatMessages;
    case "news": return prefs.marketNews;
    case "portfolio": return prefs.portfolioUpdates;
    case "price_alert": return prefs.priceAlerts;
    case "nse_report": return false; // admin-use-only; hidden from user bell
    default: return true; // info, unknown types always show
  }
}

interface NotificationContextValue {
  notifications: Notification[];
  unread: number;
  loading: boolean;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/notifications?userId=${user.id}`);
      // Failed/transient response (401, 5xx, or the API restarting during a
      // deploy): keep the last-loaded notifications instead of wiping the bell
      // to empty and resetting the unread badge to 0.
      if (!res.ok) return;
      const data = await res.json();
      // Error-shaped payload (e.g. { error: ... }) has no notifications array —
      // don't treat it as a real "you have no notifications" response.
      if (!Array.isArray(data?.notifications)) return;
      setNotifications(data.notifications.filter(shouldShowNotification));
      if (typeof data.unread === "number") setUnread(data.unread);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Refetch when the tab regains focus so the list stays fresh even if
  // real-time delivery is interrupted (sleep, background tab, etc.).
  useEffect(() => {
    const onFocus = () => fetchNotifications();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    // Must join the user:<id> room to receive notification events. Re-emit
    // on every connect so a reconnect that fires while the provider is already
    // mounted still lands in the right room (the race that broke real-time).
    const identify = () => socket.emit("identify_user", user.id);
    identify();
    socket.on("connect", identify);

    const handler = (notification: Notification) => {
      if (!shouldShowNotification(notification)) return; // respects Settings toggles
      setNotifications(prev => {
        if (prev.some(n => n.id === notification.id)) return prev; // dedup
        return [notification, ...prev].slice(0, 200);
      });
      if (!notification.read) {
        setUnread(prev => prev + 1);
      }
      const isSignal = notification.type === "signal";
      const isMessage = notification.type === "message";
      if (isSignal || isMessage) {
        toast(isMessage ? `💬 ${notification.title}` : notification.title, {
          description: `${notification.body} — ${formatNotificationTime(notification.created_at)}`,
          action: notification.link ? {
            label: "View",
            onClick: () => { window.location.href = notification.link!; },
          } : undefined,
        });
      }
    };

    socket.on("notification", handler);
    return () => {
      socket.off("notification", handler);
      socket.off("connect", identify);
    };
  }, [user?.id]);

  const markRead = useCallback(async (id: number) => {
    try {
      await authFetch(`${API_URL}/notifications/${id}/read`, { method: "POST" });
      setNotifications(prev => {
        const n = prev.find(x => x.id === id);
        if (n && !n.read) setUnread(p => Math.max(0, p - 1));
        return prev.map(x => x.id === id ? { ...x, read: true } : x);
      });
    } catch { /* silent */ }
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user?.id) return;
    try {
      await authFetch(`${API_URL}/notifications/read-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* silent */ }
  }, [user?.id]);

  return (
    <NotificationContext.Provider value={{ notifications, unread, loading, markRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
