import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Send, Users, Hash, TrendingUp, TrendingDown, Sparkles, MoreVertical, Search, Plus, MessageSquare, Bot, Circle, ArrowLeft, Crown, Trash2, Activity, Newspaper, BarChart3, ArrowUpRight, ArrowDownRight, Globe, Flame, Paperclip, X, Image, FileText } from "lucide-react";
import { Badge } from "../components/ui/badge";
import {
  getSocket, connectSocket, disconnectSocket, joinGroup, leaveGroup,
  joinPrivate, sendMessage, emitTyping, emitStopTyping,
} from "../services/socketService";
import { useAuth } from "../auth/AuthContext";
import { useNavigate, useSearchParams, Link } from "react-router";
import { formatLastSeen, formatMessageTime } from "../utils/timeFormat";
import { quickFinancialSymbols } from "../data/stockUniverses";

const GROUP_ICONS: Record<string, string> = {
  "nse-traders": "📊",
  "safaricom": "📱",
  "banking": "🏦",
  "tech-picks": "💻",
  "dividend-hunters": "💰",
  "day-traders": "⚡",
};

const API_URL = import.meta.env.VITE_API_URL || "/api";
const BACKEND_URL = API_URL.replace(/\/api$/, '');

interface Message {
  id: number;
  sender_id?: number;
  sender_name: string;
  content: string;
  message_type: "user" | "system" | "ai";
  group_id?: string;
  recipient_id?: number;
  image_url?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  edited_at?: string | null;
  created_at: string;
}

interface GroupData {
  id: string;
  name: string;
  description: string;
  icon: string;
  topic: string;
  members: number;
  message_count: number;
  activity_last_hour: number;
  trending: boolean;
  isJoined: boolean;
  isAdmin?: boolean;
  online_members: number;
}

interface GroupMember {
  id: number;
  full_name: string;
  email: string;
  role: string;
  trader_type: string;
  is_verified: boolean;
  online: boolean;
  joined_at: string;
}

