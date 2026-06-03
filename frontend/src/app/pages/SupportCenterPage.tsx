import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "../components/ui/accordion";
import {
  LifeBuoy, MessageCircle, FileText, Mail, Send, Ticket,
  ChevronDown, Search, Loader2, AlertCircle, CheckCircle2,
  Clock, ArrowLeft, Plus, Inbox,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

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
  closed: "bg-gray-100 text-gray-500 border-gray-200",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-500",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

export function SupportCenterPage() {
  const [tab, setTab] = useState("contact");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [faqSearch, setFaqSearch] = useState("");
  const [faqCategory, setFaqCategory] = useState("all");
  const [loadingFaq, setLoadingFaq] = useState(false);

  useEffect(() => {
    if (tab === "faq" && faq.length === 0) {
      setLoadingFaq(true);
      const params = faqCategory !== "all" ? `?category=${faqCategory}` : "";
      fetch(`${API_URL}/support/faq${params}`)
        .then(r => r.json())
        .then(data => { setFaq(data); setLoadingFaq(false); })
        .catch(() => setLoadingFaq(false));
    }
  }, [tab, faq.length, faqCategory]);

  useEffect(() => {
    if (tab === "tickets" && email) {
      setLoadingTickets(true);
      fetch(`${API_URL}/support/tickets?email=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(data => { setTickets(data); setLoadingTickets(false); })
        .catch(() => setLoadingTickets(false));
    }
  }, [tab, email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setSuccess(""); setSending(true);
    try {
      const res = await fetch(`${API_URL}/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, subject, category, priority, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      setSuccess("Ticket submitted successfully! Check the My Tickets tab for updates.");
      setSubject(""); setMessage(""); setCategory("general"); setPriority("normal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit ticket");
    } finally { setSending(false); }
  };

  const openTicket = async (t: Ticket) => {
    const res = await fetch(`${API_URL}/support/tickets/${t.id}`);
    const data = await res.json();
    setSelectedTicket(data);
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    setSendingReply(true);
    try {
      const res = await fetch(`${API_URL}/support/tickets/${selectedTicket.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: email, message: replyText }),
      });
      if (!res.ok) throw new Error("Failed to send");
      setReplyText("");
      openTicket(selectedTicket);
    } catch (err) {
      setError("Failed to send reply");
    } finally { setSendingReply(false); }
  };

  const filteredFaq = faq.filter(f =>
    f.question.toLowerCase().includes(faqSearch.toLowerCase()) ||
    f.answer.toLowerCase().includes(faqSearch.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h2 className="text-gray-900 text-2xl font-bold mb-1">Support Center</h2>
        <p className="text-gray-500">Get help, submit tickets, and find answers</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-emerald-700 text-sm">{success}</p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="contact"><MessageCircle className="size-4" /> Contact Us</TabsTrigger>
          <TabsTrigger value="tickets"><Ticket className="size-4" /> My Tickets</TabsTrigger>
          <TabsTrigger value="faq"><LifeBuoy className="size-4" /> FAQ</TabsTrigger>
        </TabsList>

        <TabsContent value="contact">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 bg-white border-gray-200 p-6">
              <h3 className="text-gray-900 font-bold text-lg mb-4 flex items-center gap-2">
                <MessageCircle className="size-5 text-[#0D7490]" /> Submit a Ticket
              </h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-gray-700 text-sm font-semibold block mb-1.5">Email</label>
                  <Input type="email" placeholder="you@example.com" value={email}
                    onChange={e => setEmail(e.target.value)} required />
                </div>
                <div>
                  <label className="text-gray-700 text-sm font-semibold block mb-1.5">Subject</label>
                  <Input type="text" placeholder="Brief summary of your issue" value={subject}
                    onChange={e => setSubject(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-700 text-sm font-semibold block mb-1.5">Category</label>
                    <select value={category} onChange={e => setCategory(e.target.value)}
                      className="w-full h-11 bg-gray-50 border-2 border-gray-200 rounded-xl px-3 text-gray-900 text-sm font-medium focus:border-[#0D7490] focus:outline-none">
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-700 text-sm font-semibold block mb-1.5">Priority</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)}
                      className="w-full h-11 bg-gray-50 border-2 border-gray-200 rounded-xl px-3 text-gray-900 text-sm font-medium focus:border-[#0D7490] focus:outline-none">
                      {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-gray-700 text-sm font-semibold block mb-1.5">Message</label>
                  <Textarea rows={5} placeholder="Describe your issue in detail..." value={message}
                    onChange={e => setMessage(e.target.value)} required />
                </div>
                <Button type="submit" disabled={sending}
                  className="w-full h-12 bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white font-bold rounded-xl shadow-lg shadow-[#0D7490]/25 transition-all disabled:opacity-70">
                  {sending ? <span className="flex items-center gap-2"><Loader2 className="animate-spin size-5" /> Submitting...</span>
                    : <span className="flex items-center gap-2"><Send className="size-4" /> Submit Ticket</span>}
                </Button>
              </form>
            </Card>

            <div className="space-y-4">
              <Card className="bg-white border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-50 rounded-lg"><MessageCircle className="size-5 text-blue-600" /></div>
                  <div><h4 className="text-gray-900 font-semibold text-sm">Live Chat</h4>
                    <p className="text-gray-500 text-xs mt-0.5">Mon-Fri, 8AM-6PM EAT</p></div>
                </div>
              </Card>
              <Card className="bg-white border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-emerald-50 rounded-lg"><FileText className="size-5 text-emerald-600" /></div>
                  <div><h4 className="text-gray-900 font-semibold text-sm">Documentation</h4>
                    <p className="text-gray-500 text-xs mt-0.5">Guides & API reference</p></div>
                </div>
              </Card>
              <Card className="bg-white border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-amber-50 rounded-lg"><Mail className="size-5 text-amber-600" /></div>
                  <div><h4 className="text-gray-900 font-semibold text-sm">Email</h4>
                    <p className="text-gray-500 text-xs mt-0.5">support@stocksintel.com</p></div>
                </div>
              </Card>
              <Card className="bg-white border-gray-200 p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-purple-50 rounded-lg"><Clock className="size-5 text-purple-600" /></div>
                  <div><h4 className="text-gray-900 font-semibold text-sm">Response Time</h4>
                    <p className="text-gray-500 text-xs mt-0.5">Within 24 hours</p></div>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tickets">
          {selectedTicket ? (
            <div className="max-w-3xl">
              <button onClick={() => setSelectedTicket(null)}
                className="flex items-center gap-1.5 text-sm text-[#0D7490] font-semibold mb-4 hover:underline">
                <ArrowLeft className="size-4" /> Back to tickets
              </button>
              <Card className="bg-white border-gray-200 p-6 mb-4">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-gray-900 font-bold text-lg">{selectedTicket.subject}</h3>
                    <p className="text-gray-500 text-sm mt-0.5">
                      {selectedTicket.category} &middot; {new Date(selectedTicket.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge className={STATUS_COLORS[selectedTicket.status] || ""}>
                      {selectedTicket.status.replace("_", " ")}
                    </Badge>
                    <Badge className={PRIORITY_COLORS[selectedTicket.priority] || ""}>
                      {selectedTicket.priority}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-4">
                  {selectedTicket.messages?.map(msg => (
                    <div key={msg.id} className={`p-4 rounded-xl ${msg.is_staff ? "bg-[#0D7490]/5 ml-8 border border-[#0D7490]/10" : "bg-gray-50 mr-8"}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-700">{msg.sender}</span>
                        <span className="text-xs text-gray-400">{new Date(msg.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{msg.message}</p>
                    </div>
                  ))}
                </div>
              </Card>
              {selectedTicket.status !== "closed" && selectedTicket.status !== "resolved" && (
                <Card className="bg-white border-gray-200 p-4">
                  <h4 className="text-gray-900 font-semibold text-sm mb-2">Add a Reply</h4>
                  <Textarea rows={3} placeholder="Type your reply..." value={replyText}
                    onChange={e => setReplyText(e.target.value)} />
                  <Button onClick={sendReply} disabled={sendingReply || !replyText.trim()}
                    className="mt-3 h-10 bg-[#0D7490] hover:bg-[#0A5F7A] text-white font-semibold rounded-xl disabled:opacity-70">
                    {sendingReply ? <Loader2 className="animate-spin size-4" /> : <Send className="size-4" />}
                    Send Reply
                  </Button>
                </Card>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <Input type="email" placeholder="Enter your email to fetch tickets" value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="max-w-xs h-11 bg-gray-50 border-2 border-gray-200 rounded-xl" />
                <Button onClick={() => {
                  setLoadingTickets(true);
                  fetch(`${API_URL}/support/tickets?email=${encodeURIComponent(email)}`)
                    .then(r => r.json()).then(data => { setTickets(data); setLoadingTickets(false); })
                    .catch(() => setLoadingTickets(false));
                }} disabled={!email || loadingTickets}
                  className="h-11 bg-[#0D7490] hover:bg-[#0A5F7A] text-white font-semibold rounded-xl">
                  {loadingTickets ? <Loader2 className="animate-spin size-4" /> : <Search className="size-4" />}
                  Search
                </Button>
              </div>
              {loadingTickets ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin size-8 text-gray-400" /></div>
              ) : tickets.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Inbox className="size-12 mx-auto mb-3 opacity-50" />
                  <p className="font-semibold">No tickets found</p>
                  <p className="text-sm">Submit a ticket in the Contact tab</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {tickets.map(t => (
                    <Card key={t.id} onClick={() => openTicket(t)}
                      className="bg-white border-gray-200 p-5 hover:border-[#0D7490] cursor-pointer transition-all">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-gray-900 font-semibold truncate">{t.subject}</h4>
                          <p className="text-gray-500 text-sm mt-1">
                            {CATEGORIES.find(c => c.value === t.category)?.label || t.category}
                            &middot; {new Date(t.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-4">
                          <Badge className={STATUS_COLORS[t.status] || ""}>{t.status.replace("_", " ")}</Badge>
                          <Badge className={PRIORITY_COLORS[t.priority] || ""}>{t.priority}</Badge>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="faq">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                <Input placeholder="Search FAQ..." value={faqSearch} onChange={e => setFaqSearch(e.target.value)}
                  className="pl-10 h-12 bg-gray-50 border-2 border-gray-200 rounded-xl" />
              </div>
              <select value={faqCategory} onChange={e => { setFaqCategory(e.target.value); setFaq([]); }}
                className="h-12 bg-gray-50 border-2 border-gray-200 rounded-xl px-4 text-gray-700 text-sm font-medium focus:border-[#0D7490] focus:outline-none">
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
              <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin size-8 text-gray-400" /></div>
            ) : filteredFaq.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Search className="size-12 mx-auto mb-3 opacity-50" />
                <p className="font-semibold">No results found</p>
                <p className="text-sm">Try a different search term</p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="space-y-2">
                {filteredFaq.map((item, i) => (
                  <AccordionItem key={i} value={`faq-${i}`}
                    className="bg-white border border-gray-200 rounded-xl overflow-hidden data-[state=open]:border-[#0D7490]/20 data-[state=open]:shadow-sm">
                    <AccordionTrigger className="px-5 py-4 text-gray-900 font-semibold text-sm hover:no-underline hover:bg-gray-50/50 data-[state=open]:text-[#0D7490]">
                      <span className="text-left">{item.question}</span>
                    </AccordionTrigger>
                    <AccordionContent className="px-5 pb-4 text-gray-600 text-sm leading-relaxed">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
