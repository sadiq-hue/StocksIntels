import { useState, useRef, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Sparkles, Send, Loader2 } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export function AIInsightsPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hello! I'm your AI market analyst. Ask me anything about NSE stocks, market trends, or trading strategies.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sampleQuestions = [
    "Analyze Safaricom trend",
    "Best NSE momentum stocks this week",
    "What's the outlook for banking sector?",
    "Give me a market overview",
  ];

  const handleSubmit = async (question: string) => {
    const userMessage = { role: "user", content: question };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/ai/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
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
    <div className="p-6 max-w-[1200px] mx-auto h-[calc(100vh-200px)] flex flex-col">
      <div className="mb-6">
        <h2 className="text-gray-900 text-2xl mb-1">AI Insights</h2>
        <p className="text-gray-600">Ask our AI analyst about NSE stocks and market trends</p>
      </div>

      <Card className="flex-1 bg-white border-gray-200 p-6 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto mb-4 space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] p-4 rounded-lg ${
                message.role === "user"
                  ? "bg-[#0D7490] text-white"
                  : "bg-gray-50 text-gray-800 border border-gray-100"
              }`}>
                {message.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-[#0D7490]" />
                    <span className="text-[#0D7490] text-sm font-semibold">AI Analyst</span>
                  </div>
                )}
                <p className="whitespace-pre-line leading-relaxed">{message.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-50 border border-gray-100 p-4 rounded-lg">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#0D7490]" />
                  <span className="text-sm text-gray-500">Analyzing markets...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {messages.length === 1 && (
          <div className="mb-4">
            <p className="text-gray-600 text-sm mb-3">Try asking:</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {sampleQuestions.map((question, index) => (
                <button key={index} onClick={() => handleSubmit(question)} disabled={loading}
                  className="text-left p-3 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg transition-colors text-sm border border-gray-200 hover:border-[#0D7490] disabled:opacity-50">
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} disabled={loading}
            placeholder="Ask about NSE stocks, trends, or strategies..."
            className="flex-1 bg-gray-50 border-gray-200 text-gray-900" />
          <Button type="submit" disabled={loading || !input.trim()} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white px-6">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      </Card>
    </div>
  );
}
