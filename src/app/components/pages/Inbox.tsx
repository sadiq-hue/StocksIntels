import { useEffect, useState, useCallback, useRef } from "react";
import { Search, MoreVertical, Send, Bot, User, CheckCircle2, Clock, Trash2, Archive, X, Plus } from "lucide-react";
import { api, type Lead, type Conversation as ApiConversation } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

type Conversation = {
  id: number;
  leadId?: string;
  name: string;
  company: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: boolean;
  status: string;
  email: string;
  phone: string;
  location: string;
  leadScore: number;
  scoreBreakdown: { intent: number; budget: number; timeline: number; authority: number };
  tags: string[];
  activities: { type: string; content: string; time: string }[];
  qualificationChecklist: { item: string; completed: boolean }[];
};

const defaultConversations: Conversation[] = [
  {
    id: -1,
    name: "Sarah Chen",
    company: "TechCorp",
    avatar: "SC",
    lastMessage: "That sounds perfect, I'd love to schedule a demo",
    time: "2m",
    unread: true,
    status: "qualified",
    email: "sarah.chen@techcorp.com",
    phone: "+1 (555) 123-4567",
    location: "San Francisco, CA",
    leadScore: 85,
    scoreBreakdown: { intent: 90, budget: 85, timeline: 80, authority: 85 },
    tags: ["Interested", "Enterprise", "High Priority"],
    activities: [
      { type: "message", content: "Initial inquiry about lead management", time: "2 hours ago" },
      { type: "qualification", content: "Lead qualified - High intent", time: "1 hour ago" },
      { type: "ai_response", content: "AI scheduled demo for Thursday", time: "30 minutes ago" }
    ],
    qualificationChecklist: [
      { item: "Budget confirmed", completed: true },
      { item: "Timeline discussed", completed: true },
      { item: "Decision maker identified", completed: true },
      { item: "Demo scheduled", completed: false }
    ]
  },
  {
    id: -2,
    name: "Michael Rodriguez",
    company: "StartupXYZ",
    avatar: "MR",
    lastMessage: "What are your pricing tiers?",
    time: "12m",
    unread: false,
    status: "booked",
    email: "michael@startupxyz.com",
    phone: "+1 (555) 987-6543",
    location: "Austin, TX",
    leadScore: 75,
    scoreBreakdown: { intent: 80, budget: 70, timeline: 75, authority: 75 },
    tags: ["Pricing Inquiry", "Startup"],
    activities: [
      { type: "message", content: "Asked about pricing tiers", time: "15 minutes ago" },
      { type: "ai_response", content: "Shared pricing information", time: "10 minutes ago" }
    ],
    qualificationChecklist: [
      { item: "Budget confirmed", completed: false },
      { item: "Timeline discussed", completed: true },
      { item: "Decision maker identified", completed: true },
      { item: "Demo scheduled", completed: true }
    ]
  },
  {
    id: -3,
    name: "Emma Williams",
    company: "Enterprise Co",
    avatar: "EW",
    lastMessage: "Can you tell me more about the features?",
    time: "1h",
    unread: true,
    status: "active",
    email: "emma.williams@enterprise.com",
    phone: "+1 (555) 456-7890",
    location: "New York, NY",
    leadScore: 65,
    scoreBreakdown: { intent: 70, budget: 60, timeline: 65, authority: 65 },
    tags: ["Feature Questions", "Enterprise"],
    activities: [
      { type: "message", content: "Asked about product features", time: "1 hour ago" },
      { type: "ai_response", content: "Provided feature overview", time: "45 minutes ago" }
    ],
    qualificationChecklist: [
      { item: "Budget confirmed", completed: false },
      { item: "Timeline discussed", completed: false },
      { item: "Decision maker identified", completed: true },
      { item: "Demo scheduled", completed: false }
    ]
  },
  {
    id: -4,
    name: "David Park",
    company: "Growth Inc",
    avatar: "DP",
    lastMessage: "Thanks for the information!",
    time: "2h",
    unread: false,
    status: "qualified",
    email: "david.park@growthinc.com",
    phone: "+1 (555) 321-0987",
    location: "Seattle, WA",
    leadScore: 80,
    scoreBreakdown: { intent: 85, budget: 80, timeline: 75, authority: 80 },
    tags: ["Qualified", "Growth Company"],
    activities: [
      { type: "message", content: "Positive response to demo", time: "2 hours ago" },
      { type: "qualification", content: "Lead fully qualified", time: "1.5 hours ago" }
    ],
    qualificationChecklist: [
      { item: "Budget confirmed", completed: true },
      { item: "Timeline discussed", completed: true },
      { item: "Decision maker identified", completed: true },
      { item: "Demo scheduled", completed: true }
    ]
  },
];

