import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { getSocket } from "../services/socketService";
import { useAuth } from "../auth/AuthContext";
import { formatNotificationTime } from "../utils/timeFormat";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

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
      const res = await fetch(`${API_URL}/notifications?userId=${user.id}`);
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnread(data.unread || 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const handler = (notification: Notification) => {
      setNotifications(prev => [notification, ...prev]);
      if (!notification.read) {
        setUnread(prev => prev + 1);
      }
      const isSignal = notification.type === "signal";
      const isStrong = notification.title?.includes("Strong Buy") || notification.title?.includes("Strong Sell");
      if (isSignal) {
        toast(notification.title, {
          description: `${notification.body} — ${formatNotificationTime(notification.created_at)}`,
          action: notification.link ? {
            label: "View",
            onClick: () => window.location.href = notification.link!,
          } : undefined,
        });
      }
    };

    socket.on("notification", handler);
    return () => { socket.off("notification", handler); };
  }, [user?.id]);

  const markRead = useCallback(async (id: number) => {
    try {
      await fetch(`${API_URL}/notifications/${id}/read`, { method: "POST" });
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
      await fetch(`${API_URL}/notifications/read-all`, {
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
