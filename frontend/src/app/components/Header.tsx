import { Bell, User, Activity, Settings, LogOut, UserCircle, Check, ArrowUp, ArrowDown, Clock, Sun, Moon, Menu } from "lucide-react";
import { StockSearchBar } from "./StockSearchBar";
import { Link, useNavigate } from "react-router";
import { useState, useRef, useEffect } from "react";
import { useTheme } from "next-themes";
import { useAuth, getTrialInfo } from "../auth/AuthContext";
import { disconnectSocket } from "../services/socketService";
import { useNotifications } from "../contexts/NotificationContext";
import { formatNotificationTime } from "../utils/timeFormat";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { SidebarContent } from "./SidebarContent";

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

const API_URL = import.meta.env.VITE_API_URL || "/api";

function TrialBanner() {
  const { user } = useAuth();
  if (!user) return null;
  const hasPaid = user.subscription_status === 'active' && user.subscription_tier !== 'free' && user.subscription_tier !== null && user.subscription_tier !== undefined;
  if (hasPaid) return null;
  const trialInfo = getTrialInfo(user);
  if (!trialInfo.isWithinTrial) return null;

  const colorClass = trialInfo.daysRemaining <= 2 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-amber-50 border-amber-200 text-amber-700';

  return (
    <Link to="/pricing" className={`block w-full text-center text-xs font-semibold px-4 py-2 border-b ${colorClass} hover:opacity-90 transition-opacity`}>
      <Clock className="w-3 h-3 inline-block mr-1 -mt-0.5" />
      Free trial ends in <span className="underline font-bold">{trialInfo.daysRemaining} day{trialInfo.daysRemaining !== 1 ? 's' : ''}</span> — Subscribe to continue
    </Link>
  );
}

export function Header() {
  const [marketStatus, setMarketStatus] = useState<{ nse: { open: boolean; label: string; closeTime: string; eventLabel: string }; global: { open: boolean; label: string; closeTime: string; eventLabel: string } } | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const fetchStatus = () => {
      fetch(`${API_URL}/market/status`)
        .then((r) => r.json())
        .then(setMarketStatus)
        .catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <TrialBanner />
      <header className="sticky top-0 z-30 bg-background border-b border-border px-4 md:px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <button className="md:hidden p-2 hover:bg-muted rounded-lg transition-colors">
                  <Menu className="w-5 h-5 text-foreground" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 bg-sidebar">
                <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
              </SheetContent>
            </Sheet>
            {marketStatus && (
              <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                marketStatus.nse.open
                  ? "bg-green-50 border-green-200"
                  : "bg-muted border-border"
              }`}>
                <Activity className={`w-3.5 h-3.5 ${marketStatus.nse.open ? "text-green-600" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${marketStatus.nse.open ? "text-green-700" : "text-muted-foreground"}`}>
                  NSE {marketStatus.nse.label}
                </span>
              </div>
            )}
          </div>
          <ProfileDropdown marketStatus={marketStatus} />
        </div>
      </header>
    </>
  );
}

function ProfileDropdown({ marketStatus }: { marketStatus: { nse: { open: boolean; label: string; closeTime: string; eventLabel: string }; global: { open: boolean; label: string; closeTime: string; eventLabel: string } } | null }) {
  const { user, logout } = useAuth();
  const { notifications, unread, markRead, markAllRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate("/login");
  };

  return (
    <div className="flex items-center justify-between gap-4 w-full">
      <div className="flex items-center gap-4 flex-1 max-w-xl">
        <div className="flex items-center gap-4 flex-1 max-w-xl">
          <StockSearchBar />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {(marketStatus?.nse.open || marketStatus?.global?.open) ? (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg border border-green-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-green-700 text-sm font-medium">Markets Live</span>
          </div>
        ) : marketStatus ? (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg border border-border">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-sm font-medium">Markets Closed</span>
          </div>
        ) : null}

        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="w-5 h-5 text-muted-foreground" /> : <Moon className="w-5 h-5 text-muted-foreground" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-2 hover:bg-muted rounded-lg transition-colors">
            <Bell className="w-5 h-5 text-muted-foreground" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#0D7490] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-[#0D7490] hover:underline font-medium">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">No notifications yet</div>
                ) : (
                    notifications.slice(0, 20).map((n: any) => {
                    const isBullish = n.type === "signal" && (n.title?.includes("Buy") || n.title?.includes("Strong Buy"));
                    const isBearish = n.type === "signal" && (n.title?.includes("Sell") || n.title?.includes("Strong Sell"));
                    const handleClick = () => {
                      if (!n.read) markRead(n.id);
                      if (n.link) navigate(n.link);
                      setShowNotifications(false);
                    };
                    return (
                      <div key={n.id} onClick={handleClick} className={`px-4 py-3 border-b border-border hover:bg-accent transition-colors cursor-pointer ${!n.read ? 'bg-blue-50/30' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {n.type === "signal" && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                  isBullish ? "bg-green-100 text-green-800" : isBearish ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground"
                                }`}>
                                  {isBullish ? <ArrowUp className="w-2.5 h-2.5" /> : isBearish ? <ArrowDown className="w-2.5 h-2.5" /> : null}
                                  Signal
                                </span>
                              )}
                              <p className="text-xs font-medium text-foreground truncate">{n.title}</p>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{formatNotificationTime(n.created_at)}</p>
                          </div>
                          {!n.read && (
                            <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} className="p-1 hover:bg-accent rounded shrink-0">
                              <Check className="w-3 h-3 text-muted-foreground" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {notifications.length > 0 && (
                <Link to="/app/notifications" onClick={() => setShowNotifications(false)} className="block px-4 py-2.5 text-center text-xs text-[#0D7490] font-medium hover:bg-accent border-t border-border">
                  View all notifications
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative" ref={dropdownRef}>
          <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 p-1.5 hover:bg-muted rounded-lg transition-colors">
            <div className="w-7 h-7 bg-[#0D7490] rounded-full flex items-center justify-center">
              {user?.full_name ? (
                <span className="text-white text-xs font-bold">{getInitials(user.full_name)}</span>
              ) : (
                <User className="w-4 h-4 text-white" />
              )}
            </div>
            {user?.full_name && (
              <span className="text-sm text-foreground font-medium hidden md:block max-w-[120px] truncate">{user.full_name}</span>
            )}
          </button>

          {isOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg py-1 z-50">
              <div className="px-4 py-2 border-b border-border">
                <p className="text-sm font-medium text-foreground truncate">{user?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
              </div>
              <Link to="/app/settings?section=profile" className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted" onClick={() => setIsOpen(false)}>
                <UserCircle className="w-4 h-4" /> My Profile
              </Link>
              <Link to="/app/settings" className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted" onClick={() => setIsOpen(false)}>
                <Settings className="w-4 h-4" /> Settings
              </Link>
              <div className="border-t border-border my-1" />
              <button onClick={handleLogout} className="flex items-center gap-2 w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
