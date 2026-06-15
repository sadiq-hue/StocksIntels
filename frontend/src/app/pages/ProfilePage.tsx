import { useState, useEffect } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { User, Mail, Save, BadgeCheck, Shield, Lock, Loader2 } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { Badge } from "../components/ui/badge";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export function ProfilePage() {
  const { user, logout } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [memberSince, setMemberSince] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name);
    setEmail(user.email);
    fetch(`${API_URL}/users/${user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.created_at) {
          setMemberSince(new Date(data.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }));
        }
      })
      .catch(() => {});
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, string> = { full_name: fullName, email };
      if (password.trim()) body.password = password;
      const res = await fetch(`${API_URL}/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update profile");
      }
      setMessage({ type: "success", text: "Profile updated successfully" });
      setPassword("");
      localStorage.setItem("stockintel_user", JSON.stringify({ ...user, full_name: fullName, email }));
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
        <Card className="bg-card border-border p-8 text-center">
          <p className="text-muted-foreground">Please log in to view your profile.</p>
        </Card>
      </div>
    );
  }

  const TRADER_BADGES: Record<string, { label: string; color: string }> = {
    Value: { label: "Value Investor", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    Growth: { label: "Growth Investor", color: "bg-blue-100 text-blue-700 border-blue-200" },
    Momentum: { label: "Momentum Trader", color: "bg-purple-100 text-purple-700 border-purple-200" },
    Dividend: { label: "Dividend Hunter", color: "bg-amber-100 text-amber-700 border-amber-200" },
  };

  const badge = user.trader_type ? TRADER_BADGES[user.trader_type] : null;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h2 className="text-foreground text-2xl mb-1">Profile</h2>
        <p className="text-muted-foreground">Manage your account details and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border p-6">
            <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-[#0D7490]" />
              Personal Information
            </h3>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Full Name</label>
                <Input value={fullName} onChange={e => setFullName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Email</label>
                <Input value={email} onChange={e => setEmail(e.target.value)} type="email" />
              </div>
            </div>
          </Card>

          <Card className="bg-card border-border p-6">
            <h3 className="text-foreground font-semibold mb-4 flex items-center gap-2">
              <Lock className="w-5 h-5 text-[#0D7490]" />
              Change Password
            </h3>
            <div className="max-w-md">
              <label className="block text-sm text-muted-foreground mb-1">New Password (min 8 chars)</label>
              <Input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Leave blank to keep current" />
            </div>
          </Card>

          {message && (
            <div className={`p-3 rounded-lg text-sm ${message.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
              {message.text}
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="bg-[#0D7490] text-white hover:bg-[#0D7490]/90">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border p-6">
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-[#0D7490]/10 flex items-center justify-center mb-3">
                <User className="w-10 h-10 text-[#0D7490]" />
              </div>
              <h3 className="text-foreground font-semibold text-lg">{user.full_name}</h3>
              <p className="text-muted-foreground text-sm flex items-center gap-1 mt-1">
                <Mail className="w-3 h-3" />
                {user.email}
              </p>
              {memberSince && <p className="text-muted-foreground text-xs mt-2">Member since {memberSince}</p>}
              <div className="flex flex-wrap justify-center gap-2 mt-4">
                {user.is_verified && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                    <BadgeCheck className="w-3 h-3 mr-1" /> Verified
                  </Badge>
                )}
                {user.role === "admin" && (
                  <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                    <Shield className="w-3 h-3 mr-1" /> Admin
                  </Badge>
                )}
                {badge && (
                  <Badge className={badge.color}>{badge.label}</Badge>
                )}
              </div>
            </div>
          </Card>

          <Card className="bg-card border-border p-6">
            <Button onClick={logout} variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50">
              Sign Out
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
