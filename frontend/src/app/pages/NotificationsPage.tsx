import { useState } from "react";
import { useNavigate } from "react-router";
import { Bell, Check, ArrowUp, ArrowDown, Loader2, X, ExternalLink, Clock } from "lucide-react";
import { useNotifications, type Notification } from "../contexts/NotificationContext";
import { formatNotificationTime } from "../utils/timeFormat";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

export function NotificationsPage() {
  const { notifications, unread, loading, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Notification | null>(null);

  const handleNotificationClick = (n: Notification) => {
    if (!n.read) markRead(n.id);
    setSelected(n);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-[#0D7490]" />
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Notifications</h1>
          {unread > 0 && (
            <span className="bg-[#0D7490] text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {unread} new
            </span>
          )}
        </div>
        {unread > 0 && (
          <button onClick={markAllRead} className="text-sm text-[#0D7490] hover:underline font-medium">
            Mark all read
          </button>
        )}
      </div>

      {loading && notifications.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-20">
          <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No notifications yet</p>
          <p className="text-muted-foreground text-xs mt-1">Signal alerts will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const isSignal = n.type === "signal";
            const isMessage = n.type === "message";
            const isBullish = n.title?.includes("Buy");
            const isBearish = n.title?.includes("Sell");
            return (
              <div
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`bg-card border rounded-lg p-4 transition-colors cursor-pointer hover:shadow-sm ${
                  !n.read ? "border-[#0D7490]/30 bg-blue-50/20" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {isSignal && (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
                          isBullish ? "bg-green-100 text-green-800" : isBearish ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground"
                        }`}>
                          {isBullish ? <ArrowUp className="w-3 h-3" /> : isBearish ? <ArrowDown className="w-3 h-3" /> : null}
                          Signal
                        </span>
                      )}
                      {isMessage && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                          Message
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{formatNotificationTime(n.created_at)}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  </div>
                  {!n.read && (
                    <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} className="p-1.5 hover:bg-muted rounded shrink-0">
                      <Check className="w-4 h-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Notification Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) setSelected(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-[#0D7490]" />
              Notification Details
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {selected.type === "signal" && (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
                    selected.title?.includes("Buy") ? "bg-green-100 text-green-800" :
                    selected.title?.includes("Sell") ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground"
                  }`}>
                    {selected.title?.includes("Buy") ? <ArrowUp className="w-3 h-3" /> :
                     selected.title?.includes("Sell") ? <ArrowDown className="w-3 h-3" /> : null}
                    Signal
                  </span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                  selected.read ? "bg-muted text-muted-foreground" : "bg-blue-100 text-blue-700"
                }`}>
                  {selected.read ? "Read" : "Unread"}
                </span>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-foreground">{selected.title}</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{selected.body}</p>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatDate(selected.created_at)}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                {selected.link && (
                  <button
                    onClick={() => { navigate(selected.link!); setSelected(null); }}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#0D7490] text-white rounded-lg text-sm font-medium hover:bg-[#0A5F7A] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {selected.type === "message" ? "Open Chat" : "View Related Stock"}
                  </button>
                )}
                {!selected.read && (
                  <button
                    onClick={() => { markRead(selected.id); setSelected(null); }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Mark as Read
                  </button>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="ml-auto px-4 py-2 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
