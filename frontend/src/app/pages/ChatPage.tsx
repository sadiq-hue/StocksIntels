import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Send, Users, Hash, TrendingUp, Sparkles, MoreVertical, Search, Plus, MessageSquare, Bot, Circle } from "lucide-react";
import { Badge } from "../components/ui/badge";
import {
  getSocket, connectSocket, disconnectSocket, joinGroup, leaveGroup,
  joinPrivate, sendMessage, emitTyping, emitStopTyping,
} from "../services/socketService";
import { useAuth } from "../auth/AuthContext";
import { useNavigate, useSearchParams } from "react-router";
import { formatLastSeen, formatMessageTime } from "../utils/timeFormat";

const GROUP_ICONS: Record<string, string> = {
  "nse-traders": "📊",
  "safaricom": "📱",
  "banking": "🏦",
  "tech-picks": "💻",
  "dividend-hunters": "💰",
  "day-traders": "⚡",
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface Message {
  id: number;
  sender_id?: number;
  sender_name: string;
  content: string;
  message_type: "user" | "system" | "ai";
  group_id?: string;
  recipient_id?: number;
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
  const { user, isLoading: authLoading } = useAuth();
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

  const socket = getSocket();

  // ── Fetch groups & people from API ──────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      try {
        const personParam = searchParams.get("person");
        const groupParam = searchParams.get("group");
        const userIdParam = user?.id ? `?userId=${user.id}` : "";
        const [groupsRes, peopleRes] = await Promise.all([
          fetch(`${API_URL}/groups${userIdParam}`).then(r => r.json()),
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

    return () => {
      s.off("receive_message", handleMessage);
      s.off("typing", handleTyping);
      s.off("stop_typing", handleStopTyping);
      s.off("group_member_joined", handleGroupMemberJoined);
      s.off("group_member_left", handleGroupMemberLeft);
      disconnectSocket();
    };
  }, [user?.id]);

  // ── Join group/private rooms when selected ─────────────────────────────
  useEffect(() => {
    if (chatMode === "group" && selectedGroup) {
      joinGroup(selectedGroup);
      setMessages([]);
      setGroupMembers([]);
      fetch(`${API_URL}/groups/${selectedGroup}/messages`)
        .then(r => r.json())
        .then(setMessages)
        .catch(() => {});
      fetch(`${API_URL}/groups/${selectedGroup}/members`)
        .then(r => r.json())
        .then(setGroupMembers)
        .catch(() => {});
    }
  }, [chatMode, selectedGroup]);

  useEffect(() => {
    if (chatMode === "people" && selectedPeer && user) {
      joinPrivate(user.id, selectedPeer);
      setMessages([]);
      fetch(`${API_URL}/conversations/${user.id}/${selectedPeer}`)
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
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;

    sendMessage({
      senderId: user!.id,
      senderName: user!.full_name,
      content: messageText.trim(),
      groupId: chatMode === "group" ? selectedGroup || undefined : undefined,
      recipientId: chatMode === "people" ? selectedPeer || undefined : undefined,
    });

    emitStopTyping({
      userId: user!.id,
      groupId: chatMode === "group" ? selectedGroup || undefined : undefined,
      recipientId: chatMode === "people" ? selectedPeer || undefined : undefined,
    });

    setMessageText("");
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
  };

  const handlePeerSelect = (peerId: number) => {
    if (selectedGroup) leaveGroup(selectedGroup);
    setChatMode("people");
    setSelectedPeer(peerId);
    setSelectedGroup(null);
  };

  const getLastMessage = (id: string, mode: "group" | "people") => {
    return null;
  };

  const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredPeers = peers.filter(p => p.full_name.toLowerCase().includes(searchQuery.toLowerCase()));

  // Guard: redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [authLoading, user, navigate]);

  if (authLoading || loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1800px] mx-auto h-[calc(100vh-140px)] flex items-center justify-center">
        <p className="text-gray-500">Loading chat...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="p-4 md:p-6 max-w-[1800px] mx-auto h-[calc(100vh-140px)]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-gray-900 text-2xl mb-1">Chat & Trading Groups</h2>
          <p className="text-gray-600">Connected as <strong>{user!.full_name}</strong></p>
        </div>
        <a href="/app/groups" className="flex items-center gap-2 px-4 py-2 bg-[#0D7490] text-white rounded-lg hover:bg-[#0A5F7A] transition-colors">
          <Plus className="w-4 h-4" />
          Browse Groups
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100%-80px)]">
        {/* Left sidebar */}
        <Card className="lg:col-span-3 bg-white border-gray-200 p-4 flex flex-col gap-4 overflow-hidden">
          <div>
            <h3 className="text-gray-900 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              {chatMode === "group" ? "Trading Groups" : "People"}
            </h3>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => { setChatMode("group"); setSelectedPeer(null); }}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  chatMode === "group" ? "bg-[#0D7490] text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}>Groups</button>
              <button onClick={() => { if (selectedGroup) leaveGroup(selectedGroup); setChatMode("people"); setSelectedGroup(null); }}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  chatMode === "people" ? "bg-[#0D7490] text-white shadow-sm" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}>People</button>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <Input placeholder={chatMode === "group" ? "Search groups..." : "Search people..."}
                value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-gray-50 border-gray-200" />
            </div>
          </div>

          <div className="space-y-1 overflow-y-auto flex-1 -mx-4 px-4">
            {chatMode === "group"
              ? (filteredGroups.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">No groups found</div>
                ) : (
                  filteredGroups.map((group) => (
                    <button key={group.id} onClick={() => handleGroupSelect(group.id)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        selectedGroup === group.id ? "bg-[#0D7490] text-white shadow-sm" : "text-gray-700 hover:bg-gray-100"
                      }`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
                          selectedGroup === group.id ? "bg-white/20" : "bg-gray-100"
                        }`}>{GROUP_ICONS[group.id] || group.icon || <Hash className="w-5 h-5" />}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{group.name}</span>
                          </div>
                          <p className={`text-xs truncate ${selectedGroup === group.id ? "text-white/70" : "text-gray-500"}`}>
                            {group.members} members · {group.online_members || 0} online · {group.activity_last_hour} msg/hr
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                ))
              : (filteredPeers.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">No people found</div>
                ) : (
                  filteredPeers.map((peer) => (
                    <button key={peer.id} onClick={() => handlePeerSelect(peer.id)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        selectedPeer === peer.id ? "bg-[#0D7490] text-white shadow-sm" : "text-gray-700 hover:bg-gray-100"
                      }`}>
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <Avatar className={`w-10 h-10 ${selectedPeer === peer.id ? "ring-2 ring-white/50" : ""}`}>
                            <AvatarFallback className={selectedPeer === peer.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}>
                              {getInitials(peer.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                            peer.online ? "bg-green-500" : "bg-gray-400"
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{peer.full_name}</span>
                          </div>
                          <p className={`text-xs truncate ${selectedPeer === peer.id ? "text-white/70" : "text-gray-500"}`}>
                            {formatLastSeen(peer.last_seen, peer.online)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                ))
            }
          </div>
        </Card>

        {/* Main Chat Area */}
        <Card className="lg:col-span-6 bg-white border-gray-200 flex flex-col overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div className="flex items-center gap-3">
              {chatMode === "group" ? (
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-lg">
                  {GROUP_ICONS[selectedGroup || ""] || <Hash className="w-5 h-5 text-[#0D7490]" />}
                </div>
              ) : currentPeer ? (
                <div className="relative">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-gray-100 text-gray-600">{getInitials(currentPeer.full_name)}</AvatarFallback>
                  </Avatar>
                  {currentPeer.online && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />}
                </div>
              ) : null}
              <div>
                <h3 className="text-gray-900 font-semibold">
                  {chatMode === "group" ? currentGroup?.name || "Select a group" : currentPeer?.full_name || "Select a person"}
                </h3>
                <p className="text-gray-500 text-xs">
                  {chatMode === "group"
                    ? `${currentGroup?.members || 0} members · ${currentGroup?.online_members || 0} online`
                    : formatLastSeen(currentPeer?.last_seen ?? null, currentPeer?.online ?? false)}
                </p>
              </div>
            </div>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <MoreVertical className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
            {!selectedGroup && !selectedPeer ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <MessageSquare className="w-12 h-12 mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">Select a conversation</p>
                <p className="text-xs mt-1">Choose a group or person to start chatting</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <MessageSquare className="w-12 h-12 mb-3 text-gray-300" />
                <p className="text-sm font-medium text-gray-500">No messages yet</p>
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
                          <div className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full">
                            {formatDateSeparator(msg.created_at)}
                          </div>
                        </div>
                      )}

                      {msg.message_type === "system" ? (
                        <div className="flex justify-center my-2">
                          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 inline-flex items-center gap-2">
                            <Bot className="w-3.5 h-3.5 text-gray-400" />
                            <p className="text-xs text-gray-500">{msg.content}</p>
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
                              <span className="text-gray-400 text-[11px]">{formatMessageTime(msg.created_at)}</span>
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
                              <p className="text-[11px] text-gray-500 mb-0.5 px-1">{msg.sender_name}</p>
                            )}
                            <div className={`rounded-2xl px-4 py-2.5 ${
                              isOwn ? "bg-[#0D7490] text-white rounded-tr-sm" : "bg-gray-100 text-gray-800 rounded-tl-sm"
                            }`}>
                              <p className="text-sm leading-relaxed">{msg.content}</p>
                            </div>
                            <p className={`text-[10px] text-gray-400 mt-0.5 px-1 ${isOwn ? "text-right" : ""}`}>
                              {formatMessageTime(msg.created_at)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {isTyping && typingUser && (
                  <div className="flex items-center gap-3 py-2">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="text-xs bg-gray-200 text-gray-500">
                        {getInitials(typingUser)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 mr-1">{typingUser} typing</span>
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
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 p-4 border-t border-gray-200">
            <Input value={messageText} onChange={handleInputChange}
              placeholder={chatMode === "group"
                ? "Type a message or mention a stock ticker (e.g. SCOM)..."
                : `Message ${currentPeer?.full_name || "someone"}...`
              }
              className="flex-1 bg-gray-50 border-gray-200 text-gray-900 focus-visible:ring-[#0D7490]" />
            <Button type="submit" disabled={!messageText.trim()}
              className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-5 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </Card>

        {/* Right sidebar */}
        <Card className="lg:col-span-3 bg-white border-gray-200 p-4 overflow-y-auto">
          {chatMode === "group" ? (
            <>
              <div className="mb-6">
                <h3 className="text-gray-900 mb-4 font-semibold flex items-center gap-2">
                  <Circle className="w-4 h-4 fill-green-500 text-green-500" />
                  Online Members
                  <span className="text-sm font-normal text-gray-500">({currentGroup?.online_members || 0})</span>
                </h3>
                <div className="space-y-2">
                  {groupMembers.filter(m => m.online).length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">No members online</p>
                  ) : (
                    groupMembers.filter(m => m.online).slice(0, 10).map(member => (
                      <div key={member.id}
                        className="w-full text-left p-3 rounded-xl bg-gray-50 border border-gray-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs bg-green-100 text-green-700">{getInitials(member.full_name)}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium text-gray-900">{member.full_name}</span>
                          </div>
                          <span className="text-xs text-green-600 font-medium">Online</span>
                        </div>
                      </div>
                    ))
                  )}
                  {groupMembers.filter(m => m.online).length > 10 && (
                    <p className="text-xs text-gray-500 text-center pt-1">
                      +{groupMembers.filter(m => m.online).length - 10} more online
                    </p>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-gray-900 mb-4 font-semibold">Stock Mentions</h3>
                <div className="space-y-3">
                  {["SCOM", "EQTY", "KCB"].map(ticker => (
                    <div key={ticker} className="p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-sm font-bold text-gray-900">{ticker[0]}</div>
                          <span className="text-gray-900 font-semibold">{ticker}</span>
                        </div>
                        <TrendingUp className="w-4 h-4 text-green-500" />
                      </div>
                      <div className="flex items-center justify-between text-sm pl-10">
                        <span className="text-gray-500">Trending</span>
                        <span className="font-medium text-green-600">Bullish</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-gray-900 mb-3 font-semibold">About this group</h3>
                <div className="bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] rounded-xl p-4 shadow-sm">
                  <p className="text-white text-sm font-medium mb-2">{currentGroup?.name || "Group"}</p>
                  <p className="text-white/80 text-xs leading-relaxed">{currentGroup?.description || "Connect with traders"}</p>
                  <div className="mt-3 flex items-center gap-2 text-white/60 text-xs">
                    <Users className="w-3 h-3" />
                    {currentGroup?.members || 0} members · {currentGroup?.online_members || 0} online
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h3 className="text-gray-900 mb-4 font-semibold flex items-center gap-2">
                  <Circle className="w-4 h-4 fill-green-500 text-green-500" />
                  Online Members
                </h3>
                <div className="space-y-2">
                  {peers.filter(p => p.online).length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">No users online</p>
                  ) : (
                    peers.filter(p => p.online).map(peer => (
                      <button key={peer.id} onClick={() => handlePeerSelect(peer.id)}
                        className={`w-full text-left p-3 rounded-xl transition-all ${
                          selectedPeer === peer.id ? "bg-[#E8F4F8] border border-[#0D7490]" : "bg-gray-50 border border-gray-100 hover:border-gray-200"
                        }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="text-xs bg-green-100 text-green-700">{getInitials(peer.full_name)}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium text-gray-900">{peer.full_name}</span>
                          </div>
                          <span className="text-xs text-green-600 font-medium">Online</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
