import { Bell, Search, User, Activity, Settings, LogOut, UserCircle, Check, ArrowUp, ArrowDown } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useState, useRef, useEffect } from "react";
import { Input } from "./ui/input";
import { useAuth } from "../auth/AuthContext";
import { disconnectSocket } from "../services/socketService";
import { useNotifications } from "../contexts/NotificationContext";
import { formatNotificationTime } from "../utils/timeFormat";

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 md:px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        <ProfileDropdown />
      </div>
    </header>
  );
}

function ProfileDropdown() {
  const { user, logout } = useAuth();
  const { notifications, unread, markRead, markAllRead } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search Kenyan or global stocks..."
              className="pl-10 bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 h-9"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg border border-green-200">
          <Activity className="w-3.5 h-3.5 text-green-600" />
          <span className="text-green-700 text-sm font-medium">Markets Live</span>
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Bell className="w-5 h-5 text-gray-600" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#0D7490] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs text-[#0D7490] hover:underline font-medium">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-400 text-sm">No notifications yet</div>
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
                      <div key={n.id} onClick={handleClick} className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${!n.read ? 'bg-blue-50/30' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {n.type === "signal" && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                  isBullish ? "bg-green-100 text-green-800" : isBearish ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"
                                }`}>
                                  {isBullish ? <ArrowUp className="w-2.5 h-2.5" /> : isBearish ? <ArrowDown className="w-2.5 h-2.5" /> : null}
                                  Signal
                                </span>
                              )}
                              <p className="text-xs font-medium text-gray-900 truncate">{n.title}</p>
                            </div>
                            <p className="text-xs text-gray-500 line-clamp-2">{n.body}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{formatNotificationTime(n.created_at)}</p>
                          </div>
                          {!n.read && (
                            <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} className="p-1 hover:bg-gray-200 rounded shrink-0">
                              <Check className="w-3 h-3 text-gray-400" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {notifications.length > 0 && (
                <Link to="/app/notifications" onClick={() => setShowNotifications(false)} className="block px-4 py-2.5 text-center text-xs text-[#0D7490] font-medium hover:bg-gray-50 border-t border-gray-100">
                  View all notifications
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative" ref={dropdownRef}>
          <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <div className="w-7 h-7 bg-[#0D7490] rounded-full flex items-center justify-center">
              {user?.full_name ? (
                <span className="text-white text-xs font-bold">{getInitials(user.full_name)}</span>
              ) : (
                <User className="w-4 h-4 text-white" />
              )}
            </div>
            {user?.full_name && (
              <span className="text-sm text-gray-700 font-medium hidden md:block max-w-[120px] truncate">{user.full_name}</span>
            )}
          </button>

          {isOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.full_name || 'User'}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email || ''}</p>
              </div>
              <Link to="/app/settings?section=profile" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setIsOpen(false)}>
                <UserCircle className="w-4 h-4" /> My Profile
              </Link>
              <Link to="/app/settings" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setIsOpen(false)}>
                <Settings className="w-4 h-4" /> Settings
              </Link>
              <div className="border-t border-gray-100 my-1" />
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
