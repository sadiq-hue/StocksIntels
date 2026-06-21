import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { ScrollArea } from "../components/ui/scroll-area";
import { useAuth } from "../auth/AuthContext";
import { getSocket, connectSocket } from "../services/socketService";
import { toast } from "sonner";
import {
  LifeBuoy, MessageCircle, FileText, Mail, Send, Ticket,
  Search, Loader2, AlertCircle, CheckCircle2,
  Clock, ArrowLeft, X, BookOpen, ChevronRight,
  ThumbsUp, Bot, User, Phone, Circle,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

type Ticket = {
  id: number; email: string; subject: string; category: string;
  priority: string; status: string; created_at: string; updated_at: string;
  messages?: TicketMessage[];
};

type TicketMessage = {
  id: number; ticket_id: number; sender: string; message: string;
  is_staff: boolean; created_at: string;
};

type FaqItem = { question: string; answer: string; category: string };

type SupportChatMessage = {
  id: number; user_id: number | null; user_name: string;
  email: string; message: string; is_staff: boolean; created_at: string;
};

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "account", label: "Account" },
  { value: "trading", label: "Trading" },
  { value: "data", label: "Market Data" },
  { value: "signals", label: "Signals" },
  { value: "social", label: "Groups & Chat" },
  { value: "billing", label: "Billing" },
  { value: "technical", label: "Technical Issue" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-amber-100 text-amber-700 border-amber-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

function validateEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isBusinessHours() {
  return true;
}

function formatChatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SupportCenterPage() {
  const { user } = useAuth();

  // --- Tab state ---
  const [tab, setTab] = useState("contact");

  // --- Contact form ---
  const [email, setEmail] = useState(user?.email || "");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // --- Tickets ---
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [closingTicket, setClosingTicket] = useState<number | null>(null);
  const ticketAbortRef = useRef<AbortController | null>(null);

  // --- FAQ ---
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [faqSearch, setFaqSearch] = useState("");
  const [faqCategory, setFaqCategory] = useState("all");
  const [loadingFaq, setLoadingFaq] = useState(false);
  const [faqError, setFaqError] = useState(false);

  // --- Live Chat ---
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<"bot" | "human" | "escalating">("bot");
  const [botMessages, setBotMessages] = useState<{ from: "bot" | "user"; text: string }[]>([]);
  const [chatMessages, setChatMessages] = useState<SupportChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatConnected, setChatConnected] = useState(false);
  const [staffTyping, setStaffTyping] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const businessHours = isBusinessHours();

  // --- Pre-fill email when auth loads ---
  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  }, [user?.email]);

  // --- FAQ fetch ---
  useEffect(() => {
    if (tab !== "faq") return;
    if (faq.length > 0 && faqCategory === "all") return;
    setLoadingFaq(true);
    setFaqError(false);
    const params = faqCategory !== "all" ? `?category=${faqCategory}` : "";
    fetch(`${API_URL}/support/faq${params}`)
      .then(r => { if (!r.ok) throw new Error("Failed to load FAQ"); return r.json(); })
      .then(data => { setFaq(data); setLoadingFaq(false); })
      .catch(() => { setFaqError(true); setLoadingFaq(false); });
  }, [tab, faqCategory]);

  // --- Tickets fetch with debounce ---
  const fetchTickets = useCallback(async (e: string, signal?: AbortSignal) => {
    if (!e || !validateEmail(e)) return;
    setLoadingTickets(true);
    try {
      const res = await fetch(`${API_URL}/support/tickets?email=${encodeURIComponent(e)}`, { signal });
      if (!res.ok) throw new Error("Failed to load tickets");
      const data = await res.json();
      if (!signal?.aborted) setTickets(data);
    } catch (err) {
      if ((err as Error).name !== "AbortError" && !signal?.aborted) {
        toast.error("Failed to load tickets");
      }
    } finally {
      if (!signal?.aborted) setLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "tickets") return;
    if (ticketAbortRef.current) ticketAbortRef.current.abort();
    const ac = new AbortController();
    ticketAbortRef.current = ac;
    const timer = setTimeout(() => fetchTickets(email, ac.signal), 400);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [tab, email, fetchTickets]);

  // --- Bot welcome message ---
  useEffect(() => {
    if (!chatOpen) return;
    setChatMode("bot");
    setBotMessages([{
      from: "bot",
      text: "Hi! 👋 I'm the StocksIntel support assistant. I can help you with:\n\n• **Account** — password reset, settings, billing\n• **Trading** — paper trading, signals, screener\n• **Stocks** — prices, signals, company info\n• **Market** — status, overview, movers\n• **Groups** — chat groups, collaboration\n\nYou can also type **\"talk to human\"** anytime to speak with a support agent.\n\nHow can I help you today?",
    }]);
    setChatMessages([]);
  }, [chatOpen]);

  // --- Chat socket lifecycle (human mode only) ---
  useEffect(() => {
    if (!chatOpen || chatMode !== "human") return;
    const socket = getSocket();
    if (!socket.connected) {
      connectSocket(user?.id || "guest", user?.full_name || "Guest");
    }
    const onConnect = () => {
      socket.emit("join_support_chat");
      setChatConnected(true);
    };
    if (socket.connected) {
      socket.emit("join_support_chat");
      setChatConnected(true);
    } else {
      socket.on("connect", onConnect);
    }
    const onMessage = (msg: SupportChatMessage) => {
      setChatMessages(prev => { if (prev.some(m => m.id === msg.id)) return prev; return [...prev, msg]; });
    };
    const onTyping = () => setStaffTyping(true);
    const onStopTyping = () => setStaffTyping(false);
    socket.on("support_chat_message", onMessage);
    socket.on("support_staff_typing", onTyping);
    socket.on("support_staff_stop_typing", onStopTyping);
    return () => {
      socket.emit("leave_support_chat");
      socket.off("connect", onConnect);
      socket.off("support_chat_message", onMessage);
      socket.off("support_staff_typing", onTyping);
      socket.off("support_staff_stop_typing", onStopTyping);
      setChatConnected(false);
      setStaffTyping(false);
    };
  }, [chatOpen, chatMode, user?.id, user?.full_name]);

  // --- Fetch chat history when switching to human ---
  useEffect(() => {
    if (!chatOpen || chatMode !== "human") return;
    setChatLoading(true);
    fetch(`${API_URL}/support/chat/messages?limit=50${user?.id ? `&userId=${user.id}` : ''}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => setChatMessages(data))
      .catch(() => {})
      .finally(() => setChatLoading(false));
  }, [chatOpen, chatMode]);

  // --- Auto-scroll chat ---
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, botMessages]);

  // --- Focus input when chat opens or bot finishes typing ---
  useEffect(() => {
    if (chatOpen) setTimeout(() => chatInputRef.current?.focus(), 300);
  }, [chatOpen]);
  useEffect(() => {
    if (!botTyping && chatOpen) chatInputRef.current?.focus();
  }, [botTyping, chatOpen]);

  // --- Chat typing indicator ---
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitTyping = () => {
    const socket = getSocket();
    if (socket.connected) {
      socket.emit("support_typing");
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        const s = getSocket();
        if (s.connected) s.emit("support_stop_typing");
      }, 2000);
    }
  };

  // --- Send chat message ---
  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");

    if (chatMode === "bot") {
      setBotMessages(prev => [...prev, { from: "user", text }]);
      setBotTyping(true);
      try {
        const res = await fetch(`${API_URL}/support/chatbot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        setBotTyping(false);
        if (data.escalated) {
          setChatMode("escalating");
          setTimeout(() => {
            setChatMode("human");
            setBotMessages(prev => [...prev, { from: "bot", text: "You're now connected with a human support agent." }]);
          }, 500);
        } else {
          setBotMessages(prev => [...prev, { from: "bot", text: data.answer }]);
        }
      } catch {
        setBotTyping(false);
        setBotMessages(prev => [...prev, { from: "bot", text: "Sorry, I had trouble reaching the server. Please try asking again or type **\"talk to human\"** for direct support." }]);
      }
      return;
    }

    // Human mode
    const senderEmail = user?.email || email || "guest@stocksintel.com";
    const senderName = user?.full_name || senderEmail.split("@")[0];
    setSendingChat(true);
    const socket = getSocket();
    if (socket.connected) {
      socket.emit("send_support_message", {
        userId: user?.id || null,
        userName: senderName,
        email: senderEmail,
        message: text,
        isStaff: false,
      });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    const s = getSocket();
    if (s.connected) s.emit("support_stop_typing");
    setSendingChat(false);
  };

  // --- Validate contact form ---
  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!email) errors.email = "Email is required";
    else if (!validateEmail(email)) errors.email = "Invalid email format";
    if (!subject.trim()) errors.subject = "Subject is required";
    else if (subject.trim().length < 3) errors.subject = "Subject too short (min 3 chars)";
    if (!message.trim()) errors.message = "Message is required";
    else if (message.trim().length < 10) errors.message = "Message too short (min 10 chars)";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, subject: subject.trim(), category, priority, message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      toast.success("Ticket submitted successfully!");
      setSubject(""); setMessage(""); setCategory("general"); setPriority("normal");
      setFormErrors({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit ticket");
    } finally { setSending(false); }
  };

  const openTicket = async (t: Ticket) => {
    try {
      const res = await fetch(`${API_URL}/support/tickets/${t.id}`);
      if (!res.ok) throw new Error("Failed to load ticket");
      const data = await res.json();
      setSelectedTicket(data);
    } catch { toast.error("Failed to load ticket details"); }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    if (!email) { toast.error("Email required to reply"); return; }
    setSendingReply(true);
    try {
      const res = await fetch(`${API_URL}/support/tickets/${selectedTicket.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: email, message: replyText.trim() }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setReplyText("");
      await openTicket(selectedTicket);
      toast.success("Reply sent");
    } catch { toast.error("Failed to send reply"); }
    finally { setSendingReply(false); }
  };

  const updateTicketStatus = async (ticketId: number, newStatus: string) => {
    setClosingTicket(ticketId);
    try {
      const res = await fetch(`${API_URL}/support/tickets/${ticketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success(`Ticket ${newStatus}`);
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket(prev => prev ? { ...prev, status: newStatus } : null);
      }
      fetchTickets(email);
    } catch { toast.error("Failed to update ticket status"); }
    finally { setClosingTicket(null); }
  };

  const filteredFaq = faq.filter(f =>
    f.question.toLowerCase().includes(faqSearch.toLowerCase()) ||
    f.answer.toLowerCase().includes(faqSearch.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); action(); }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h2 className="text-foreground text-2xl font-bold mb-1">Support Center</h2>
        <p className="text-muted-foreground">Get help, submit tickets, and find answers</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="contact"><MessageCircle className="size-4" /> Contact Us</TabsTrigger>
          <TabsTrigger value="tickets" className="relative">
            <Ticket className="size-4" /> My Tickets
            {tickets.filter(t => t.status === "open" || t.status === "in_progress").length > 0 && (
              <span className="ml-1.5 size-2 rounded-full bg-amber-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="faq"><LifeBuoy className="size-4" /> FAQ</TabsTrigger>
        </TabsList>

        {/* ─────────────── Contact Us ─────────────── */}
        <TabsContent value="contact">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 bg-card border-border p-6">
              <h3 className="text-foreground font-bold text-lg mb-4 flex items-center gap-2">
                <MessageCircle className="size-5 text-[#0D7490]" /> Submit a Ticket
              </h3>
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <label className="text-foreground text-sm font-semibold block mb-1.5">
                    Email <span className="text-red-400">*</span>
                  </label>
                  <Input type="email" placeholder="you@example.com" value={email}
                    onChange={e => { setEmail(e.target.value); if (formErrors.email) setFormErrors(p => ({ ...p, email: "" })); }}
                    className={formErrors.email ? "border-red-400" : ""} required />
                  {formErrors.email && <p className="text-red-500 text-xs mt-1">{formErrors.email}</p>}
                </div>
                <div>
                  <label className="text-foreground text-sm font-semibold block mb-1.5">
                    Subject <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Input type="text" placeholder="Brief summary of your issue" value={subject}
                      maxLength={120}
                      onChange={e => { setSubject(e.target.value); if (formErrors.subject) setFormErrors(p => ({ ...p, subject: "" })); }}
                      className={formErrors.subject ? "border-red-400 pr-16" : "pr-16"} required />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{subject.length}/120</span>
                  </div>
                  {formErrors.subject && <p className="text-red-500 text-xs mt-1">{formErrors.subject}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-foreground text-sm font-semibold block mb-1.5">Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)}
                      className="w-full h-11 bg-muted border-2 border-border rounded-xl px-3 text-foreground text-sm font-medium focus:border-[#0D7490] focus:outline-none">
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-foreground text-sm font-semibold block mb-1.5">Priority</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)}
                      className="w-full h-11 bg-muted border-2 border-border rounded-xl px-3 text-foreground text-sm font-medium focus:border-[#0D7490] focus:outline-none">
                      {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-foreground text-sm font-semibold block mb-1.5">
                    Message <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Textarea rows={5} placeholder="Describe your issue in detail..." value={message}
                      maxLength={2000}
                      onChange={e => { setMessage(e.target.value); if (formErrors.message) setFormErrors(p => ({ ...p, message: "" })); }}
                      className={`${formErrors.message ? "border-red-400" : ""} pr-12`} required />
                    <span className="absolute bottom-3 right-3 text-xs text-muted-foreground">{message.length}/2000</span>
                  </div>
                  {formErrors.message && <p className="text-red-500 text-xs mt-1">{formErrors.message}</p>}
                </div>
                {user && (
                  <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl text-sm text-blue-700">
                    <AlertCircle className="size-4 shrink-0 mt-0.5" />
                    <span className="break-words min-w-0">Submitting as <strong>{user.full_name}</strong> ({email})</span>
                  </div>
                )}
                <Button type="submit" disabled={sending}
                  className="w-full h-12 bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white font-bold rounded-xl shadow-lg shadow-[#0D7490]/25 transition-all disabled:opacity-70">
                  {sending ? <span className="flex items-center gap-2"><Loader2 className="animate-spin size-5" /> Submitting...</span>
                    : <span className="flex items-center gap-2"><Send className="size-4" /> Submit Ticket</span>}
                </Button>
              </form>
            </Card>

            <div className="space-y-4">
              <Card className="bg-card border-border p-5 hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => setChatOpen(true)}>
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg" style={{ background: businessHours ? "#ecfdf5" : "#fafafa" }}>
                    <MessageCircle className="size-5" style={{ color: businessHours ? "#059669" : "#9ca3af" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-foreground font-semibold text-sm">Live Chat</h4>
                      {businessHours
                        ? <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                        : <span className="size-1.5 rounded-full bg-muted shrink-0" />}
                    </div>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Online — click to start
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </Card>

              <Card className="bg-card border-border p-5 hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => setTab("faq")}>
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-50 rounded-lg"><BookOpen className="size-5 text-blue-600" /></div>
                  <div><h4 className="text-foreground font-semibold text-sm">Knowledge Base</h4>
                    <p className="text-muted-foreground text-xs mt-0.5">Browse common questions</p></div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0 ml-auto mt-1" />
                </div>
              </Card>
              <Card className="bg-card border-border p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-emerald-50 rounded-lg"><FileText className="size-5 text-emerald-600" /></div>
                  <div><h4 className="text-foreground font-semibold text-sm">Documentation</h4>
                    <p className="text-muted-foreground text-xs mt-0.5">Guides & API reference</p></div>
                </div>
              </Card>
              <Card className="bg-card border-border p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-amber-50 rounded-lg"><Mail className="size-5 text-amber-600" /></div>
                  <div><h4 className="text-foreground font-semibold text-sm">Email</h4>
                    <p className="text-muted-foreground text-xs mt-0.5">support@stocksintel.com</p></div>
                </div>
              </Card>
              <Card className="bg-card border-border p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-purple-50 rounded-lg"><Clock className="size-5 text-purple-600" /></div>
                  <div><h4 className="text-foreground font-semibold text-sm">Response Time</h4>
                    <p className="text-muted-foreground text-xs mt-0.5">Within 24 hours</p></div>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─────────────── My Tickets ─────────────── */}
        <TabsContent value="tickets">
          {selectedTicket ? (
            <div className="max-w-3xl">
              <button onClick={() => setSelectedTicket(null)}
                className="flex items-center gap-1.5 text-sm text-[#0D7490] font-semibold mb-4 hover:underline">
                <ArrowLeft className="size-4" /> Back to tickets
              </button>
              <Card className="bg-card border-border p-6 mb-4">
                <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                  <div className="min-w-0">
                    <h3 className="text-foreground font-bold text-lg break-words">{selectedTicket.subject}</h3>
                    <p className="text-muted-foreground text-sm mt-0.5">
                      {CATEGORIES.find(c => c.value === selectedTicket.category)?.label || selectedTicket.category}
                      &middot; Ticket #{selectedTicket.id}
                      &middot; {new Date(selectedTicket.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap shrink-0">
                    <Badge className={STATUS_COLORS[selectedTicket.status] || ""}>
                      {selectedTicket.status.replace("_", " ")}
                    </Badge>
                    <Badge className={PRIORITY_COLORS[selectedTicket.priority] || ""}>
                      {selectedTicket.priority}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-4 mb-4">
                  {(!selectedTicket.messages || selectedTicket.messages.length === 0) && (
                    <p className="text-muted-foreground text-sm text-center py-4">No messages yet</p>
                  )}
                  {selectedTicket.messages?.map(msg => (
                    <div key={msg.id}
                      className={`p-4 rounded-xl ${msg.is_staff ? "bg-[#0D7490]/5 ml-0 md:ml-8 border border-[#0D7490]/10" : "bg-muted mr-0 md:mr-8"}`}>
                      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          {msg.sender}
                          {msg.is_staff && <Badge className="bg-[#0D7490]/10 text-[#0D7490] text-[10px] px-1.5 py-0">Staff</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground">{new Date(msg.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{msg.message}</p>
                    </div>
                  ))}
                </div>
                {selectedTicket.status !== "closed" && selectedTicket.status !== "resolved" ? (
                  <div className="border-t border-border pt-4">
                    <h4 className="text-foreground font-semibold text-sm mb-2">Add a Reply</h4>
                    <Textarea rows={3} placeholder="Type your reply..." value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => handleKeyDown(e, sendReply)} maxLength={2000} />
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-muted-foreground">Press Enter to send</span>
                      <div className="flex gap-2">
                        {selectedTicket.status === "open" && (
                          <Button onClick={() => updateTicketStatus(selectedTicket.id, "closed")}
                            disabled={closingTicket === selectedTicket.id} variant="outline"
                            className="h-10 border-border text-muted-foreground rounded-xl">
                            {closingTicket === selectedTicket.id ? <Loader2 className="animate-spin size-4" /> : <X className="size-4" />}
                            Close Ticket
                          </Button>
                        )}
                        <Button onClick={sendReply} disabled={sendingReply || !replyText.trim()}
                          className="h-10 bg-[#0D7490] hover:bg-[#0A5F7A] text-white font-semibold rounded-xl disabled:opacity-70">
                          {sendingReply ? <Loader2 className="animate-spin size-4" /> : <Send className="size-4" />}
                          Send Reply
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-border pt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-500" />
                      This ticket is <strong>{selectedTicket.status}</strong>
                    </p>
                    <Button onClick={() => updateTicketStatus(selectedTicket.id, "open")}
                      disabled={closingTicket === selectedTicket.id} variant="outline"
                      className="h-10 border-border text-muted-foreground rounded-xl">
                      {closingTicket === selectedTicket.id ? <Loader2 className="animate-spin size-4" /> : <MessageCircle className="size-4" />}
                      Reopen
                    </Button>
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input type="email" placeholder="Enter your email" value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="pl-10 h-11 bg-muted border-2 border-border rounded-xl" />
                </div>
                <Button onClick={() => fetchTickets(email)}
                  disabled={!email || !validateEmail(email) || loadingTickets}
                  className="h-11 bg-[#0D7490] hover:bg-[#0A5F7A] text-white font-semibold rounded-xl">
                  {loadingTickets ? <Loader2 className="animate-spin size-4" /> : <Search className="size-4" />}
                  Search
                </Button>
              </div>
              {loadingTickets ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <Card key={i} className="bg-card border-border p-5 animate-pulse">
                      <div className="h-5 bg-muted rounded w-3/4 mb-3" />
                      <div className="h-4 bg-muted rounded w-1/2" />
                    </Card>
                  ))}
                </div>
              ) : tickets.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Ticket className="size-12 mx-auto mb-3 opacity-50" />
                  <p className="font-semibold">No tickets found</p>
                  <p className="text-sm">Submit a ticket in the Contact tab to get started</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-muted-foreground">
                      {tickets.length} ticket{tickets.length !== 1 ? "s" : ""}
                      &middot; {tickets.filter(t => t.status === "open" || t.status === "in_progress").length} active
                    </p>
                  </div>
                  <div className="space-y-3">
                    {tickets.map(t => (
                      <Card key={t.id} onClick={() => openTicket(t)}
                        className="bg-card border-border p-5 hover:border-[#0D7490] cursor-pointer transition-all">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-foreground font-semibold truncate">{t.subject}</h4>
                              {(t.status === "open" || t.status === "in_progress") && (
                                <span className="size-2 rounded-full bg-amber-500 shrink-0" />
                              )}
                            </div>
                            <p className="text-muted-foreground text-sm mt-1">
                              {CATEGORIES.find(c => c.value === t.category)?.label || t.category}
                              &middot; {new Date(t.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0 ml-4 flex-wrap">
                            <Badge className={STATUS_COLORS[t.status] || ""}>{t.status.replace("_", " ")}</Badge>
                            <Badge className={PRIORITY_COLORS[t.priority] || ""}>{t.priority}</Badge>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </TabsContent>

        {/* ─────────────── FAQ ─────────────── */}
        <TabsContent value="faq">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 mb-6 flex-col sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input placeholder="Search FAQ..." value={faqSearch} onChange={e => setFaqSearch(e.target.value)}
                  className="pl-10 h-12 bg-muted border-2 border-border rounded-xl" />
              </div>
              <select value={faqCategory} onChange={e => { setFaqCategory(e.target.value); setFaq([]); }}
                className="h-12 bg-muted border-2 border-border rounded-xl px-4 text-foreground text-sm font-medium focus:border-[#0D7490] focus:outline-none">
                <option value="all">All Topics</option>
                <option value="account">Account</option>
                <option value="trading">Trading</option>
                <option value="data">Market Data</option>
                <option value="signals">Signals</option>
                <option value="social">Groups & Chat</option>
                <option value="markets">Markets</option>
              </select>
            </div>
            {loadingFaq ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="bg-card border border-border rounded-xl p-5 animate-pulse">
                    <div className="h-5 bg-muted rounded w-3/4" />
                  </div>
                ))}
              </div>
            ) : faqError ? (
              <div className="text-center py-16 text-muted-foreground">
                <AlertCircle className="size-12 mx-auto mb-3 opacity-50" />
                <p className="font-semibold">Failed to load FAQ</p>
                <Button onClick={() => { setFaq([]); setFaqCategory("all"); }} variant="outline"
                  className="mt-3 border-border rounded-xl">Try Again</Button>
              </div>
            ) : filteredFaq.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Search className="size-12 mx-auto mb-3 opacity-50" />
                <p className="font-semibold">No results found</p>
                <p className="text-sm">{faqSearch ? "Try a different search term" : "No FAQ items available for this category"}</p>
              </div>
            ) : (
              <div className="mb-4">
                <p className="text-sm text-muted-foreground mb-3">
                  {filteredFaq.length} {filteredFaq.length === 1 ? "article" : "articles"}
                  {faqSearch && <> matching &quot;{faqSearch}&quot;</>}
                </p>
                <Accordion type="single" collapsible className="space-y-2">
                  {filteredFaq.map((item, i) => (
                    <AccordionItem key={`${faqCategory}-${i}`} value={`faq-${faqCategory}-${i}`}
                      className="bg-card border border-border rounded-xl overflow-hidden data-[state=open]:border-[#0D7490]/20 data-[state=open]:shadow-sm">
                      <AccordionTrigger className="px-5 py-4 text-foreground font-semibold text-sm hover:no-underline hover:bg-accent data-[state=open]:text-[#0D7490]">
                        <span className="text-left flex items-center gap-2">
                          <FileText className="size-4 text-muted-foreground shrink-0" />
                          {item.question}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-5 pb-4 text-muted-foreground text-sm leading-relaxed">
                        <div className="flex items-start gap-2">
                          <ChevronRight className="size-4 text-[#0D7490] shrink-0 mt-1" />
                          <span>{item.answer}</span>
                        </div>
                        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><ThumbsUp className="size-3" /> Was this helpful?</span>
                          <button className="hover:text-[#0D7490]">Yes</button>
                          <button className="hover:text-[#0D7490]">No</button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            )}
            {!faqSearch && filteredFaq.length > 0 && (
              <Card className="bg-gradient-to-br from-[#0D7490]/5 to-[#0EA5E9]/5 border-[#0D7490]/10 p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-[#0D7490]/10 rounded-lg"><MessageCircle className="size-5 text-[#0D7490]" /></div>
                  <div>
                    <h4 className="text-foreground font-semibold text-sm">Still need help?</h4>
                    <p className="text-muted-foreground text-xs mt-0.5">Can't find what you're looking for? Submit a ticket or start a live chat.</p>
                    <div className="flex gap-2 mt-3">
                      <Button onClick={() => setTab("contact")}
                        className="h-9 bg-[#0D7490] hover:bg-[#0A5F7A] text-white text-xs font-semibold rounded-xl">
                        <Send className="size-3" /> Submit a Ticket
                      </Button>
                      <Button onClick={() => setChatOpen(true)} variant="outline"
                        className="h-9 border-border text-foreground text-xs font-semibold rounded-xl">
                        <MessageCircle className="size-3" /> Live Chat
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─────────────── Live Chat Dialog ─────────────── */}
      <Dialog open={chatOpen} onOpenChange={o => { setChatOpen(o); if (!o) { setChatMode("bot"); setBotMessages([]); } }}>
        <DialogContent className="sm:max-w-lg h-[80vh] max-h-[700px] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl">
          <DialogHeader className="p-4 pb-3 border-b border-border shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${chatMode === "human" ? "bg-emerald-50" : "bg-blue-50"}`}>
                  {chatMode === "human"
                    ? <MessageCircle className="size-5 text-emerald-600" />
                    : <Bot className="size-5 text-blue-600" />}
                </div>
                <div>
                  <DialogTitle className="text-base text-foreground">
                    {chatMode === "human" ? "Live Chat" : "Support Assistant"}
                  </DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    {chatMode === "human" ? (
                      <span className="flex items-center gap-1.5"><Circle className="size-2 fill-emerald-500 text-emerald-500" /> Connected with support</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><Bot className="size-3 text-blue-500" /> AI-powered — ask me anything!</span>
                    )}
                  </DialogDescription>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {chatMode === "bot" && (
                  <Button variant="ghost" size="sm" onClick={() => { setChatMode("human"); setChatMessages([]); }}
                    className="text-xs text-[#0D7490] hover:text-[#0A5F7A] h-8 px-2 rounded-xl font-semibold">
                    Talk to human
                  </Button>
                )}
                {chatMode === "escalating" && (
                  <span className="text-xs text-amber-600 flex items-center gap-1 mr-2">
                    <Loader2 className="size-3 animate-spin" /> Connecting...
                  </span>
                )}
                <Button variant="ghost" size="icon" onClick={() => { setChatOpen(false); setChatMode("bot"); setBotMessages([]); }}
                  className="size-8 rounded-full text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>

          {!businessHours && (
            <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl shrink-0">
              <div className="flex items-start gap-2">
                <Clock className="size-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-800 text-xs font-semibold">Chat offline</p>
                  <p className="text-amber-700 text-xs mt-0.5">Please submit a ticket and we'll get back to you.</p>
                </div>
              </div>
            </div>
          )}

          <ScrollArea className="flex-1 px-4 py-3">
            {chatMode === "bot" || chatMode === "escalating" ? (
              <div className="space-y-3">
                {botMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-2.5 ${msg.from === "user" ? "flex-row-reverse" : ""}`}>
                    <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.from === "bot" ? "bg-blue-100" : "bg-muted"
                    }`}>
                      {msg.from === "bot"
                        ? <Bot className="size-4 text-blue-600" />
                        : <User className="size-4 text-muted-foreground" />}
                    </div>
                    <div className={`max-w-[80%] ${msg.from === "user" ? "items-end flex flex-col" : ""}`}>
                      {msg.from === "bot" && msg.text.startsWith("Hi! 👋") ? (
                        /* Welcome card with rich formatting */
                        <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl rounded-tl-sm p-4 text-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="size-8 rounded-full bg-blue-100 flex items-center justify-center">
                              <Bot className="size-4 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground text-sm">StocksIntel Assistant</p>
                              <p className="text-[10px] text-blue-500">AI-powered &bull; ask me anything!</p>
                            </div>
                          </div>
                          <p className="text-foreground mb-3">Hi! I'm the StocksIntel support assistant. I can help you with:</p>
                          <div className="grid grid-cols-1 gap-1.5 mb-3">
                            {[
                              { icon: "🔑", label: "Account", desc: "password reset, settings, billing" },
                              { icon: "📈", label: "Trading", desc: "paper trading, signals, screener" },
                              { icon: "💹", label: "Stocks", desc: "prices, signals, company info" },
                              { icon: "🏛️", label: "Market", desc: "status, overview, movers" },
                              { icon: "👥", label: "Groups", desc: "chat groups, collaboration" },
                            ].map(item => (
                              <div key={item.label} className="flex items-center gap-2.5 px-3 py-2 bg-white/70 rounded-lg border border-blue-50 hover:bg-white transition-colors">
                                <span className="text-base">{item.icon}</span>
                                <div>
                                  <span className="font-semibold text-gray-800 text-xs">{item.label}</span>
                                  <span className="text-muted-foreground text-xs ml-1">&mdash; {item.desc}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-100 rounded-lg">
                            <MessageCircle className="size-4 text-amber-600 shrink-0" />
                            <p className="text-xs text-amber-800">Type <strong>"talk to human"</strong> anytime to speak with a support agent.</p>
                          </div>
                        </div>
                      ) : msg.from === "bot" ? (
                        <div className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed bg-muted text-foreground rounded-tl-sm border border-border">
                          {(() => {
                            const parts = msg.text.split(/(\*\*[^*]+\*\*)/g);
                            return parts.map((part, i) => {
                              if (part.startsWith('**') && part.endsWith('**')) {
                                return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
                              }
                              const lines = part.split('\n');
                              return lines.map((line, j) => (
                                <Fragment key={`${i}-${j}`}>
                                  {j > 0 && <br />}
                                  {line.startsWith('• ') ? (
                                    <span className="flex items-start gap-1.5 ml-1">
                                      <span className="text-emerald-500 shrink-0 mt-0.5">●</span>
                                      <span>{line.slice(2)}</span>
                                    </span>
                                  ) : line}
                                </Fragment>
                              ));
                            });
                          })()}
                        </div>
                      ) : (
                        <div className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed bg-[#0D7490] text-white rounded-tr-sm">
                          {msg.text}
                        </div>
                      )}
                      <span className={`text-[10px] text-muted-foreground mt-1 ${msg.from === "user" ? "text-right" : ""}`}>
                        {msg.from === "bot" ? "Assistant" : "You"}
                      </span>
                    </div>
                  </div>
                ))}
                {botTyping && (
                  <div className="flex gap-2.5">
                    <div className="size-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <Bot className="size-4 text-blue-600" />
                    </div>
                    <div className="px-4 py-3 bg-muted border border-border rounded-2xl rounded-tl-sm">
                      <div className="flex gap-1">
                        <span className="size-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="size-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="size-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {chatLoading ? (
                  <div className="space-y-3 py-4">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="flex gap-3 animate-pulse">
                        <div className="size-8 rounded-full bg-muted shrink-0" />
                        <div className="flex-1">
                          <div className="h-4 bg-muted rounded w-1/4 mb-2" />
                          <div className="h-16 bg-muted rounded-xl" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                    <MessageCircle className="size-12 mb-3 opacity-50" />
                    <p className="font-semibold text-sm">Connected to support</p>
                    <p className="text-xs mt-1 text-center">A support agent will be with you shortly.</p>
                  </div>
                ) : (
                  chatMessages.map(msg => (
                    <div key={msg.id} className={`flex gap-2.5 ${msg.is_staff ? "" : "flex-row-reverse"}`}>
                      <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${msg.is_staff ? "bg-[#0D7490]/10" : "bg-muted"}`}>
                        {msg.is_staff ? <Bot className="size-4 text-[#0D7490]" /> : <User className="size-4 text-muted-foreground" />}
                      </div>
                      <div className={`max-w-[75%] ${msg.is_staff ? "" : "items-end flex flex-col"}`}>
                        <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          msg.is_staff
                            ? "bg-muted text-foreground rounded-tl-sm border border-border"
                            : "bg-[#0D7490] text-white rounded-tr-sm"
                        }`}>
                          {msg.message}
                        </div>
                        <span className={`text-[10px] text-muted-foreground mt-1 ${msg.is_staff ? "" : "text-right"}`}>
                          {msg.is_staff ? "Support" : "You"}
                          &middot; {formatChatTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
                {staffTyping && (
                  <div className="flex gap-2.5">
                    <div className="size-8 rounded-full bg-[#0D7490]/10 flex items-center justify-center shrink-0">
                      <Bot className="size-4 text-[#0D7490]" />
                    </div>
                    <div className="px-4 py-3 bg-muted border border-border rounded-2xl rounded-tl-sm">
                      <div className="flex gap-1">
                        <span className="size-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="size-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="size-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={chatEndRef} />
          </ScrollArea>

          <div className="p-4 pt-3 border-t border-border shrink-0">
            <div className="flex items-center gap-2">
              <Input ref={chatInputRef}
                placeholder={
                  chatMode === "human" ? "Type your message..." :
                  chatMode === "escalating" ? "Connecting to agent..." :
                  "Ask me anything..."
                }
                value={chatInput}
                onChange={e => { setChatInput(e.target.value); if (chatMode === "human") emitTyping(); }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                disabled={!businessHours || sendingChat || chatMode === "escalating" || botTyping}
                className="h-11 bg-muted border-2 border-border rounded-xl disabled:opacity-50" />
              <Button onClick={sendChatMessage}
                disabled={!chatInput.trim() || !businessHours || sendingChat || chatMode === "escalating" || botTyping}
                className="size-11 bg-[#0D7490] hover:bg-[#0A5F7A] text-white rounded-xl shrink-0 disabled:opacity-50">
                {sendingChat ? <Loader2 className="animate-spin size-5" /> : <Send className="size-5" />}
              </Button>
            </div>
            {chatMode === "human" && !chatConnected && businessHours && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertCircle className="size-3" /> Connecting to support...
              </p>
            )}
            {chatMode === "bot" && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Powered by AI · <button onClick={() => { setChatMode("human"); setChatMessages([]); }} className="text-[#0D7490] hover:underline font-semibold">Talk to human</button>
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
