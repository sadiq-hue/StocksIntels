import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Sparkles, Send, Loader2, TrendingUp, ChevronDown, ChevronUp,
  Brain, BarChart3, Zap, Target, Shield,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import type { Signal as SharedSignal } from "../types/signals";

type Signal = SharedSignal & { currency?: string };

const signalConfig: Record<string, { label: string; bg: string; badge: string; bar: string }> = {
  'Strong Buy': { label: 'Strong Buy', bg: 'from-emerald-500 to-green-600', badge: 'bg-emerald-600', bar: 'bg-emerald-500' },
  'Buy': { label: 'Buy', bg: 'from-green-400 to-emerald-500', badge: 'bg-green-500', bar: 'bg-green-400' },
  'Accumulate': { label: 'Accumulate', bg: 'from-teal-400 to-teal-500', badge: 'bg-teal-500', bar: 'bg-teal-400' },
  'Hold': { label: 'Hold', bg: 'from-yellow-400 to-amber-500', badge: 'bg-yellow-500', bar: 'bg-yellow-400' },
  'Reduce': { label: 'Reduce', bg: 'from-orange-400 to-orange-500', badge: 'bg-orange-500', bar: 'bg-orange-400' },
  'Sell': { label: 'Sell', bg: 'from-orange-400 to-red-500', badge: 'bg-red-500', bar: 'bg-orange-400' },
  'Strong Sell': { label: 'Strong Sell', bg: 'from-red-500 to-red-700', badge: 'bg-red-700', bar: 'bg-red-500' },
};

const sigColors: Record<string, string> = {
  'Strong Buy': 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'Buy': 'bg-green-100 text-green-800 border-green-200',
  'Accumulate': 'bg-teal-100 text-teal-800 border-teal-200',
  'Hold': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Reduce': 'bg-orange-100 text-orange-800 border-orange-200',
  'Sell': 'bg-red-100 text-red-800 border-red-200',
  'Strong Sell': 'bg-red-100 text-red-800 border-red-200',
};