const defaultMessages = [
  { id: 1, sender: "lead", text: "Hi, I'm interested in your lead management solution", time: "10:23 AM" },
  {
    id: 2,
    sender: "ai",
    text: "Hello! I'd be happy to help. LeadFlow AI automates your inbound lead handling from WhatsApp and email. What's your biggest challenge with lead management right now?",
    time: "10:24 AM",
  },
  {
    id: 3,
    sender: "lead",
    text: "We're getting overwhelmed with inbound messages and missing follow-ups",
    time: "10:26 AM",
  },
  {
    id: 4,
    sender: "ai",
    text: "That's exactly what we solve. Our AI qualifies prospects automatically and schedules meetings directly. We integrate with your CRM to keep everything in sync. Would you like to see how it works?",
    time: "10:27 AM",
  },
  { id: 5, sender: "lead", text: "Yes, that sounds great. What's the next step?", time: "10:30 AM" },
  {
    id: 6,
    sender: "ai",
    text: "Perfect! I can schedule a 30-minute demo for you. Are you available this week? I have slots on Thursday at 2pm or Friday at 10am.",
    time: "10:31 AM",
  },
  { id: 7, sender: "lead", text: "That sounds perfect, I'd love to schedule a demo", time: "10:33 AM" },
];

export function Inbox() {
  const { business } = useBusiness();
  const [selectedConversation, setSelectedConversation] = useState(defaultConversations[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [conversationsData, setConversationsData] = useState<Conversation[]>(defaultConversations);
  const [messagesData, setMessagesData] = useState(defaultMessages);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [leadIdMap, setLeadIdMap] = useState<Record<number, string>>({});
  const [showDropdown, setShowDropdown] = useState<number | null>(null);
  const [newTag, setNewTag] = useState("");
  const [showAddTag, setShowAddTag] = useState(false);
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [humanTakeover, setHumanTakeover] = useState<{[key: number]: boolean}>({});
  const pollingRef = useRef<ReturnType<typeof setInterval>>();
  const messagesDataRef = useRef(messagesData);
  messagesDataRef.current = messagesData;
  const selectedConvRef = useRef(selectedConversation);
  selectedConvRef.current = selectedConversation;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessagesForLead = async (leadId: string, localConvId: number) => {
    try {
      const res = await api.whatsapp.messages(leadId);
      if (res.messages.length > 0) {
        const msgs = res.messages.map((m, i) => ({
          id: i + 1,
          sender: (m.direction === 'inbound' ? 'lead' : 'ai') as 'lead' | 'ai',
          text: m.content,
          time: new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));
        if (JSON.stringify(msgs) !== JSON.stringify(messagesDataRef.current)) {
          setMessagesData(msgs);
        }
        setMessagesLoaded(true);
      }
    } catch {
      // keep existing
    }
  };

  // Fetch real leads + conversations from API (used for initial load + polling)
  const fetchConversations = useCallback(async (initialLoad = false) => {
    if (!business) return;
    try {
      const [leadsRes, convsRes] = await Promise.all([
        api.leads.list({ business_id: business.id }).catch(() => null),
        api.conversations.list({ business_id: business.id }).catch(() => null),
      ]);
      if (!leadsRes?.leads?.length) return;

      const idMap: Record<number, string> = {};
      const mapped = leadsRes.leads.slice(0, 20).map((lead: Lead, idx: number) => {
        const leadConvs = (convsRes?.rows || []).filter(c => c.lead_id === lead.id);
        const lastConv = leadConvs[leadConvs.length - 1];

        idMap[idx + 1] = lead.id;

        const channelLabel = lead.channel === 'whatsapp' ? 'WhatsApp' : lead.channel === 'email' ? 'Email' : lead.channel.charAt(0).toUpperCase() + lead.channel.slice(1);
        return {
          id: idx + 1,
          leadId: lead.id,
          name: lead.name || `Lead ${lead.phone_number ? lead.phone_number.slice(-4) : lead.id.slice(0, 6)}`,
          company: (lead.metadata as any)?.company || (lead.source_ref || ''),
          avatar: (lead.name || lead.phone_number || lead.id).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
          lastMessage: lastConv ? lastConv.content.replace(/\n/g, ' ').slice(0, 80) : `Via ${channelLabel}`,
          time: formatTimeAgoSimple(lastConv?.sent_at || lead.last_activity_at),
          unread: lastConv?.direction === 'inbound' && lead.status === 'new',
          status: lead.status === 'new' ? 'active' : lead.status === 'qualified' ? 'qualified' : lead.status === 'won' ? 'booked' : lead.status,
          email: (lead.metadata as any)?.email || '',
          phone: lead.phone_number || '',
          location: (lead.metadata as any)?.location || '',
          leadScore: lead.score,
          scoreBreakdown: {
            intent: Math.min(lead.score + 10, 100),
            budget: lead.score,
            timeline: Math.max(lead.score - 10, 0),
            authority: Math.min(lead.score + 5, 100),
          },
          tags: [channelLabel],
          activities: leadConvs.slice(-3).map(c => ({
            type: c.direction === 'inbound' ? 'message' : 'ai_response',
            content: `${c.direction === 'inbound' ? 'Inbound' : 'AI'}: ${c.content.slice(0, 100)}${c.content.length > 100 ? '...' : ''}`,
            time: formatTimeAgoSimple(c.sent_at),
          })),
          qualificationChecklist: [
            { item: "Budget confirmed", completed: (lead.metadata as any)?.budget_confirmed || lead.score > 60 },
            { item: "Timeline discussed", completed: (lead.metadata as any)?.timeline_discussed || lead.score > 50 },
            { item: "Decision maker identified", completed: (lead.metadata as any)?.decision_maker || lead.score > 70 },
            { item: "Demo scheduled", completed: lead.status === 'booked' || lead.status === 'won' },
          ],
        };
      }) as Conversation[];

      setLeadIdMap(idMap);
      setConversationsData(mapped);

      if (initialLoad && mapped.length > 0) {
        setSelectedConversation(mapped[0]);
        fetchMessagesForLead(idMap[Object.keys(idMap)[0]], mapped[0].id);
      }
    } catch {
      // ignore polling errors
    }
  }, [business]);

  // Initial load
  useEffect(() => {
    fetchConversations(true);
  }, [fetchConversations]);

  // Poll for new messages every 10 seconds
  useEffect(() => {
    if (!business) return;
    pollingRef.current = setInterval(() => {
      fetchConversations(false);
      const sel = selectedConvRef.current;
      if (sel?.leadId) {
        fetchMessagesForLead(sel.leadId, sel.id);
      }
    }, 10000);
    return () => clearInterval(pollingRef.current);
  }, [business, fetchConversations]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesData]);

  // Filter conversations based on search term
  const filteredConversations = conversationsData.filter((conv) =>
    conv.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle sending a new message
  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const msgText = newMessage;
    const leadId = selectedConversation.leadId || leadIdMap[selectedConversation.id];
    const isHuman = humanTakeover[selectedConversation.id];
    setNewMessage("");

    if (isHuman && leadId && business) {
      // Human takeover: persist and send message directly to lead
      setMessagesData(prev => [...prev, {
        id: Date.now(),
        sender: "ai" as const,
        text: msgText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
      setConversationsData(prev =>
        prev.map(conv =>
          conv.id === selectedConversation.id
            ? { ...conv, lastMessage: msgText, time: "now" }
            : conv
        )
      );
      api.whatsapp.send({ lead_id: leadId, business_id: business.id, message: msgText }).catch(err => {
        console.error('Failed to send human message:', err);
      });
      return;
    }

    // AI mode: simulate lead message and get AI response
    const userMessage = {
      id: messagesData.length + 1,
      sender: "lead" as const,
      text: msgText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessagesData(prev => [...prev, userMessage]);

    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === selectedConversation.id
          ? { ...conv, unread: false, lastMessage: msgText, time: "now" }
          : conv
      )
    );

    if (leadId && business) {
      setIsAIThinking(true);
      api.ai.respond({
        lead_id: leadId,
        business_id: business.id,
        user_message: msgText,
      }).then(res => {
        const aiMessage = {
          id: Date.now() + 1,
          sender: "ai" as const,
          text: res.ai_response,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessagesData(prev => [...prev, aiMessage]);
        setIsAIThinking(false);

        setConversationsData(prev =>
          prev.map(conv =>
            conv.id === selectedConversation.id
              ? {
                  ...conv,
                  lastMessage: res.ai_response.slice(0, 50) + (res.ai_response.length > 50 ? '...' : ''),
                  time: "now",
                  leadScore: res.lead.score,
                }
              : conv
          )
        );
      }).catch((err) => {
        console.error('AI response failed:', err);
        setIsAIThinking(false);
      });
    } else {
      console.error('Cannot send message: no leadId or business');
    }
  };

  // Handle marking conversation as read
  const markAsRead = (conversationId: number) => {
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId ? { ...conv, unread: false } : conv
      )
    );
  };

  // Handle archiving a conversation
  const archiveConversation = (conversationId: number) => {
    setConversationsData(prev => prev.filter(conv => conv.id !== conversationId));
    if (selectedConversation.id === conversationId) {
      const remaining = filteredConversations.filter(conv => conv.id !== conversationId);
      setSelectedConversation(remaining.length > 0 ? remaining[0] : conversationsData[0]);
    }
  };

  // Handle deleting a conversation
  const deleteConversation = (conversationId: number) => {
    setConversationsData(prev => prev.filter(conv => conv.id !== conversationId));
    if (selectedConversation.id === conversationId) {
      const remaining = filteredConversations.filter(conv => conv.id !== conversationId);
      setSelectedConversation(remaining.length > 0 ? remaining[0] : conversationsData[0]);
    }
  };

  // Handle adding a tag
  const addTag = (conversationId: number, tag: string) => {
    if (!tag.trim()) return;
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? { ...conv, tags: [...(conv.tags || []), tag.trim()] }
          : conv
      )
    );
    setNewTag("");
    setShowAddTag(false);
  };

  // Handle removing a tag
  const removeTag = (conversationId: number, tagToRemove: string) => {
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? { ...conv, tags: (conv.tags || []).filter(tag => tag !== tagToRemove) }
          : conv
      )
    );
  };

  // Handle updating qualification checklist
  const updateQualificationItem = (conversationId: number, itemIndex: number, completed: boolean) => {
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? {
              ...conv,
              qualificationChecklist: conv.qualificationChecklist.map((item, index) =>
                index === itemIndex ? { ...item, completed } : item
              )
            }
          : conv
      )
    );
  };

  // Handle taking over conversation from AI
  const takeOverConversation = (conversationId: number) => {
    // Mark conversation as taken over by human
    setHumanTakeover(prev => ({ ...prev, [conversationId]: true }));

    // Update conversation status and add activity
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? {
              ...conv,
              status: "active", // Reset to active for human handling
              activities: [
                {
                  type: "message",
                  content: "Human agent took over conversation",
                  time: "just now"
                },
                ...(conv.activities || [])
              ].slice(0, 5)
            }
          : conv
      )
    );

    // Add a system message to the chat
    const takeoverMessage = {
      id: messagesData.length + 1,
      sender: "ai" as const,
      text: "🔄 Conversation transferred to human agent. A representative will continue the conversation shortly.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessagesData(prev => [...prev, takeoverMessage]);

    // Update conversation last message
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? {
              ...conv,
              lastMessage: "Human agent takeover initiated",
              time: "now"
            }
          : conv
      )
    );
  };

  // Handle releasing conversation back to AI
  const releaseToAI = (conversationId: number) => {
    setHumanTakeover(prev => ({ ...prev, [conversationId]: false }));

    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? {
              ...conv,
              activities: [
                {
                  type: "message",
                  content: "Conversation released back to AI",
                  time: "just now"
                },
                ...(conv.activities || [])
              ].slice(0, 5)
            }
          : conv
      )
    );

    // Add a system message
    const releaseMessage = {
      id: messagesData.length + 1,
      sender: "ai" as const,
      text: "🔄 Conversation transferred back to AI assistant for continued support.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessagesData(prev => [...prev, releaseMessage]);
  };

  // Handle updating lead status
  const updateLeadStatus = (conversationId: number, status: string) => {
    const lid = leadIdMap[conversationId] || conversationsData.find(c => c.id === conversationId)?.leadId;
    if (lid && business) {
      api.leads.update(lid, { status } as any).catch(() => {});
    }
    setConversationsData(prev =>
      prev.map(conv =>
        conv.id === conversationId ? { ...conv, status: status as Conversation['status'] } : conv
      )
    );
  };

  // Handle conversation selection
  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    markAsRead(conversation.id);
    const leadId = conversation.leadId || leadIdMap[conversation.id];
    if (leadId) {
      fetchMessagesForLead(leadId, conversation.id);
    }
  };

  return (
    <div className="flex h-full min-h-0" onClick={() => setShowDropdown(null)}>
      <div className="w-80 border-r border-border bg-background flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search conversations"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg bg-input-background border border-border"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => handleConversationSelect(conv)}
              className={`w-full p-4 border-b border-border hover:bg-accent/50 transition-colors text-left ${
                selectedConversation.id === conv.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
                  {conv.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium truncate">{conv.name}</p>
                    <span className="text-xs text-muted-foreground">{conv.time}</span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate mb-1">{conv.company}</p>
                  <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                </div>
                {conv.unread && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-2" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between bg-background">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
              {selectedConversation.avatar}
            </div>
            <div>
              <p className="font-medium">{selectedConversation.name}</p>
              <p className="text-sm text-muted-foreground">{selectedConversation.company}</p>
              {humanTakeover[selectedConversation.id] && (
                <div className="flex items-center gap-1 mt-1">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-xs text-green-600 font-medium">Human Agent</span>
                </div>
              )}
            </div>
          </div>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDropdown(showDropdown === selectedConversation.id ? null : selectedConversation.id);
              }}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {showDropdown === selectedConversation.id && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-lg shadow-lg z-10"
              >
                <button
                  onClick={() => {
                    archiveConversation(selectedConversation.id);
                    setShowDropdown(null);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-accent transition-colors flex items-center gap-2 text-sm"
                >
                  <Archive className="w-4 h-4" />
                  Archive conversation
                </button>
                <button
                  onClick={() => {
                    deleteConversation(selectedConversation.id);
                    setShowDropdown(null);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-accent transition-colors flex items-center gap-2 text-sm text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete conversation
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messagesData.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.sender === "lead" ? "" : "flex-row-reverse"}`}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.sender === "ai" && !humanTakeover[selectedConversation.id] ? "bg-blue-100 text-blue-600" :
                    msg.sender === "ai" && humanTakeover[selectedConversation.id] ? "bg-green-100 text-green-600" :
                    "bg-gray-200 text-gray-600"
                  }`}
                >
                  {msg.sender === "ai" && humanTakeover[selectedConversation.id] ? (
                    <User className="w-4 h-4" />
                  ) : msg.sender === "ai" ? (
                    <Bot className="w-4 h-4" />
                  ) : (
                    <User className="w-4 h-4" />
                  )}
                </div>
                <div className={`flex flex-col gap-1 max-w-md ${msg.sender === "lead" ? "items-start" : "items-end"}`}>
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      msg.sender === "ai" && !humanTakeover[selectedConversation.id]
                        ? "bg-blue-600 text-white"
                        : msg.sender === "ai" && humanTakeover[selectedConversation.id]
                        ? "bg-green-600 text-white"
                        : "bg-muted text-foreground border border-border"
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                  <span className="text-xs text-muted-foreground px-2">{msg.time}</span>
                </div>
              </div>
            ))}

            {isAIThinking && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse delay-150" />
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse delay-300" />
                </div>
                <span>AI is typing...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="w-80 border-l border-border bg-background p-6 space-y-6 overflow-y-auto">
            <div>
              <h3 className="mb-4">Lead Details</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{selectedConversation.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className={selectedConversation.email ? "text-blue-600 hover:underline cursor-pointer" : "text-muted-foreground/60"}>{selectedConversation.email || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Phone</p>
                  <p>{selectedConversation.phone || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Company</p>
                  <p>{selectedConversation.company || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p>{selectedConversation.location || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Source</p>
                  <p>{selectedConversation.tags?.[0] || 'Unknown'}</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-3">Lead Score</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${selectedConversation.leadScore}%` }}
                    />
                  </div>
                  <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                    {selectedConversation.leadScore}/100
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Intent:</span>
                    <span className="font-medium">{selectedConversation.scoreBreakdown.intent}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Budget:</span>
                    <span className="font-medium">{selectedConversation.scoreBreakdown.budget}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Timeline:</span>
                    <span className="font-medium">{selectedConversation.scoreBreakdown.timeline}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Authority:</span>
                    <span className="font-medium">{selectedConversation.scoreBreakdown.authority}%</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-3">Status</h4>
              <div className="space-y-2">
                <select
                  value={selectedConversation.status}
                  onChange={(e) => updateLeadStatus(selectedConversation.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-input-background border border-border text-sm"
                >
                  <option value="active">Active</option>
                  <option value="qualified">Qualified</option>
                  <option value="booked">Booked</option>
                  <option value="lost">Lost</option>
                </select>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>
                    {selectedConversation.status === "qualified" && "Lead qualified"}
                    {selectedConversation.status === "booked" && "Meeting booked"}
                    {selectedConversation.status === "active" && "Conversation active"}
                    {selectedConversation.status === "lost" && "Lead lost"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-blue-600" />
                  <span>{selectedConversation.unread ? "New message" : "Awaiting response"}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4>Tags</h4>
                <button
                  onClick={() => setShowAddTag(!showAddTag)}
                  className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                >
                  + Add
                </button>
              </div>
              {showAddTag && (
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addTag(selectedConversation.id, newTag)}
                    placeholder="New tag..."
                    className="flex-1 px-2 py-1 text-sm rounded border border-border"
                  />
                  <button
                    onClick={() => addTag(selectedConversation.id, newTag)}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Add
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(selectedConversation.tags || []).map((tag, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-sm flex items-center gap-1"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(selectedConversation.id, tag)}
                      className="ml-1 text-blue-500 hover:text-blue-700"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-3">Qualification Checklist</h4>
              <div className="space-y-2">
                {selectedConversation.qualificationChecklist.map((item, index) => (
                  <label key={index} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={(e) => updateQualificationItem(selectedConversation.id, index, e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className={item.completed ? "line-through text-muted-foreground" : ""}>
                      {item.item}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-3">Recent Activity</h4>
              <div className="space-y-3">
                {selectedConversation.activities.slice(0, 3).map((activity, index) => (
                  <div key={index} className="flex gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                      activity.type === 'message' ? 'bg-blue-500' :
                      activity.type === 'qualification' ? 'bg-green-500' :
                      'bg-purple-500'
                    }`} />
                    <div className="flex-1">
                      <p className="text-muted-foreground">{activity.content}</p>
                      <p className="text-xs text-muted-foreground">{activity.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {humanTakeover[selectedConversation.id] ? (
              <div className="space-y-2">
                <button
                  disabled
                  className="w-full px-4 py-2 rounded-lg border border-green-500 bg-green-50 text-green-700 cursor-not-allowed"
                >
                  ✓ Conversation Taken Over
                </button>
                <button
                  onClick={() => releaseToAI(selectedConversation.id)}
                  className="w-full px-4 py-2 rounded-lg border border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  Release to AI
                </button>
              </div>
            ) : (
              <button
                onClick={() => takeOverConversation(selectedConversation.id)}
                className="w-full px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                Take over conversation
              </button>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-border bg-background">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Type a message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 px-4 py-2 rounded-lg bg-input-background border border-border"
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgoSimple(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
