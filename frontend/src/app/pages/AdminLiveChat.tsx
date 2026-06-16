import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import { getSocket, connectSocket } from "../services/socketService";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  MessageCircle, Send, User, Bot, ChevronRight, Loader2,
  Clock, Search, LogOut
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

type SupportChatMessage = {
  id: number; user_id: number | null; user_name: string;
  email: string; message: string; is_staff: boolean; created_at: string;
};

type ActiveChat = {
  user_id: number; user_name: string; email: string;
  last_message: string; last_activity: string;
};

function formatChatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

export default function AdminLiveChat() {
  const { user } = useAuth();
  const [activeChats, setActiveChats] = useState<ActiveChat[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [userTyping, setUserTyping] = useState<number | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [filter, setFilter] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Fetch active conversations
  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/support/chats/active`);
      if (res.ok) {
        const data: ActiveChat[] = await res.json();
        setActiveChats(data);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  // Fetch messages for selected user
  const fetchMessages = useCallback(async (uid: number) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`${API_URL}/support/chats/${uid}/messages`);
      if (res.ok) {
        const data: SupportChatMessage[] = await res.json();
        setMessages(data);
      }
    } catch { /* ignore */ } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Socket lifecycle (admin)
  useEffect(() => {
    if (!user?.id) return;
    const socket = getSocket();
    if (!socket.connected) {
      connectSocket(user.id, user.full_name);
    }

    const onConnect = () => {
      socket.emit("staff_join");
    };
    if (socket.connected) {
      socket.emit("staff_join");
    } else {
      socket.on("connect", onConnect);
    }

    // New message from a user
    const onMessage = (msg: SupportChatMessage) => {
      // Update active chats list
      setActiveChats(prev => {
        const exists = prev.find(c => c.user_id === msg.user_id);
        if (exists) {
          return prev.map(c =>
            c.user_id === msg.user_id
              ? { ...c, last_message: msg.message, last_activity: msg.created_at }
              : c
          ).sort((a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime());
        }
        if (!msg.user_id) return prev;
        return [{
          user_id: msg.user_id, user_name: msg.user_name,
          email: msg.email, last_message: msg.message,
          last_activity: msg.created_at,
        }, ...prev];
      });
      // Add message to current conversation if viewing this user
      if (msg.user_id === selectedUserId) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      }
    };

    const onUserTyping = (uid: number) => setUserTyping(uid);
    const onUserStopTyping = () => setUserTyping(null);

    socket.on("support_chat_message", onMessage);
    socket.on("support_user_typing", onUserTyping);
    socket.on("support_user_stop_typing", onUserStopTyping);

    // Initial fetch
    fetchActive();

    return () => {
      socket.emit("staff_leave");
      socket.off("connect", onConnect);
      socket.off("support_chat_message", onMessage);
      socket.off("support_user_typing", onUserTyping);
      socket.off("support_user_stop_typing", onUserStopTyping);
    };
  }, [user?.id, user?.full_name, selectedUserId, fetchActive]);

  // Fetch messages when selection changes
  useEffect(() => {
    if (selectedUserId) fetchMessages(selectedUserId);
  }, [selectedUserId, fetchMessages]);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send reply as staff
  const sendReply = async () => {
    const text = input.trim();
    if (!text || !selectedUserId) return;
    setInput("");
    setSending(true);
    const socket = getSocket();
    if (socket.connected) {
      socket.emit("staff_send_message", {
        userId: selectedUserId,
        userName: user?.full_name || "Support Agent",
        email: user?.email || "support@stocksintel.com",
        message: text,
      });
    }
    setSending(false);
  };

  const selectedChat = activeChats.find(c => c.user_id === selectedUserId);

  const filteredChats = activeChats.filter(c =>
    !filter || c.user_name.toLowerCase().includes(filter.toLowerCase()) ||
    c.email.toLowerCase().includes(filter.toLowerCase()) ||
    c.last_message.toLowerCase().includes(filter.toLowerCase())
  );

  if (user?.role !== "admin") {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center">
        <MessageCircle className="size-16 mx-auto mb-4 text-gray-300" />
        <h2 className="text-xl font-bold text-gray-800">Staff Access Only</h2>
        <p className="text-gray-500 mt-2">You need admin privileges to access live chat management.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] bg-gray-50">
      {/* Active conversations sidebar */}
      <div className="w-full lg:w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex flex-wrap items-center gap-2">
            <MessageCircle className="size-4 text-[#0D7490]" />
            Live Chat
            <span className="text-xs font-normal text-gray-400 ml-auto">{activeChats.length} active</span>
          </h2>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-gray-400" />
            <Input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Search conversations..." className="pl-8 h-9 text-xs rounded-lg" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-gray-400" />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="text-center py-12 px-4">
              <MessageCircle className="size-10 mx-auto mb-2 text-gray-200" />
              <p className="text-sm text-gray-400">{filter ? "No matches" : "No active conversations"}</p>
              <p className="text-xs text-gray-300 mt-1">Waiting for users to reach out...</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredChats.map(chat => (
                <button key={chat.user_id} onClick={() => setSelectedUserId(chat.user_id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3 ${
                    selectedUserId === chat.user_id ? "bg-blue-50 border-l-2 border-[#0D7490]" : ""
                  }`}>
                  <div className="size-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <User className="size-4 text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">{chat.user_name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0">{formatChatTime(chat.last_activity)}</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{chat.last_message}</p>
                    <p className="text-[10px] text-gray-300 mt-0.5">{chat.email}</p>
                  </div>
                  {userTyping === chat.user_id && (
                    <span className="text-[10px] text-emerald-500 shrink-0 animate-pulse">typing...</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Conversation pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedUserId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle className="size-16 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-sm">Select a conversation</p>
              <p className="text-xs mt-1">Choose a user from the sidebar to start replying</p>
            </div>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="px-5 py-3 border-b border-gray-200 bg-white shrink-0 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-full bg-[#0D7490]/10 flex items-center justify-center">
                  <User className="size-4 text-[#0D7490]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{selectedChat?.user_name || "User"}</p>
                  <p className="text-xs text-gray-400">{selectedChat?.email || ""}</p>
                </div>
              </div>
              {userTyping === selectedUserId && (
                <span className="text-xs text-emerald-600 flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  typing...
                </span>
              )}
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 px-5 py-4">
              {loadingMessages ? (
                <div className="space-y-3 py-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="flex gap-3 animate-pulse">
                      <div className="size-8 rounded-full bg-gray-200 shrink-0" />
                      <div className="flex-1"><div className="h-4 bg-gray-200 rounded w-1/4 mb-2" /><div className="h-12 bg-gray-200 rounded-xl" /></div>
                    </div>
                  ))}
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <MessageCircle className="size-12 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No messages in this conversation</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-2.5 ${msg.is_staff ? "" : "flex-row-reverse"}`}>
                      <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                        msg.is_staff ? "bg-[#0D7490]/10" : "bg-gray-100"
                      }`}>
                        {msg.is_staff ? <Bot className="size-4 text-[#0D7490]" /> : <User className="size-4 text-gray-500" />}
                      </div>
                      <div className={`max-w-[75%] ${msg.is_staff ? "" : "items-end flex flex-col"}`}>
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.is_staff
                            ? "bg-gray-50 text-gray-700 rounded-tl-sm border border-gray-100"
                            : "bg-[#0D7490] text-white rounded-tr-sm"
                        }`}>
                          {msg.message}
                        </div>
                        <span className={`text-[10px] text-gray-400 mt-1 ${msg.is_staff ? "" : "text-right"}`}>
                          {msg.is_staff ? "Staff" : selectedChat?.user_name || "User"}
                          &middot; {formatChatTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div ref={endRef} />
            </ScrollArea>

            {/* Reply input */}
            <div className="p-4 border-t border-gray-200 bg-white shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <Input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder="Type your reply..." className="h-11 bg-gray-50 border-2 border-gray-200 rounded-xl" />
                <Button onClick={sendReply}
                  disabled={!input.trim() || sending}
                  className="size-11 bg-[#0D7490] hover:bg-[#0A5F7A] text-white rounded-xl shrink-0 disabled:opacity-50">
                  {sending ? <Loader2 className="animate-spin size-5" /> : <Send className="size-5" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