function SignalBadge({ signal, confidence }: { signal: string; confidence?: number }) {
  const base = sigColors[signal] || sigColors['Hold'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold border ${base}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
      {signal}
      {confidence != null && <span className="opacity-60 font-medium">· {confidence}%</span>}
    </span>
  );
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    if (/^https?:\/\//.test(part)) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#0D7490] underline hover:text-[#0A5F7A]">{part}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}

function renderSegments(line: string, i: number): ReactNode {
  const segments = line.split(/\s*\|\s*/);
  return (
    <div key={i} className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
      {segments.map((seg, j) => {
        const lvMatch = seg.match(/^\*\*(.+?)\*\*:\s*(.*)$/);
        if (lvMatch) {
          const label = lvMatch[1];
          const value = lvMatch[2];
          const isPrice = /price/i.test(label);
          const changeMatch = value.match(/\(([+-]?\d+\.\d+)%\)/);
          const changePos = changeMatch && parseFloat(changeMatch[1]) >= 0;
          return (
            <span key={j} className="leading-relaxed">
              <span className="font-semibold text-gray-600 text-[11px] uppercase tracking-wide">{label}</span>{' '}
              <span className={isPrice && changeMatch ? (changePos ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium') : 'text-gray-800'}>{value}</span>
            </span>
          );
        }
        const kvMatch = seg.match(/^(.+?):\s*(.+)$/);
        if (kvMatch) {
          return (
            <span key={j} className="leading-relaxed">
              <span className="font-medium text-gray-500">{kvMatch[1]}:</span>{' '}
              <span className="text-gray-800">{kvMatch[2]}</span>
            </span>
          );
        }
        return <span key={j} className="text-gray-700">{renderInline(seg)}</span>;
      })}
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) { elements.push(<div key={i} className="h-1.5" />); return; }

    // Bullet points
    if (t.startsWith('•') || t.startsWith('- ')) {
      elements.push(
        <div key={i} className="flex items-start gap-1.5 text-sm text-gray-700">
          <span className="text-gray-400 mt-0.5 shrink-0 text-xs">●</span>
          <span>{renderInline(t.replace(/^[•-]\s*/, ''))}</span>
        </div>
      );
      return;
    }

    // Section header with emoji: **📊 Financial Statements**
    const sectionEmoji = t.match(/^\*\*([📊📰🏦💼📈📉⭐]\s*.+?)\*\*$/);
    if (sectionEmoji) {
      elements.push(
        <div key={i} className="flex items-center gap-2 mt-3 mb-1.5">
          <div className="h-px flex-1 bg-gradient-to-r from-gray-200/60 to-transparent" />
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{sectionEmoji[1]}</span>
          <div className="h-px flex-1 bg-gradient-to-l from-gray-200/60 to-transparent" />
        </div>
      );
      return;
    }

    // Plain section header: **Key Ratios**, **Income Statement...**
    const sectionPlain = t.match(/^\*\*(.+?)\*\*$/);
    if (sectionPlain && !t.includes(':') && !t.includes('—')) {
      elements.push(
        <div key={i} className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mt-2 mb-0.5">{sectionPlain[1]}</div>
      );
      return;
    }

    // Title line: **Company (TICKER)** — Sector | Industry
    const title = t.match(/^\*\*(.+?)\*\*(?:\s*[—–-]\s*(.+))?$/);
    if (title && !t.includes(':')) {
      elements.push(
        <div key={i}>
          <span className="text-base font-bold text-gray-900">{title[1]}</span>
          {title[2] && <span className="text-sm text-gray-500 ml-1.5">— {title[2]}</span>}
        </div>
      );
      return;
    }

    // Signal line: **Signal:** Buy (80% confidence)
    const signal = t.match(/^\*\*Signal\*\*:\s*(\w+(?:\s+\w+)?)\s*\((\d+)% confidence\)/);
    if (signal) {
      elements.push(
        <div key={i} className="flex items-center gap-2 mt-1 mb-0.5">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Signal</span>
          <SignalBadge signal={signal[1]} confidence={parseInt(signal[2])} />
        </div>
      );
      return;
    }

    // Bold label line(s): **Label:** Value | **Label2:** Value2 | Text
    if (/^\*\*[^*]+\*\*:/.test(t)) {
      elements.push(renderSegments(t, i));
      return;
    }

    // Pipe-separated data row (no bold label)
    if (t.includes('|')) {
      elements.push(renderSegments(t, i));
      return;
    }

    // Default paragraph
    elements.push(
      <div key={i} className="text-sm text-gray-800 leading-relaxed">{renderInline(t)}</div>
    );
  });

  return <div className="space-y-0.5">{elements}</div>;
}

const sampleQuestions = [
  { text: "Analyze Safaricom trend", icon: TrendingUp },
  { text: "What about NVDA and AAPL?", icon: Brain },
  { text: "Best momentum stocks now", icon: Zap },
  { text: "Market overview", icon: BarChart3 },
];

export function AIInsightsPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hello! I'm your AI market analyst. Ask me about stocks, market trends, or trading strategies — across NSE, NYSE, and Nasdaq.",
    },
  ]);
  const { user, apiFetch } = useAuth();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const userIdParam = user?.id ? `?userId=${user.id}` : '';
    apiFetch(`/signals${userIdParam}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setSignals(data.signals || []);
      })
      .catch(() => {})
      .finally(() => setSignalsLoading(false));
  }, [user?.id]);

  const topSignals = useMemo(() => {
    return signals
      .filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy')
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }, [signals]);

  const handleSubmit = async (question: string) => {
    const userMessage = { role: "user", content: question };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await apiFetch('/ai/insights', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setMessages(prev => [...prev, { role: "assistant", content: data.answer }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      handleSubmit(input);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto h-[calc(100vh-160px)] md:h-[calc(100vh-200px)] flex flex-col">
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] shadow-lg shadow-[#0D7490]/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-gray-900 text-xl md:text-2xl font-bold tracking-tight">AI Insights</h2>
            <p className="text-gray-500 text-sm">Ask our AI analyst about stocks and market trends — NSE, NYSE, Nasdaq and more</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        {/* Live Signals Panel */}
        <Card className="w-full md:w-80 bg-white border-gray-200 flex flex-col overflow-hidden shrink-0 shadow-sm max-h-[240px] md:max-h-none">
          <button onClick={() => setShowSignals(!showSignals)}
            className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 hover:bg-gray-50/80 transition-colors group">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500/10 to-green-500/10">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <span className="font-semibold text-sm text-gray-900">Live Signals</span>
                {!signalsLoading && (
                  <span className="text-[10px] text-gray-400 ml-2 font-normal">{topSignals.length} buys</span>
                )}
              </div>
            </div>
            <div className="p-1 rounded-md group-hover:bg-gray-100 transition-colors">
              {showSignals ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronUp className="w-3.5 h-3.5 text-gray-400" />}
            </div>
          </button>
          {showSignals && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {signalsLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="relative">
                    <Loader2 className="w-6 h-6 animate-spin text-[#0D7490]" />
                    <div className="absolute inset-0 animate-ping opacity-20">
                      <Loader2 className="w-6 h-6 text-[#0D7490]" />
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">Loading signals...</span>
                </div>
              ) : topSignals.length > 0 ? (
                topSignals.map((s, i) => {
                  const cfg = signalConfig[s.signal] || signalConfig['Hold'];
                  return (
                    <div key={i}
                      className="group/card relative p-3 rounded-xl bg-white border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all duration-200 cursor-default">
                      {/* Confidence bar */}
                      <div className="absolute top-0 left-3 right-3 h-0.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${cfg.bar}`}
                          style={{ width: `${s.confidence}%` }} />
                      </div>
                      <div className="flex items-center justify-between mb-2 mt-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-gray-900 tracking-tight">{s.ticker}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold text-white ${cfg.badge}`}>
                            {s.signal}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-gray-400">{s.type}</span>
                      </div>
                      <div className="text-gray-500 truncate text-[11px] mb-2.5">{s.name}</div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-semibold text-sm text-gray-900">{s.currency} {s.price.toFixed(2)}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          s.change >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400">
                        <span className="flex items-center gap-1">
                          <Target className="w-3 h-3" /> {s.currency} {s.target1}
                        </span>
                        <span className="flex items-center gap-1">
                          <Shield className="w-3 h-3" /> {s.confidence}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {s.mlWinProb && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">ML: {s.mlWinProb}</span>}
                        {s.regime && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">{s.regime}</span>}
                        {s.weeklyTrend && <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${s.weeklyTrend === "Bullish" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{s.weeklyTrend}</span>}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                  <TrendingUp className="w-8 h-8 mb-2 opacity-30" />
                  <span className="text-sm font-medium">No buy signals</span>
                  <span className="text-xs mt-1">Check back during market hours</span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Chat Panel */}
        <Card className="flex-1 bg-white border-gray-200 p-0 flex flex-col overflow-hidden shadow-sm">
          {/* Chat header */}
          <div className="px-4 py-3 md:px-6 md:py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center gap-3 shrink-0">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#0D7490]/10 to-[#0EA5E9]/10">
              <Brain className="w-4 h-4 text-[#0D7490]" />
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-900">AI Analyst</span>
              <span className="text-[11px] text-gray-400 ml-2">Powered by signal engine</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5 space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role === "assistant" && (
                  <div className="flex items-start gap-3 max-w-[85%]">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] shadow-sm mt-0.5 shrink-0">
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm">
                      <MessageContent content={message.content} />
                    </div>
                  </div>
                )}
                {message.role === "user" && (
                  <div className="max-w-[75%] bg-gradient-to-r from-[#0D7490] to-[#0A5F7A] rounded-2xl rounded-tr-sm px-5 py-3.5 shadow-md shadow-[#0D7490]/10">
                    <p className="whitespace-pre-line leading-relaxed text-sm text-white">{message.content}</p>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-start gap-3 max-w-[85%]">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] shadow-sm mt-0.5 shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-[#0D7490] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-[#0D7490] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-[#0D7490] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-gray-400">Analyzing markets...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Sample Questions & Input */}
          <div className="border-t border-gray-100 bg-white px-4 py-3 md:px-6 md:py-4 space-y-3 shrink-0">
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2">
                {sampleQuestions.map((q, i) => {
                  const Icon = q.icon;
                  return (
                    <button key={i} onClick={() => handleSubmit(q.text)} disabled={loading}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-xl transition-all text-xs font-medium border border-gray-200 hover:border-[#0D7490]/30 hover:shadow-sm disabled:opacity-50">
                      <Icon className="w-3.5 h-3.5" />
                      {q.text}
                    </button>
                  );
                })}
              </div>
            )}

            <form onSubmit={handleSend} className="flex gap-2.5">
              <div className="relative flex-1">
                <Input value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
                  placeholder="Ask about stocks, trends, or strategies..."
                  className="w-full bg-gray-50 border-gray-200 text-gray-900 pr-4 pl-4 h-11 rounded-xl focus:bg-white focus:border-[#0D7490]/40 focus:ring-2 focus:ring-[#0D7490]/10 transition-all placeholder:text-gray-400" />
              </div>
              <Button type="submit" disabled={loading || !input.trim()}
                className="bg-gradient-to-r from-[#0D7490] to-[#0EA5E9] hover:from-[#0A5F7A] hover:to-[#0D7490] text-white px-5 h-11 rounded-xl shadow-md shadow-[#0D7490]/20 hover:shadow-lg hover:shadow-[#0D7490]/30 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
