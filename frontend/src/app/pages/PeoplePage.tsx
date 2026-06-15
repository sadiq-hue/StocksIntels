import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import {
  Search, MessageSquare, UserPlus, UserCheck, ShieldCheck, TrendingUp, ExternalLink, Users, Circle, Medal,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { getSocket, connectSocket } from "../services/socketService";
import { formatLastSeen } from "../utils/timeFormat";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface UserProfile {
  id: number;
  full_name: string;
  role: string;
  online: boolean;
  last_seen: string | null;
  expertise: string[];
  topPicks: string[];
  followers: number;
  is_verified: boolean;
  trader_type: string;
}

const TRADER_TYPE_COLORS: Record<string, string> = {
  Value: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Growth: "bg-blue-50 text-blue-700 border-blue-200",
  "Day Trader": "bg-orange-50 text-orange-700 border-orange-200",
  Analyst: "bg-purple-50 text-purple-700 border-purple-200",
};

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function formatFollowers(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

export function PeoplePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [following, setFollowing] = useState<Set<number>>(new Set());
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      fetch(`${API_URL}/people`)
        .then(r => r.json())
        .then((data: UserProfile[]) => {
          setPeople(data.map(p => ({
            ...p,
            online: false,
            expertise: p.role?.split(" ").filter(Boolean) || ["Trading"],
            topPicks: ["SCOM", "EQTY"].slice(0, Math.floor(Math.random() * 2) + 1),
          })));
        })
        .catch(err => console.error("Failed to load people:", err))
        .finally(() => setLoading(false));
      return;
    }

    const socket = connectSocket(user.id, user.full_name);

    const fetchPeople = () => {
      Promise.all([
        fetch(`${API_URL}/people`).then(r => r.json()),
        fetch(`${API_URL}/users/${user.id}/following`).then(r => r.json()).catch(() => []),
      ])
        .then(([peopleData, followingData]) => {
          setPeople(peopleData.map((p: UserProfile) => ({
            ...p,
            expertise: p.role?.split(" ").filter(Boolean) || ["Trading"],
            topPicks: ["SCOM", "EQTY"].slice(0, Math.floor(Math.random() * 2) + 1),
          })));
          setFollowing(new Set(followingData.map((f: { id: number }) => f.id)));
        })
        .catch(err => console.error("Failed to load people:", err))
        .finally(() => setLoading(false));
    };

    // Initial fetch: backend returns online status based on onlineUsers Map
    fetchPeople();

    // Receive full online list when socket connects (before identify_user)
    socket.on("online_users", (ids: number[]) => {
      const onlineSet = new Set(ids.map(Number));
      setPeople(prev => prev.map(p => ({
        ...p,
        online: onlineSet.has(p.id),
      })));
    });
    // Real-time updates as users come online/offline
    socket.on("user_online", (id: number) => {
      setPeople(prev => prev.map(p => p.id === Number(id) ? { ...p, online: true, last_seen: null } : p));
    });
    socket.on("user_offline", (id: number) => {
      setPeople(prev => prev.map(p => p.id === Number(id) ? { ...p, online: false, last_seen: new Date().toISOString() } : p));
    });

    return () => {
      socket.off("online_users");
      socket.off("user_online");
      socket.off("user_offline");
    };
  }, [user?.id]);

  const filteredPeople = people.filter(person => {
    const matchesSearch = person.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (person.role || "").toLowerCase().includes(searchQuery.toLowerCase());
    if (activeFilter === "Online") return matchesSearch && person.online;
    if (activeFilter === "Pro") return matchesSearch && person.is_verified;
    if (activeFilter === "Following") return matchesSearch && following.has(person.id);
    return matchesSearch;
  });

  const toggleFollow = async (id: number) => {
    const wasFollowed = following.has(id);
    setFollowing(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    try {
      const res = await fetch(`${API_URL}/people/${id}/${wasFollowed ? "unfollow" : "follow"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user!.id }),
      });
      if (!res.ok) throw new Error("Request failed");
    } catch (err) {
      setFollowing(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
  };

  const onlineCount = people.filter(p => p.online).length;
  const verifiedCount = people.filter(p => p.is_verified).length;

  const FILTERS = [
    { key: "All", label: "All Members" },
    { key: "Online", label: "Online" },
    { key: "Pro", label: "Verified Pros" },
    { key: "Following", label: `Following (${following.size})` },
  ];

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading community...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Community Directory</h2>
          <p className="text-muted-foreground">Connect with top traders and analysts in the NSE market</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or role..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 w-full md:w-[300px] bg-card border-border" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Users className="w-5 h-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold text-foreground">{people.length}</p><p className="text-xs text-muted-foreground">Total Members</p></div>
          </div>
        </Card>
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Circle className="w-5 h-5 fill-green-500 text-green-500" /></div>
            <div><p className="text-2xl font-bold text-foreground">{onlineCount}</p><p className="text-xs text-muted-foreground">Online Now</p></div>
          </div>
        </Card>
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center"><Medal className="w-5 h-5 text-purple-600" /></div>
            <div><p className="text-2xl font-bold text-foreground">{verifiedCount}</p><p className="text-xs text-muted-foreground">Verified Pros</p></div>
          </div>
        </Card>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map((filter) => (
          <button key={filter.key} onClick={() => setActiveFilter(filter.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeFilter === filter.key ? "bg-[#0D7490] text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-accent"
            }`}>{filter.label}</button>
        ))}
      </div>

      {filteredPeople.length === 0 ? (
        <div className="text-center py-16">
          <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No members found</p>
          <p className="text-muted-foreground text-sm mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredPeople.map((person) => {
            const isFollowed = following.has(person.id);
            return (
              <Card key={person.id} className="p-5 hover:shadow-lg transition-all border-border bg-card group">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Avatar className="w-14 h-14 ring-2 ring-gray-100">
                        <AvatarFallback className="text-xl font-bold text-[#0D7490] bg-muted">{getInitials(person.full_name)}</AvatarFallback>
                      </Avatar>
                      {person.online && <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 border-[3px] border-white rounded-full" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-foreground">{person.full_name}</h3>
                        {person.is_verified && <ShieldCheck className="w-4 h-4 text-blue-500 fill-blue-500/20" />}
                      </div>
                      <p className="text-sm text-muted-foreground">{person.role || "Trader"}</p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">{formatFollowers(person.followers || 0)} followers</p>
                        <span className="text-[10px] text-muted-foreground">{formatLastSeen(person.last_seen, person.online)}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className={`border text-[11px] px-2 py-0.5 ${TRADER_TYPE_COLORS[person.trader_type] || "bg-muted text-muted-foreground border-border"}`}>
                    {person.trader_type || "Trader"}
                  </Badge>
                </div>

                <div className="space-y-3 mb-5">
                  <div className="flex flex-wrap gap-1">
                    {person.expertise.map(exp => (
                      <Badge key={exp} variant="outline" className="text-[10px] uppercase tracking-wider border-border text-muted-foreground">{exp}</Badge>
                    ))}
                  </div>
                  <div className="p-3 bg-gradient-to-r from-muted to-muted/50 rounded-xl border border-border">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                      <TrendingUp className="w-3 h-3 text-green-500" /> HIGH CONVICTION PICKS
                    </div>
                    <div className="flex gap-2">
                      {person.topPicks.map(ticker => (
                        <span key={ticker} className="text-sm font-bold text-foreground bg-card px-2.5 py-0.5 rounded-md border border-border shadow-sm">{ticker}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t border-border">
                  <Button onClick={() => navigate(`/app/chat?person=${person.id}`)} className="flex-1 gap-2 bg-[#0D7490] hover:bg-[#0A5F7A] text-white">
                    <MessageSquare className="w-4 h-4" /> Message
                  </Button>
                  <Button variant="outline" onClick={() => toggleFollow(person.id)}
                    className={`gap-2 transition-all ${
                      isFollowed ? "bg-[#0D7490] text-white border-[#0D7490] hover:bg-[#0A5F7A]" : "border-border hover:border-[#0D7490] hover:text-[#0D7490]"
                    }`}>
                    {isFollowed ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                    {isFollowed ? "Following" : "Follow"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
