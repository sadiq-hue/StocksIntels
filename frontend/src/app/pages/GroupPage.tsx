import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import {
  Plus, Search, Users, TrendingUp, MessageSquare, Trash2, ArrowRight, Hash, Activity, Flame, Circle,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { getSocket, connectSocket, joinGroup, leaveGroup } from "../services/socketService";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

interface Group {
  id: string;
  name: string;
  description: string;
  members: number;
  message_count: number;
  isJoined: boolean;
  topic: string;
  activity_last_hour: number;
  trending: boolean;
  icon: string;
  createdAt?: number;
  online_members: number;
}

const TOPICS = ["All", "General", "Trading", "Finance", "Technology", "Telecom", "Income"];
const GROUP_ICONS = ["📊", "📱", "🏦", "💻", "💰", "⚡", "🎯", "🚀", "📈", "🏭"];

export function GroupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"members" | "activity" | "newest">("activity");
  const [activeTopic, setActiveTopic] = useState("All");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupTopic, setNewGroupTopic] = useState("");
  const [newGroupIcon, setNewGroupIcon] = useState("🎯");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());

  useEffect(() => {
    const params = user?.id ? `?userId=${user.id}` : "";
    fetch(`${API_URL}/groups${params}`)
      .then(r => r.json())
      .then(data => {
        setGroups(data);
      })
      .catch(err => console.error("Failed to load groups:", err))
      .finally(() => setLoading(false));

    if (!user?.id) return;

    const socket = connectSocket(user.id, user.full_name);

    socket.on("online_users", (ids: number[]) => {
      setOnlineUsers(new Set(ids.map(Number)));
    });
    socket.on("user_online", (id: number) => {
      setOnlineUsers(prev => new Set(prev).add(Number(id)));
    });
    socket.on("user_offline", (id: number) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        next.delete(Number(id));
        return next;
      });
    });

    socket.on("group_member_joined", ({ groupId, userId }: { groupId: string; userId: number }) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, members: g.members + 1, online_members: onlineUsers.has(userId) ? g.online_members + 1 : g.online_members }
            : g
        )
      );
    });

    socket.on("group_member_left", ({ groupId, userId }: { groupId: string; userId: number }) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, members: Math.max(0, g.members - 1), online_members: onlineUsers.has(userId) ? Math.max(0, g.online_members - 1) : g.online_members }
            : g
        )
      );
    });

    return () => {
      socket.off("online_users");
      socket.off("user_online");
      socket.off("user_offline");
      socket.off("group_member_joined");
      socket.off("group_member_left");
    };
  }, [user?.id]);

  const filteredGroups = groups
    .filter((g) => {
      const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTopic = activeTopic === "All" || g.topic === activeTopic;
      return matchesSearch && matchesTopic;
    })
    .sort((a, b) => {
      if (sortBy === "members") return b.members - a.members;
      if (sortBy === "activity") return b.activity_last_hour - a.activity_last_hour;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

  const joinedGroups = groups.filter((g) => g.isJoined);
  const onlineMembers = groups.reduce((sum, g) => sum + (g.online_members || 0), 0);
  const totalMembers = groups.reduce((sum, g) => sum + g.members, 0);

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

  const handleCreateGroup = () => {
    if (!newGroupName.trim() || !newGroupDesc.trim()) return;
    const newGroup: Group = {
      id: newGroupName.toLowerCase().replace(/\s+/g, "-"),
      name: newGroupName,
      description: newGroupDesc,
      members: 1,
      message_count: 0,
      isJoined: true,
      topic: newGroupTopic || "General",
      activity_last_hour: 0,
      trending: false,
      icon: newGroupIcon,
      createdAt: Date.now(),
    };
    setGroups((prev) => [newGroup, ...prev]);
    fetch(`${API_URL}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newGroup),
    }).then(() => {
      if (user?.id) {
        joinGroup(newGroup.id);
        fetch(`${API_URL}/groups/${newGroup.id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
      }
    }).catch(() => {});
    setNewGroupName("");
    setNewGroupDesc("");
    setNewGroupTopic("");
    setNewGroupIcon("🎯");
    setShowCreateDialog(false);
  };

  const handleNavigateToChat = (groupId: string) => {
    navigate(`/app/chat?group=${groupId}`);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500">Loading groups...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-3xl font-bold mb-2">Trading Groups</h1>
        <p className="text-gray-600">Join communities connected by market interests and trading strategies</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Users className="w-5 h-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold text-gray-900">{groups.length}</p><p className="text-xs text-gray-500">Total Groups</p></div>
          </div>
        </Card>
        <Card className="p-4 border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Users className="w-5 h-5 text-green-600" /></div>
            <div><p className="text-2xl font-bold text-gray-900">{totalMembers.toLocaleString()}</p><p className="text-xs text-gray-500">Total Members</p></div>
          </div>
        </Card>
        <Card className="p-4 border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Circle className="w-5 h-5 fill-green-500 text-green-500" /></div>
            <div><p className="text-2xl font-bold text-gray-900">{onlineMembers}</p><p className="text-xs text-gray-500">Online Now</p></div>
          </div>
        </Card>
        <Card className="p-4 border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><Flame className="w-5 h-5 text-red-600" /></div>
            <div><p className="text-2xl font-bold text-gray-900">{groups.filter(g => g.trending).length}</p><p className="text-xs text-gray-500">Trending Now</p></div>
          </div>
        </Card>
      </div>

      {/* Search & Create */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <Input placeholder="Search groups..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 bg-white border-gray-200 h-11" />
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
              className="px-4 h-11 border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
              <option value="activity">By Activity</option>
              <option value="members">By Members</option>
              <option value="newest">Newest First</option>
            </select>
          </div>
          <div className="flex gap-2 flex-wrap">
            {TOPICS.map((topic) => (
              <button key={topic} onClick={() => setActiveTopic(topic)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  activeTopic === topic ? "bg-[#0D7490] text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}>{topic === "All" ? "All Topics" : topic}</button>
            ))}
          </div>
        </div>
        <div className="flex items-end">
          <Button onClick={() => setShowCreateDialog(true)} className="w-full bg-[#0D7490] hover:bg-[#0A5F7A] text-white h-11 gap-2">
            <Plus className="w-4 h-4" /> Create New Group
          </Button>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Group</DialogTitle>
            <DialogDescription>Set up a new trading group for your community</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Icon</label>
              <div className="flex gap-2 flex-wrap">
                {GROUP_ICONS.map((icon) => (
                  <button key={icon} type="button" onClick={() => setNewGroupIcon(icon)}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                      newGroupIcon === icon ? "bg-[#0D7490] ring-2 ring-[#0D7490]/30 scale-110" : "bg-gray-100 hover:bg-gray-200"
                    }`}>{icon}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Group Name</label>
              <Input placeholder="e.g., Growth Stocks Investors" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="bg-white border-gray-200" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Description</label>
              <textarea placeholder="What's this group about?" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-gray-700 min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490]" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Topic</label>
              <select value={newGroupTopic} onChange={(e) => setNewGroupTopic(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white text-gray-700 cursor-pointer">
                <option value="">Select a topic</option>
                {TOPICS.filter(t => t !== "All").map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="border-gray-200">Cancel</Button>
            <Button onClick={handleCreateGroup} disabled={!newGroupName.trim() || !newGroupDesc.trim()}
              className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white disabled:opacity-50">Create Group</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div>
          <h2 className="text-gray-900 font-bold text-lg mb-4 flex items-center gap-2">
            <Hash className="w-5 h-5 text-[#0D7490]" /> My Portfolio Groups <span className="text-sm font-normal text-gray-500">({joinedGroups.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {joinedGroups.length === 0 ? (
              <Card className="p-8 border-dashed border-2 flex flex-col items-center justify-center text-center bg-gray-50/50">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3"><Users className="w-6 h-6 text-gray-300" /></div>
                <p className="text-gray-500 text-sm font-medium">No groups joined yet</p>
                <p className="text-gray-400 text-xs mt-1 mb-4">Browse and join groups below</p>
                <Button variant="outline" size="sm" onClick={() => setActiveTopic("All")} className="border-gray-200 text-gray-600">Browse All Groups</Button>
              </Card>
            ) : (
              joinedGroups.map((group) => (
                <Card key={group.id} className="p-3 border-gray-200 hover:border-[#0D7490] hover:shadow-md transition-all group">
                  <div className="flex items-center justify-between" onClick={() => handleNavigateToChat(group.id)}>
                    <div className="flex items-center gap-3 cursor-pointer">
                      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-xl border border-gray-100">{group.icon}</div>
                      <div>
                        <p className="font-semibold text-sm text-gray-900">{group.name}</p>
                        <p className="text-xs text-gray-500">{group.members} members · {group.online_members || 0} online</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 cursor-pointer group-hover:text-[#0D7490] transition-colors" />
                  </div>
                  <button onClick={() => handleLeaveGroup(group.id)}
                    className="mt-2 w-full text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1">
                    <Trash2 className="w-3 h-3" /> Leave Group
                  </button>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-gray-900 font-semibold mb-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-400" /> All Groups <span className="text-sm font-normal text-gray-500">({filteredGroups.length})</span>
          </h2>
          {filteredGroups.length === 0 ? (
            <div className="text-center py-16">
              <Search className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No groups match your search</p>
              <p className="text-gray-400 text-sm mt-1">Try a different search or topic filter</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredGroups.map((group) => (
                <Card key={group.id} className={`bg-white border hover:shadow-lg transition-all p-4 flex flex-col ${
                  group.trending ? "hover:border-[#0D7490]" : "border-gray-200 hover:border-gray-300"
                } ${group.isJoined ? "ring-1 ring-[#0D7490]/10" : ""}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center text-2xl border border-gray-100">{group.icon}</div>
                      <div>
                        <h3 className="text-gray-900 font-semibold">{group.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-gray-200 text-gray-500">{group.topic}</Badge>
                          {group.trending && (
                            <Badge className="bg-gradient-to-r from-red-500 to-orange-500 text-white border-0 text-[10px] px-1.5 py-0">
                              <Flame className="w-2.5 h-2.5 mr-0.5" /> Trending
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm mb-4 flex-1 line-clamp-2">{group.description}</p>
                  <div className="grid grid-cols-4 gap-2 mb-4 py-3 border-y border-gray-100">
                    <div className="text-center"><p className="text-lg font-bold text-gray-900">{group.members}</p><p className="text-[11px] text-gray-500">Members</p></div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-600 flex items-center justify-center gap-1">
                        <Circle className="w-3 h-3 fill-green-500 text-green-500" />{group.online_members || 0}
                      </p>
                      <p className="text-[11px] text-gray-500">Online</p>
                    </div>
                    <div className="text-center"><p className="text-lg font-bold text-gray-900">{group.activity_last_hour}</p><p className="text-[11px] text-gray-500">Active/hr</p></div>
                    <div className="text-center"><p className="text-lg font-bold text-gray-900">{group.message_count?.toLocaleString() || 0}</p><p className="text-[11px] text-gray-500">Messages</p></div>
                  </div>
                  <div className="flex gap-2">
                    {group.isJoined ? (
                      <>
                        <Button onClick={() => handleNavigateToChat(group.id)} className="flex-1 bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                          <MessageSquare className="w-4 h-4" /> Chat
                        </Button>
                        <Button onClick={() => handleLeaveGroup(group.id)} variant="outline" className="px-3 text-red-600 hover:bg-red-50 border-red-200 hover:border-red-300 gap-1.5">
                          <Trash2 className="w-4 h-4" /> Leave
                        </Button>
                      </>
                    ) : (
                      <Button onClick={() => handleJoinGroup(group.id)} className="w-full bg-white hover:bg-[#0D7490] hover:text-white text-[#0D7490] border border-[#0D7490] transition-all">
                        <Plus className="w-4 h-4 mr-2" /> Join Group
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