interface PeerData {
  id: number;
  full_name: string;
  role: string;
  trader_type: string;
  is_verified: boolean;
  online: boolean;
  last_seen: string | null;
  followers: number;
}

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDateSeparator(ts: string): string {
  const now = new Date();
  const date = new Date(ts);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isNewDay(prev: string, current: string): boolean {
  if (!prev) return true;
  const d1 = new Date(prev);
  const d2 = new Date(current);
  return d1.getDate() !== d2.getDate() || d1.getMonth() !== d2.getMonth() || d1.getFullYear() !== d2.getFullYear();
}

export function ChatPage() {
  const { user, isLoading: authLoading, apiFetch } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [messageText, setMessageText] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedPeer, setSelectedPeer] = useState<number | null>(null);
  const [chatMode, setChatMode] = useState<"group" | "people">("group");
  const [searchQuery, setSearchQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [typingUser, setTypingUser] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const [groups, setGroups] = useState<GroupData[]>([]);
  const [peers, setPeers] = useState<PeerData[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [mentionsSignals, setMentionsSignals] = useState<any[]>([]);
  const [groupView, setGroupView] = useState<"list" | "detail" | "chat">("list");
  const [marketIndices, setMarketIndices] = useState<any[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [marketNews, setMarketNews] = useState<any[]>([]);
  const [marketMovers, setMarketMovers] = useState<any[]>([]);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(true);

  const socket = getSocket();

  const topMentions = useMemo(() => {
    const nseTickers = new Set(quickFinancialSymbols.filter(q => q.market === 'nse').map(q => q.symbol));
    const globalTickers = new Set(quickFinancialSymbols.filter(q => q.market === 'global').map(q => q.symbol));

    // 1) Prefer active AI buy signals
    const buySignals = mentionsSignals.filter((s: any) => {
      const sig = s.signal?.toLowerCase() || '';
      return sig.includes('buy') || sig.includes('strong buy');
    }).sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));

    if (buySignals.length > 0) {
      const nse = buySignals.filter((s: any) => nseTickers.has(s.ticker)).slice(0, 3);
      const nseTickersUsed = new Set(nse.map((s: any) => s.ticker));
      const global = buySignals.filter((s: any) => globalTickers.has(s.ticker) && !nseTickersUsed.has(s.ticker)).slice(0, 3);
      return [...nse, ...global].slice(0, 6);
    }

    // 2) Fall back to any notable non-Hold AI signal
    const notableSignals = mentionsSignals
      .filter((s: any) => {
        const sig = s.signal?.toLowerCase() || '';
        return sig !== 'hold' && sig !== '';
      })
      .sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));

    if (notableSignals.length > 0) {
      const nse = notableSignals.filter((s: any) => nseTickers.has(s.ticker)).slice(0, 3);
      const nseTickersUsed = new Set(nse.map((s: any) => s.ticker));
      const global = notableSignals.filter((s: any) => globalTickers.has(s.ticker) && !nseTickersUsed.has(s.ticker)).slice(0, 3);
      return [...nse, ...global].slice(0, 6);
    }

    // 3) Last resort: live market gainers so the panel is never empty when data exists
    const movers = marketMovers
      .filter((s: any) => (s.changePercent || 0) > 0 || s.isPositive)
      .sort((a: any, b: any) => (b.changePercent || 0) - (a.changePercent || 0));

    if (movers.length > 0) {
      const nse = movers.filter((s: any) => nseTickers.has(s.ticker)).slice(0, 3);
      const nseTickersUsed = new Set(nse.map((s: any) => s.ticker));
      const global = movers.filter((s: any) => globalTickers.has(s.ticker) && !nseTickersUsed.has(s.ticker)).slice(0, 3);
      return [...nse, ...global].slice(0, 6);
    }

    return [];
  }, [mentionsSignals, marketMovers]);

  const topMentionsAreMovers = useMemo(() => {
    const hasSignals = mentionsSignals.some((s: any) => {
      const sig = s.signal?.toLowerCase() || '';
      return sig.includes('buy') || sig.includes('strong buy') || (sig !== 'hold' && sig !== '');
    });
    return !hasSignals && marketMovers.length > 0 && topMentions.length > 0;
  }, [mentionsSignals, marketMovers, topMentions]);

  const topGainers = useMemo(() => {
    return mentionsSignals
      .filter((s: any) => (s.change || 0) > 0)
      .sort((a: any, b: any) => (b.change || 0) - (a.change || 0))
      .slice(0, 3);
  }, [mentionsSignals]);

  const topLosers = useMemo(() => {
    return mentionsSignals
      .filter((s: any) => (s.change || 0) < 0)
      .sort((a: any, b: any) => (a.change || 0) - (b.change || 0))
      .slice(0, 3);
  }, [mentionsSignals]);

  const marketSentiment = useMemo(() => {
    const bullish = mentionsSignals.filter((s: any) => {
      const sig = s.signal?.toLowerCase() || '';
      return sig.includes('buy') || sig.includes('strong buy');
    }).length;
    const bearish = mentionsSignals.filter((s: any) => {
      const sig = s.signal?.toLowerCase() || '';
      return sig.includes('sell');
    }).length;
    const total = bullish + bearish;
    if (total === 0) return { bullish: 50, bearish: 50 };
    return {
      bullish: Math.round((bullish / total) * 100),
      bearish: Math.round((bearish / total) * 100)
    };
  }, [mentionsSignals]);

  // ── Fetch groups & people from API ──────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      try {
        const personParam = searchParams.get("person");
        const groupParam = searchParams.get("group");
        const userIdParam = user?.id ? `?userId=${user.id}` : "";
        const [groupsRes, peopleRes] = await Promise.all([
          apiFetch(`/groups${userIdParam}`).then(r => r.json()),
          fetch(`${API_URL}/people`).then(r => r.json()),
        ]);
        setGroups(groupsRes);
        const peers = peopleRes;
        setPeers(peers);

        // Auto-select person from query param
        if (personParam) {
          const peer = peers.find((p: PeerData) => String(p.id) === personParam);
          if (peer) {
            setChatMode("people");
            setSelectedPeer(peer.id);
            setSelectedGroup(null);
          } else {
            setSelectedGroup(groupsRes.length > 0 ? groupsRes[0].id : null);
          }
        } else if (groupParam) {
          const group = groupsRes.find((g: GroupData) => g.id === groupParam);
          if (group) {
            setChatMode("group");
            setSelectedGroup(group.id);
            setSelectedPeer(null);
            setGroupView("detail");
          } else {
            setSelectedGroup(groupsRes.length > 0 ? groupsRes[0].id : null);
          }
        } else if (groupsRes.length > 0 && !selectedGroup) {
          setSelectedGroup(groupsRes[0].id);
        }
      } catch (err) {
        console.error("Failed to load chat data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [searchParams]);

  // ── Fetch signals for stock mentions ───────────────────────────────────
  useEffect(() => {
    const userIdParam = user?.id ? `?userId=${user.id}` : '';
    apiFetch(`/signals${userIdParam}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.signals && Array.isArray(data.signals)) {
          setMentionsSignals(data.signals);
        }
      })
      .catch(err => console.error("Failed to load signals:", err));

    // Fetch market indices
    fetch(`${API_URL}/market/indices`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data)) {
          setMarketIndices(data.slice(0, 4));
        }
      })
      .catch(() => {});

    // Fetch market news
    fetch(`${API_URL}/news?limit=3`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data)) {
          setMarketNews(data.slice(0, 3));
        } else if (data?.news && Array.isArray(data.news)) {
          setMarketNews(data.news.slice(0, 3));
        }
      })
      .catch(() => {});

    // Fetch market movers as a fallback for Stock Mentions
    fetch(`${API_URL}/market/movers`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const combined = data?.combined?.gainers || [];
        const nse = data?.nse?.movers?.gainers || [];
        const global = data?.global?.movers?.gainers || [];
        const all = combined.length > 0 ? combined : [...nse, ...global];
        if (Array.isArray(all) && all.length > 0) {
          setMarketMovers(all.map((m: any) => ({
            ticker: m.ticker || m.symbol,
            symbol: m.symbol || m.ticker,
            name: m.name,
            price: parseFloat(m.price) || 0,
            change: parseFloat(m.changePercent) || parseFloat(m.change) || 0,
            changePercent: parseFloat(m.changePercent) || parseFloat(m.change) || 0,
            isPositive: m.isPositive ?? (parseFloat(m.changePercent) >= 0),
            currency: m.currency,
            volume: m.volume,
            signal: 'Mover',
          })));
        }
      })
      .catch(() => {});
  }, []);

  // ── Socket connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const s = connectSocket(user.id, user.full_name);

    const handleMessage = (msg: Message) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const handleTyping = (data: { userId?: string; userName?: string; groupId?: string }) => {
      if (data.userName && data.userName !== user.full_name) {
        setTypingUser(data.userName);
        setIsTyping(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setIsTyping(false);
          setTypingUser("");
        }, 3000);
      }
    };

    const handleStopTyping = () => {
      setIsTyping(false);
      setTypingUser("");
    };

    s.on("receive_message", handleMessage);
    s.on("typing", handleTyping);
    s.on("stop_typing", handleStopTyping);

    const handleGroupMemberJoined = ({ groupId }: { groupId: string }) => {
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, members: g.members + 1 } : g))
      );
    };

    const handleGroupMemberLeft = ({ groupId }: { groupId: string }) => {
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, members: Math.max(0, g.members - 1) } : g))
      );
    };

    s.on("group_member_joined", handleGroupMemberJoined);
    s.on("group_member_left", handleGroupMemberLeft);

    const handleMessageEdited = (edited: Message) => {
      setMessages((prev) => prev.map((m) => (m.id === edited.id ? { ...m, content: edited.content, edited_at: edited.edited_at } : m)));
    };
    const handleMessageDeleted = ({ id }: { id: number }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    };
    s.on("message_edited", handleMessageEdited);
    s.on("message_deleted", handleMessageDeleted);

    return () => {
      s.off("receive_message", handleMessage);
      s.off("typing", handleTyping);
      s.off("stop_typing", handleStopTyping);
      s.off("group_member_joined", handleGroupMemberJoined);
      s.off("group_member_left", handleGroupMemberLeft);
      s.off("message_edited", handleMessageEdited);
      s.off("message_deleted", handleMessageDeleted);
      disconnectSocket();
    };
  }, [user?.id]);

  // ── Join group/private rooms when selected ─────────────────────────────
  useEffect(() => {
    if (chatMode === "group" && selectedGroup && groupView === "chat") {
      joinGroup(selectedGroup);
      setMessages([]);
      apiFetch(`/groups/${selectedGroup}/messages`)
        .then(r => r.json())
        .then(setMessages)
        .catch(() => {});
    }
  }, [chatMode, selectedGroup, groupView]);

  // ── Fetch group members when viewing detail ────────────────────────────
  useEffect(() => {
    if (chatMode === "group" && selectedGroup && groupView === "detail") {
      apiFetch(`/groups/${selectedGroup}/members`)
        .then(r => r.json())
        .then(setGroupMembers)
        .catch(() => {});
    }
  }, [chatMode, selectedGroup, groupView]);

  useEffect(() => {
    if (chatMode === "people" && selectedPeer && user) {
      joinPrivate(user.id, selectedPeer);
      setMessages([]);
      apiFetch(`/conversations/${user.id}/${selectedPeer}`)
        .then(r => r.json())
        .then(setMessages)
        .catch(() => {});
    }
  }, [chatMode, selectedPeer, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const currentGroup = groups.find(g => g.id === selectedGroup);
  const currentPeer = peers.find(p => p.id === selectedPeer);

  // ── Stock mention detection ────────────────────────────────────────────
  const extractStocks = (msg: string): string[] => {
    const stockRegex = /\b([A-Z]{1,4})\b/g;
    const stocks = msg.match(stockRegex) || [];
    return stocks.filter(s => ["SCOM", "EQTY", "KCB", "NSCB", "EABL"].includes(s));
  };

  // ── Send message ───────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return;
    setUploadingFile(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/upload', { method: 'POST', body: form });
      if (!res.ok) return;
      const data = await res.json();
      const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.name);
      setPendingFile({ url: data.url, name: file.name, type: isImage ? 'image' : 'file' });
    } catch { /* silent */ } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleEditMessage = async (msgId: number) => {
    const text = editText.trim();
    if (!text) return;
    try {
      const res = await apiFetch(`/messages/${msgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) return;
      const edited = await res.json();
      setMessages((prev) => prev.map((m) => (m.id === edited.id ? { ...m, content: edited.content, edited_at: edited.edited_at } : m)));
      setEditingMsgId(null);
      setEditText("");
    } catch { /* silent */ }
  };

  const handleDeleteMessage = async (msgId: number) => {
    if (!window.confirm('Delete this message?')) return;
    try {
      const res = await apiFetch(`/messages/${msgId}`, { method: 'DELETE' });
      if (!res.ok) return;
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch { /* silent */ }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = messageText.trim();
    const file = pendingFile;
    if (!text && !file) return;

    const msgData: any = {
      senderId: user!.id,
      senderName: user!.full_name,
      content: text || '',
      groupId: chatMode === "group" ? selectedGroup || undefined : undefined,
      recipientId: chatMode === "people" ? selectedPeer || undefined : undefined,
    };
    if (file) {
      msgData.imageUrl = file.url;
      msgData.fileName = file.name;
    }

    sendMessage(msgData);

    emitStopTyping({
      userId: user!.id,
      groupId: chatMode === "group" ? selectedGroup || undefined : undefined,
      recipientId: chatMode === "people" ? selectedPeer || undefined : undefined,
    });

    setMessageText("");
    setPendingFile(null);
  };

  // ── Typing indicator ───────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageText(e.target.value);
    emitTyping({
      userId: user!.id,
      userName: user!.full_name,
      groupId: chatMode === "group" ? selectedGroup || undefined : undefined,
      recipientId: chatMode === "people" ? selectedPeer || undefined : undefined,
    });
  };

  const handleGroupSelect = (groupId: string) => {
    if (selectedGroup && selectedGroup !== groupId) {
      leaveGroup(selectedGroup);
    }
    setChatMode("group");
    setSelectedGroup(groupId);
    setSelectedPeer(null);
    setGroupView("detail");
    setShowMobileSidebar(false);
  };

  const handleEnterChat = (groupId: string) => {
    setGroupView("chat");
    joinGroup(groupId);
    setMessages([]);
    apiFetch(`/groups/${groupId}/messages`)
      .then(r => r.json())
      .then(setMessages)
      .catch(() => {});
  };

  const handleJoinGroup = async (groupId: string) => {
    if (!user?.id) return;
    const prev = groups;
    setGroups((cur) => cur.map((g) => (g.id === groupId ? { ...g, isJoined: true } : g)));
    joinGroup(groupId);
    const res = await fetch(`${API_URL}/groups/${groupId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) {
      setGroups(prev);
      leaveGroup(groupId);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    if (!user?.id) return;
    const prev = groups;
    setGroups((cur) => cur.map((g) => (g.id === groupId ? { ...g, isJoined: false } : g)));
    leaveGroup(groupId);
    const res = await fetch(`${API_URL}/groups/${groupId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) {
      setGroups(prev);
      joinGroup(groupId);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!user?.id) return;
    const prev = groups;
    setGroups((cur) => cur.filter((g) => g.id !== groupId));
    setSelectedGroup(null);
    setGroupView("list");
    const res = await fetch(`${API_URL}/admin/groups/${groupId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      setGroups(prev);
    }
  };

  const getLastMessage = (id: string, mode: "group" | "people") => {
    return null;
  };

  const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (authLoading || loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1800px] mx-auto h-[calc(100vh-140px)] flex items-center justify-center">
        <p className="text-muted-foreground">Loading chat...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto h-[calc(100vh-140px)]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-foreground text-xl md:text-2xl mb-1">Chat & Trading Groups</h2>
          <p className="text-muted-foreground">Connected as <strong>{user!.full_name}</strong></p>
        </div>
        <a href="/app/groups" className="flex items-center gap-2 px-4 py-2 bg-[#0D7490] text-white rounded-lg hover:bg-[#0A5F7A] transition-colors">
          <Plus className="w-4 h-4" />
          Browse Groups
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100%-80px)]">
        {/* Left sidebar */}
        <Card className={`lg:col-span-3 bg-card border-border p-4 flex flex-col gap-4 overflow-hidden ${showMobileSidebar ? '' : 'hidden lg:flex'}`}>
          <div>
            <h3 className="text-foreground mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Trading Groups
            </h3>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search groups..."
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-muted border-border" />
            </div>
          </div>

          <div className="space-y-1 overflow-y-auto flex-1 -mx-4 px-4">
            {filteredGroups.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No groups found</div>
                ) : (
                  filteredGroups.map((group) => (
                    <button key={group.id} onClick={() => handleGroupSelect(group.id)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        selectedGroup === group.id ? "bg-[#0D7490] text-white shadow-sm" : "text-foreground hover:bg-accent"
                      }`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
                          selectedGroup === group.id ? "bg-white/20" : "bg-muted"
                        }`}>{GROUP_ICONS[group.id] || group.icon || <Hash className="w-5 h-5" />}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{group.name}</span>
                          </div>
                          <p className={`text-xs truncate ${selectedGroup === group.id ? "text-white/70" : "text-muted-foreground"}`}>
                            {group.members} members · {group.online_members || 0} online · {group.activity_last_hour} msg/hr
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
          </div>
        </Card>

        {/* Main Chat Area */}
        <Card className={`lg:col-span-6 bg-card border-border flex flex-col overflow-hidden ${showMobileSidebar ? 'hidden lg:flex' : ''}`}>
          {/* Chat header */}
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowMobileSidebar(true)}
                className="lg:hidden p-2 -ml-2 hover:bg-accent rounded-lg transition-colors text-muted-foreground"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              {chatMode === "group" && (
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg">
                  {GROUP_ICONS[selectedGroup || ""] || <Hash className="w-5 h-5 text-[#0D7490]" />}
                </div>
              )}
              <div className="min-w-0">
                <h3 className="text-foreground font-semibold truncate">
                  {currentGroup?.name || "Select a group"}
                </h3>
                <p className="text-muted-foreground text-xs truncate">
                  {currentGroup ? `${currentGroup.members} members · ${currentGroup.online_members || 0} online` : ""}
                </p>
              </div>
            </div>
            <button className="p-2 hover:bg-accent rounded-lg transition-colors">
              <MoreVertical className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
            {!selectedGroup ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <MessageSquare className="w-12 h-12 mb-3 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">Select a conversation</p>
                <p className="text-xs mt-1">Choose a group to start chatting</p>
              </div>
            ) : chatMode === "group" && groupView === "detail" && currentGroup ? (
              <div className="h-full overflow-y-auto px-4 py-4">
                {/* Full Group Info Panel in Main Area */}
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <Button variant="outline" size="sm" onClick={() => { setGroupView("list"); setShowMobileSidebar(true); }} className="border-border text-muted-foreground gap-1">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                  {currentGroup.isAdmin && (
                    <Badge className="bg-amber-100 text-amber-700 border-0 gap-1">
                      <Crown className="w-3 h-3" /> Admin
                    </Badge>
                  )}
                  {currentGroup.trending && (
                    <Badge className="bg-gradient-to-r from-red-500 to-orange-500 text-white border-0 gap-1">
                      <Flame className="w-3 h-3" /> Trending
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-4 mb-6">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-3xl border border-border shrink-0">
                    {currentGroup.icon || GROUP_ICONS[currentGroup.id] || '📊'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-foreground">{currentGroup.name}</h2>
                    <p className="text-muted-foreground text-sm mt-1">{currentGroup.description}</p>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">{currentGroup.topic}</Badge>
                      <span className="text-xs text-muted-foreground">{currentGroup.members} members</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Circle className="w-2 h-2 fill-green-500" />{currentGroup.online_members || 0} online
                      </span>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <div className="text-center p-3 bg-muted rounded-xl">
                    <p className="text-xl font-bold text-foreground">{currentGroup.members}</p>
                    <p className="text-[11px] text-muted-foreground">Members</p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-xl">
                    <p className="text-xl font-bold text-green-600 flex items-center justify-center gap-1">
                      <Circle className="w-3 h-3 fill-green-500" />{currentGroup.online_members || 0}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Online</p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-xl">
                    <p className="text-xl font-bold text-foreground">{currentGroup.activity_last_hour}</p>
                    <p className="text-[11px] text-muted-foreground">Active/hr</p>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-xl">
                    <p className="text-xl font-bold text-foreground">{currentGroup.message_count?.toLocaleString() || 0}</p>
                    <p className="text-[11px] text-muted-foreground">Messages</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-3 mb-6">
                  {currentGroup.isJoined ? (
                    <>
                      <Button onClick={() => handleEnterChat(currentGroup.id)} className="flex-1 bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2 h-11">
                        <MessageSquare className="w-4 h-4" /> Open Chat
                      </Button>
                      <Button onClick={() => handleLeaveGroup(currentGroup.id)} variant="outline" className="px-4 h-11 text-red-600 hover:bg-red-50 border-red-200 hover:border-red-300 gap-2">
                        <Trash2 className="w-4 h-4" /> Leave
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => handleJoinGroup(currentGroup.id)} className="flex-1 bg-card hover:bg-[#0D7490] hover:text-white text-[#0D7490] border border-[#0D7490] transition-all h-11 gap-2">
                      <Plus className="w-4 h-4" /> Join Group
                    </Button>
                  )}
                  {currentGroup.isAdmin && (
                    <Button onClick={() => handleDeleteGroup(currentGroup.id)} variant="outline" className="px-4 h-11 text-rose-600 hover:bg-rose-50 border-rose-200 hover:border-rose-300 gap-2">
                      <Trash2 className="w-4 h-4" /> Delete
                    </Button>
                  )}
                </div>

                {/* Members List */}
                <h3 className="text-foreground font-semibold mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#0D7490]" /> Members
                  <span className="text-sm text-muted-foreground font-normal">({groupMembers.length})</span>
                </h3>
                <div className="space-y-2 max-h-[300px] overflow-y-auto mb-4">
                  {groupMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No members yet</p>
                  ) : (
                    groupMembers.map((member: any) => (
                      <div key={member.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent">
                        <Avatar className="w-8 h-8">
                          <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                            {member.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{member.full_name}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {member.online ? (
                              <><Circle className="w-2 h-2 fill-green-500 text-green-500" /> Online</>
                            ) : (
                              <span className="text-muted-foreground">Offline</span>
                            )}
                          </p>
                        </div>
                        {member.role && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-border text-muted-foreground shrink-0">
                            {member.role}
                          </Badge>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <MessageSquare className="w-12 h-12 mb-3 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">No messages yet</p>
                <p className="text-xs mt-1">Send a message to start the conversation!</p>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const showDate = !prevMsg || isNewDay(prevMsg.created_at, msg.created_at);
                  const isOwn = msg.sender_name === user!.full_name;

                  return (
                    <div key={msg.id}>
                      {showDate && (
                        <div className="flex items-center justify-center my-4">
                          <div className="bg-muted text-muted-foreground text-xs px-3 py-1 rounded-full">
                            {formatDateSeparator(msg.created_at)}
                          </div>
                        </div>
                      )}

                      {msg.message_type === "system" ? (
                        <div className="flex justify-center my-2">
                          <div className="bg-muted border border-border rounded-xl px-4 py-2 inline-flex items-center gap-2">
                            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">{msg.content}</p>
                          </div>
                        </div>
                      ) : msg.message_type === "ai" ? (
                        <div className="flex items-start gap-3 my-2">
                          <div className="w-9 h-9 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm mt-1">
                            <Sparkles className="w-4 h-4 text-white" />
                          </div>
                          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] shadow-sm">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-[#0D7490]">AI Assistant</span>
                              <span className="text-muted-foreground text-[11px]">{formatMessageTime(msg.created_at)}</span>
                            </div>
                            <p className="text-sm text-gray-800 leading-relaxed">{msg.content}</p>
                          </div>
                        </div>
                      ) : (
                        <div className={`flex items-start gap-3 my-1 ${isOwn ? "flex-row-reverse" : ""}`}>
                          {!isOwn && (
                            <Avatar className="w-8 h-8 flex-shrink-0 mt-1">
                              <AvatarFallback className="text-xs bg-blue-100 text-blue-700">
                                {getInitials(msg.sender_name)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className={`max-w-[75%] ${isOwn ? "items-end" : ""}`}>
                            {!isOwn && (
                              <p className="text-[11px] text-muted-foreground mb-0.5 px-1">{msg.sender_name}</p>
                            )}
                            {isOwn && editingMsgId === msg.id ? (
                              <div className="flex items-center gap-2">
                                <Input ref={editInputRef} value={editText} onChange={(e) => setEditText(e.target.value)}
                                  className="flex-1 bg-card border-gray-300 text-foreground text-sm" autoFocus
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditMessage(msg.id); if (e.key === 'Escape') { setEditingMsgId(null); setEditText(''); } }} />
                                <Button size="sm" onClick={() => handleEditMessage(msg.id)} className="bg-[#0D7490] text-white h-8 px-3 text-xs">Save</Button>
                                <Button size="sm" variant="outline" onClick={() => { setEditingMsgId(null); setEditText(''); }} className="h-8 px-3 text-xs">Cancel</Button>
                              </div>
                            ) : (
                              <div className="group relative">
                                {isOwn && (
                                  <div className="absolute -top-1 right-0 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-0.5">
                                    <button onClick={() => { setEditingMsgId(msg.id); setEditText(msg.content || ''); setTimeout(() => editInputRef.current?.focus(), 0); }}
                                      className="p-1 bg-card border border-border rounded shadow-sm hover:bg-accent text-muted-foreground text-[10px]">Edit</button>
                                    <button onClick={() => handleDeleteMessage(msg.id)}
                                      className="p-1 bg-card border border-border rounded shadow-sm hover:bg-red-50 text-red-500 text-[10px]">Del</button>
                                  </div>
                                )}
                                <div className={`rounded-2xl px-4 py-2.5 space-y-1 ${
                                  isOwn ? "bg-[#0D7490] text-white rounded-tr-sm" : "bg-muted text-gray-800 rounded-tl-sm"
                                }`}>
                                  {msg.image_url && (
                                    <div className="mb-1">
                                      {(() => {
                                        const fileUrl = msg.image_url!.startsWith('http') ? msg.image_url! : `${BACKEND_URL}${msg.image_url}`;
                                        return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fileUrl) ? (
                                          <img src={fileUrl} alt={msg.file_name || ""}
                                            className="max-w-full sm:max-w-60 max-h-60 rounded-lg cursor-pointer object-cover"
                                            onClick={() => window.open(fileUrl, '_blank')}
                                            loading="lazy" />
                                        ) : (
                                          <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                                            className="flex items-center gap-2 text-sm underline underline-offset-2">
                                            <FileText className="w-4 h-4" />
                                            {msg.file_name || msg.image_url.split('/').pop()}
                                          </a>
                                        );
                                      })()}
                                    </div>
                                  )}
                                  {msg.content && <p className="text-sm leading-relaxed">{msg.content}</p>}
                                  {msg.edited_at && <span className="text-[10px] opacity-60">(edited)</span>}
                                </div>
                                <p className={`text-[10px] text-muted-foreground mt-0.5 px-1 ${isOwn ? "text-right" : ""}`}>
                                  {formatMessageTime(msg.created_at)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {isTyping && typingUser && (
                  <div className="flex items-center gap-3 py-2">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="text-xs bg-muted text-muted-foreground">
                        {getInitials(typingUser)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground mr-1">{typingUser} typing</span>
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-border space-y-2">
            {pendingFile && (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border">
                {pendingFile.type === 'image' ? <Image className="w-4 h-4 text-muted-foreground" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground truncate flex-1">{pendingFile.name}</span>
                <button type="button" onClick={() => setPendingFile(null)} className="p-1 hover:bg-accent rounded">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.doc,.docx,.xlsx,.csv,.txt,.mp4,.mov,.avi" onChange={handleFileSelect} className="hidden" />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile}
                className="p-2 text-muted-foreground hover:text-muted-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50">
                <Paperclip className="w-4 h-4" />
              </button>
              <Input value={messageText} onChange={handleInputChange}
                placeholder="Type a message or mention a stock ticker (e.g. SCOM)..."
                className="flex-1 bg-muted border-border text-foreground focus-visible:ring-[#0D7490]" />
              <Button type="submit" disabled={(!messageText.trim() && !pendingFile) || uploadingFile}
                className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-5 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl">
                {uploadingFile ? <span className="animate-spin">⏳</span> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </form>
        </Card>

        {/* Right sidebar */}
        <Card className="lg:col-span-3 bg-card border-border p-4 overflow-y-auto hidden lg:block">
          {currentGroup ? (
            <>
              {/* Stock Mentions */}
              <div className="mb-4">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center shadow-sm">
                    <TrendingUp className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-foreground font-bold text-sm">Stock Mentions</h3>
                  {topMentionsAreMovers && (
                    <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      Live Movers
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-auto">
                    {topMentions.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {topMentions.length === 0 ? (
                    <div className="p-4 bg-muted rounded-xl border border-border text-center">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center mx-auto mb-2">
                        <TrendingUp className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground font-medium">No stock data available</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Check back during market hours</p>
                    </div>
                  ) : (
                    topMentions.map((s: any) => {
                      const isNse = quickFinancialSymbols.find(q => q.symbol === s.ticker && q.market === 'nse');
                      const currency = isNse ? 'KES' : '$';
                      const isPositive = (s.change || 0) >= 0;
                      const sigLower = s.signal?.toLowerCase() || '';
                      const isStrongBuy = sigLower.includes('strong buy');
                      const isBuy = sigLower.includes('buy');
                      return (
                        <Link
                          key={s.ticker}
                          to={`/app/stock/${s.ticker}`}
                          className="group block p-3 rounded-xl border border-border hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer bg-card relative overflow-hidden"
                        >
                          {/* Left accent bar */}
                          <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${
                            isPositive ? 'bg-emerald-500' : 'bg-red-500'
                          }`} />
                          
                          <div className="flex items-center justify-between pl-2">
                            <div className="flex items-center gap-3">
                              {/* Ticker icon in gradient circle */}
                              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shadow-sm ${
                                isPositive 
                                  ? 'bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-700 border border-emerald-200' 
                                  : 'bg-gradient-to-br from-red-50 to-red-100 text-red-700 border border-red-200'
                              }`}>
                                {s.ticker?.slice(0, 2)}
                              </div>
                              <div>
                                <span className="text-foreground font-bold text-sm block leading-tight">{s.ticker}</span>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  {currency} <span className="text-muted-foreground font-semibold">{s.price?.toFixed(2) || '0.00'}</span>
                                </span>
                              </div>
                            </div>
                            
                            {/* Signal badge */}
                            <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${
                              isStrongBuy 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                : isBuy 
                                  ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                                  : 'bg-muted text-muted-foreground border-border'
                            }`}>
                              {isStrongBuy && <span className="mr-0.5">★</span>}
                              {s.signal || 'Hold'}
                            </div>
                          </div>
                          
                          {/* Bottom row with change */}
                          <div className="flex items-center justify-between pl-2 mt-2">
                            <div className="flex items-center gap-1.5">
                              {isPositive ? (
                                <TrendingUp className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <TrendingDown className="w-3 h-3 text-red-500" />
                              )}
                              <span className={`text-xs font-bold ${
                                isPositive ? 'text-emerald-600' : 'text-red-600'
                              }`}>
                                {isPositive ? '+' : ''}{s.change?.toFixed(2) || '0.00'}%
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground group-hover:text-[#0D7490] transition-colors">
                              View →
                            </span>
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Market Overview */}
              <div className="border-t border-border pt-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                    <Globe className="w-3 h-3 text-white" />
                  </div>
                  <h3 className="text-foreground font-bold text-xs">Market Overview</h3>
                </div>
                <div className="space-y-2">
                  {marketIndices.length === 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-muted rounded-lg text-center">
                        <p className="text-[10px] text-muted-foreground">NSE 20</p>
                        <p className="text-xs font-bold text-muted-foreground">--</p>
                      </div>
                      <div className="p-2 bg-muted rounded-lg text-center">
                        <p className="text-[10px] text-muted-foreground">S&P 500</p>
                        <p className="text-xs font-bold text-muted-foreground">--</p>
                      </div>
                    </div>
                  ) : (
                    marketIndices.map((idx: any) => (
                      <div key={idx.name} className="flex items-center justify-between p-2 bg-muted rounded-lg hover:bg-accent transition-colors">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-3 h-3 text-muted-foreground" />
                          <div>
                            <span className="text-[10px] font-medium text-muted-foreground block">{idx.name}</span>
                            <span className="text-[9px] text-muted-foreground">{idx.market || 'Market'}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-bold text-foreground block">{idx.value}</span>
                          <span className={`text-[9px] font-medium ${idx.isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                            {idx.change || '0.00%'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Market Sentiment */}
              <div className="border-t border-border pt-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
                    <Activity className="w-3 h-3 text-white" />
                  </div>
                  <h3 className="text-foreground font-bold text-xs">Market Sentiment</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                        style={{ width: `${marketSentiment.bullish}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 w-8 text-right">{marketSentiment.bullish}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all"
                        style={{ width: `${marketSentiment.bearish}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-red-600 w-8 text-right">{marketSentiment.bearish}%</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5">
                    <span className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-emerald-500" /> Bullish
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingDown className="w-3 h-3 text-red-500" /> Bearish
                    </span>
                  </div>
                </div>
              </div>

              {/* Top Movers */}
              <div className="border-t border-border pt-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-sm">
                    <ArrowUpRight className="w-3 h-3 text-white" />
                  </div>
                  <h3 className="text-foreground font-bold text-xs">Top Movers</h3>
                </div>
                <div className="space-y-3">
                  {/* Gainers */}
                  {topGainers.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-600 mb-1.5 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Gainers
                      </p>
                      <div className="space-y-1">
                        {topGainers.map((s: any) => (
                          <Link key={s.ticker} to={`/app/stock/${s.ticker}`} className="flex items-center justify-between p-2 bg-emerald-50/50 rounded-lg hover:bg-emerald-50 transition-colors">
                            <span className="text-[10px] font-bold text-foreground">{s.ticker}</span>
                            <span className="text-[10px] font-bold text-emerald-600">+{s.change?.toFixed(2) || '0.00'}%</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Losers */}
                  {topLosers.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-red-600 mb-1.5 flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" /> Losers
                      </p>
                      <div className="space-y-1">
                        {topLosers.map((s: any) => (
                          <Link key={s.ticker} to={`/app/stock/${s.ticker}`} className="flex items-center justify-between p-2 bg-red-50/50 rounded-lg hover:bg-red-50 transition-colors">
                            <span className="text-[10px] font-bold text-foreground">{s.ticker}</span>
                            <span className="text-[10px] font-bold text-red-600">{s.change?.toFixed(2) || '0.00'}%</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                  {topGainers.length === 0 && topLosers.length === 0 && (
                    <div className="text-center py-2">
                      <p className="text-[10px] text-muted-foreground">No market data available</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Market News */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                    <Newspaper className="w-3 h-3 text-white" />
                  </div>
                  <h3 className="text-foreground font-bold text-xs">Market News</h3>
                </div>
                <div className="space-y-2">
                  {marketNews.length === 0 ? (
                    <div className="text-center py-2">
                      <p className="text-[10px] text-muted-foreground">No recent news</p>
                    </div>
                  ) : (
                    marketNews.map((news: any, i: number) => (
                      <a key={i} href={news.url || '#'} target="_blank" rel="noopener noreferrer" className="block p-2 bg-muted rounded-lg hover:bg-accent transition-colors group">
                        <p className="text-[10px] font-medium text-foreground leading-tight line-clamp-2 group-hover:text-[#0D7490]">{news.title || news.headline}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] text-muted-foreground">{news.source || 'News'}</span>
                          <span className="text-[9px] text-muted-foreground">·</span>
                          <span className="text-[9px] text-muted-foreground">{news.published_at ? new Date(news.published_at).toLocaleDateString() : 'Today'}</span>
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </div>
            </>          ) : null}
        </Card>
      </div>
    </div>
  );
}
