import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../components/ui/dialog";
import {
  Plus, Search, Users, TrendingUp, MessageSquare, Trash2, ArrowRight, Hash, Activity, Flame, Circle,
  ArrowLeft, Shield, Crown, UserCheck, BarChart3, TrendingDown, ChevronRight
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { getSocket, connectSocket, joinGroup, leaveGroup } from "../services/socketService";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface Group {
  id: string;
  name: string;
  description: string;
  members: number;
  message_count: number;
  isJoined: boolean;
  isAdmin: boolean;
  created_by?: number;
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
  const { user, apiFetch } = useAuth();
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
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    const params = user?.id ? `?userId=${user.id}` : "";
    apiFetch(`/groups${params}`)
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

  // Load group members when a group is selected
  useEffect(() => {
    if (!selectedGroup) return;
    setLoadingMembers(true);
    apiFetch(`/groups/${selectedGroup.id}/members`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setGroupMembers(Array.isArray(data) ? data : []))
      .catch(() => setGroupMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [selectedGroup?.id]);

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
    if (selectedGroup?.id === groupId) {
      setSelectedGroup((prev) => prev ? { ...prev, isJoined: true } : null);
    }
    joinGroup(groupId);
    const res = await apiFetch(`/groups/${groupId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) {
      setGroups(prev);
      if (selectedGroup?.id === groupId) {
        setSelectedGroup((prev) => prev ? { ...prev, isJoined: false } : null);
      }
      leaveGroup(groupId);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    if (!user?.id) return;
    const prev = groups;
    setGroups((cur) => cur.map((g) => (g.id === groupId ? { ...g, isJoined: false } : g)));
    if (selectedGroup?.id === groupId) {
      setSelectedGroup((prev) => prev ? { ...prev, isJoined: false } : null);
    }
    leaveGroup(groupId);
    const res = await apiFetch(`/groups/${groupId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!res.ok) {
      setGroups(prev);
      if (selectedGroup?.id === groupId) {
        setSelectedGroup((prev) => prev ? { ...prev, isJoined: true } : null);
      }
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
      isAdmin: true,
      created_by: user?.id,
      topic: newGroupTopic || "General",
      activity_last_hour: 0,
      trending: false,
      icon: newGroupIcon,
      createdAt: Date.now(),
    };
    setGroups((prev) => [newGroup, ...prev]);
    apiFetch(`/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newGroup, created_by: user?.id }),
    }).then(() => {
      if (user?.id) {
        joinGroup(newGroup.id);
        apiFetch(`/groups/${newGroup.id}/join`, {
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

  const handleDeleteGroup = async (groupId: string) => {
    if (!user?.id) return;
    const prev = groups;
    setGroups((cur) => cur.filter((g) => g.id !== groupId));
    setSelectedGroup(null);
    const res = await apiFetch(`/admin/groups/${groupId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      setGroups(prev);
    }
  };

  const handleSelectGroup = (group: Group) => {
    setSelectedGroup(group);
  };

  const handleBackToBrowse = () => {
    setSelectedGroup(null);
  };

  const handleNavigateToChat = (groupId: string) => {
    navigate(`/app/chat?group=${groupId}`);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading groups...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl md:text-3xl font-bold mb-2">Trading Groups</h1>
          <p className="text-muted-foreground">Join communities connected by market interests and trading strategies</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
          <Plus className="w-4 h-4" /> Create Group
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center"><Users className="w-5 h-5 text-blue-600" /></div>
            <div><p className="text-2xl font-bold text-foreground">{groups.length}</p><p className="text-xs text-muted-foreground">Total Groups</p></div>
          </div>
        </Card>
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Users className="w-5 h-5 text-green-600" /></div>
            <div><p className="text-2xl font-bold text-foreground">{totalMembers.toLocaleString()}</p><p className="text-xs text-muted-foreground">Total Members</p></div>
          </div>
        </Card>
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center"><Circle className="w-5 h-5 fill-green-500 text-green-500" /></div>
            <div><p className="text-2xl font-bold text-foreground">{onlineMembers}</p><p className="text-xs text-muted-foreground">Online Now</p></div>
          </div>
        </Card>
        <Card className="p-4 border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><Flame className="w-5 h-5 text-red-600" /></div>
            <div><p className="text-2xl font-bold text-foreground">{groups.filter(g => g.trending).length}</p><p className="text-xs text-muted-foreground">Trending Now</p></div>
          </div>
        </Card>
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
              <label className="text-sm font-medium text-foreground mb-2 block">Icon</label>
              <div className="flex gap-2 flex-wrap">
                {GROUP_ICONS.map((icon) => (
                  <button key={icon} type="button" onClick={() => setNewGroupIcon(icon)}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                      newGroupIcon === icon ? "bg-[#0D7490] ring-2 ring-[#0D7490]/30 scale-110" : "bg-muted hover:bg-accent"
                    }`}>{icon}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Group Name</label>
              <Input placeholder="e.g., Growth Stocks Investors" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="bg-card border-border" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Description</label>
              <textarea placeholder="What's this group about?" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-[#0D7490]/20 focus:border-[#0D7490]" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Topic</label>
              <select value={newGroupTopic} onChange={(e) => setNewGroupTopic(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-foreground cursor-pointer">
                <option value="">Select a topic</option>
                {TOPICS.filter(t => t !== "All").map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="border-border">Cancel</Button>
            <Button onClick={handleCreateGroup} disabled={!newGroupName.trim() || !newGroupDesc.trim()}
              className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white disabled:opacity-50">Create Group</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── GROUP DETAIL VIEW ─────────────────────────────────────────────── */}
      {selectedGroup ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Group Info + Actions */}
          <div className="lg:col-span-2 space-y-6">
            {/* Back + Header */}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={handleBackToBrowse} className="border-border text-muted-foreground gap-1">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              {selectedGroup.isAdmin && (
                <Badge className="bg-amber-100 text-amber-700 border-0 gap-1">
                  <Crown className="w-3 h-3" /> Admin
                </Badge>
              )}
              {selectedGroup.trending && (
                <Badge className="bg-gradient-to-r from-red-500 to-orange-500 text-white border-0 gap-1">
                  <Flame className="w-3 h-3" /> Trending
                </Badge>
              )}
            </div>

            {/* Group Header Card */}
            <Card className="border-border p-6">
              <div className="flex flex-wrap items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-3xl border border-border shrink-0">
                  {selectedGroup.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold text-foreground">{selectedGroup.name}</h2>
                  <p className="text-muted-foreground mt-1">{selectedGroup.description}</p>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <Badge variant="outline" className="text-xs border-border text-muted-foreground">{selectedGroup.topic}</Badge>
                    <span className="text-xs text-muted-foreground">{selectedGroup.members} members</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <Circle className="w-2 h-2 fill-green-500" />{selectedGroup.online_members || 0} online
                    </span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4 border-border text-center">
                <p className="text-2xl font-bold text-foreground">{selectedGroup.members}</p>
                <p className="text-xs text-muted-foreground mt-1">Members</p>
              </Card>
              <Card className="p-4 border-border text-center">
                <p className="text-2xl font-bold text-green-600 flex items-center justify-center gap-1">
                  <Circle className="w-3 h-3 fill-green-500" />{selectedGroup.online_members || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Online</p>
              </Card>
              <Card className="p-4 border-border text-center">
                <p className="text-2xl font-bold text-foreground">{selectedGroup.activity_last_hour}</p>
                <p className="text-xs text-muted-foreground mt-1">Active/hr</p>
              </Card>
              <Card className="p-4 border-border text-center">
                <p className="text-2xl font-bold text-foreground">{selectedGroup.message_count?.toLocaleString() || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">Messages</p>
              </Card>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              {selectedGroup.isJoined ? (
                <>
                  <Button onClick={() => handleNavigateToChat(selectedGroup.id)} className="flex-1 bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2 h-11">
                    <MessageSquare className="w-4 h-4" /> Open Chat
                  </Button>
                  <Button onClick={() => handleLeaveGroup(selectedGroup.id)} variant="outline" className="px-4 h-11 text-red-600 hover:bg-red-50 border-red-200 hover:border-red-300 gap-2">
                    <Trash2 className="w-4 h-4" /> Leave
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleJoinGroup(selectedGroup.id)} className="flex-1 bg-card hover:bg-[#0D7490] hover:text-white text-[#0D7490] border border-[#0D7490] transition-all h-11 gap-2">
                  <Plus className="w-4 h-4" /> Join Group
                </Button>
              )}
              {selectedGroup.isAdmin && (
                <Button onClick={() => handleDeleteGroup(selectedGroup.id)} variant="outline" className="px-4 h-11 text-rose-600 hover:bg-rose-50 border-rose-200 hover:border-rose-300 gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </Button>
              )}
            </div>
          </div>

          {/* Right: Members */}
          <div>
            <Card className="border-border p-4">
              <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#0D7490]" /> Members
                <span className="text-xs text-muted-foreground font-normal">({groupMembers.length})</span>
              </h3>
              {loadingMembers ? (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">Loading members...</p>
                </div>
              ) : groupMembers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">No members yet</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {groupMembers.map((member: any) => (
                    <div key={member.id} className="flex items-center gap-3">
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
                          {member.is_verified && <Badge className="bg-blue-50 text-blue-600 border-0 text-[9px] px-1 py-0">Verified</Badge>}
                        </p>
                      </div>
                      {member.role && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-border text-muted-foreground shrink-0">
                          {member.role}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : (
        /* ── BROWSE VIEW ─────────────────────────────────────────────────── */
        <>
          {/* Search & Filters */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                  <Input placeholder="Search groups..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10 bg-card border-border h-11" />
                </div>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-4 h-11 border border-border rounded-lg bg-card text-foreground hover:bg-accent transition-colors cursor-pointer">
                  <option value="activity">By Activity</option>
                  <option value="members">By Members</option>
                  <option value="newest">Newest First</option>
                </select>
              </div>
              <div className="flex gap-2 flex-wrap">
                {TOPICS.map((topic) => (
                  <button key={topic} onClick={() => setActiveTopic(topic)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                      activeTopic === topic ? "bg-[#0D7490] text-white shadow-sm" : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}>{topic === "All" ? "All Topics" : topic}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* My Groups */}
            <div>
              <h2 className="text-foreground font-bold text-lg mb-4 flex items-center gap-2">
                <Hash className="w-5 h-5 text-[#0D7490]" /> My Groups <span className="text-sm font-normal text-muted-foreground">({joinedGroups.length})</span>
              </h2>
              <div className="grid grid-cols-1 gap-3">
                {joinedGroups.length === 0 ? (
                  <Card className="p-8 border-dashed border-2 flex flex-col items-center justify-center text-center bg-muted/50">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3"><Users className="w-6 h-6 text-muted-foreground" /></div>
                    <p className="text-muted-foreground text-sm font-medium">No groups joined yet</p>
                    <p className="text-muted-foreground text-xs mt-1 mb-4">Browse and join groups below</p>
                    <Button variant="outline" size="sm" onClick={() => setActiveTopic("All")} className="border-border text-muted-foreground">Browse All Groups</Button>
                  </Card>
                ) : (
                  joinedGroups.map((group) => (
                    <Card key={group.id} className="p-3 border-border hover:border-[#0D7490] hover:shadow-md transition-all group cursor-pointer"
                      onClick={() => handleSelectGroup(group)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-xl border border-border">{group.icon}</div>
                          <div>
                            <p className="font-semibold text-sm text-foreground">{group.name}</p>
                            <p className="text-xs text-muted-foreground">{group.members} members · {group.online_members || 0} online</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-[#0D7490] transition-colors" />
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>

            {/* All Groups */}
            <div className="lg:col-span-2">
              <h2 className="text-foreground font-semibold mb-4 flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" /> All Groups <span className="text-sm font-normal text-muted-foreground">({filteredGroups.length})</span>
              </h2>
              {filteredGroups.length === 0 ? (
                <div className="text-center py-16">
                  <Search className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No groups match your search</p>
                  <p className="text-muted-foreground text-sm mt-1">Try a different search or topic filter</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredGroups.map((group) => (
                    <Card key={group.id} className={`bg-card border hover:shadow-lg transition-all p-4 flex flex-col cursor-pointer ${
                      group.trending ? "hover:border-[#0D7490]" : "border-border hover:border-border"
                    } ${group.isJoined ? "ring-1 ring-[#0D7490]/10" : ""}`}
                      onClick={() => handleSelectGroup(group)}>
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl border border-border">{group.icon}</div>
                          <div>
                            <h3 className="text-foreground font-semibold">{group.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border text-muted-foreground">{group.topic}</Badge>
                              {group.trending && (
                                <Badge className="bg-gradient-to-r from-red-500 to-orange-500 text-white border-0 text-[10px] px-1.5 py-0">
                                  <Flame className="w-2.5 h-2.5 mr-0.5" /> Trending
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <p className="text-muted-foreground text-sm mb-4 flex-1 line-clamp-2">{group.description}</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 py-3 border-y border-border">
                        <div className="text-center"><p className="text-lg font-bold text-foreground">{group.members}</p><p className="text-[11px] text-muted-foreground">Members</p></div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-green-600 flex items-center justify-center gap-1">
                            <Circle className="w-3 h-3 fill-green-500 text-green-500" />{group.online_members || 0}
                          </p>
                          <p className="text-[11px] text-muted-foreground">Online</p>
                        </div>
                        <div className="text-center"><p className="text-lg font-bold text-foreground">{group.activity_last_hour}</p><p className="text-[11px] text-muted-foreground">Active/hr</p></div>
                        <div className="text-center"><p className="text-lg font-bold text-foreground">{group.message_count?.toLocaleString() || 0}</p><p className="text-[11px] text-muted-foreground">Messages</p></div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2" onClick={(e) => e.stopPropagation()}>
                        {group.isJoined ? (
                          <>
                            <Button onClick={() => handleNavigateToChat(group.id)} className="flex-1 bg-[#0D7490] hover:bg-[#0A5F7A] text-white gap-2">
                              <MessageSquare className="w-4 h-4" /> Chat
                            </Button>
                            <Button onClick={() => handleLeaveGroup(group.id)} variant="outline" className="flex-1 sm:flex-none px-3 text-red-600 hover:bg-red-50 border-red-200 hover:border-red-300 gap-1.5">
                              <Trash2 className="w-4 h-4" /> Leave
                            </Button>
                          </>
                        ) : (
                          <Button onClick={() => handleJoinGroup(group.id)} className="w-full bg-card hover:bg-[#0D7490] hover:text-white text-[#0D7490] border border-[#0D7490] transition-all">
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
        </>
      )}
    </div>
  );
}
