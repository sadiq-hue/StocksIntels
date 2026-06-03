import { useState, useEffect, useRef } from "react";
import { Card } from "../components/ui/card";
import { 
  Bell, Shield, User, Palette, Database, Check, Loader2, Eye, EyeOff, 
  Trash2, Download, Camera, MapPin, Briefcase, Globe, Info 
} from "lucide-react";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface NotificationSettings {
  priceAlerts: boolean;
  tradingSignals: boolean;
  marketNews: boolean;
  portfolioUpdates: boolean;
  chatMessages: boolean;
}

interface AppearanceSettings {
  darkMode: boolean;
  compactView: boolean;
}

export function SettingsPage() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState("profile");
  
  const [profile, setProfile] = useState({
    full_name: user?.full_name || "",
    email: user?.email || "",
    phone: "",
    bio: "",
    location: "",
    trader_type: user?.trader_type || "",
    experience: "",
    avatar: "",
  });
  const [originalProfile, setOriginalProfile] = useState({ ...profile });
  const [loading, setLoading] = useState(false);

  const hasProfileChanges = JSON.stringify(profile) !== JSON.stringify(originalProfile);
  
  const [notifications, setNotifications] = useState<NotificationSettings>({
    priceAlerts: true,
    tradingSignals: true,
    marketNews: true,
    portfolioUpdates: true,
    chatMessages: false,
  });
  
  const [appearance, setAppearance] = useState<AppearanceSettings>({
    darkMode: true,
    compactView: false,
  });
  
  const [security, setSecurity] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  
  const [privacy, setPrivacy] = useState({
    dataVisibility: "public",
    allowAnalytics: true,
    showPortfolio: true,
  });
  
  const [saving, setSaving] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchProfileData = async () => {
      setLoading(true);
      try {
        if (user?.id) {
          const res = await fetch(`${API_BASE_URL}/users/${user.id}`);
          if (res.ok) {
            const data = await res.json();
            setProfile(prev => ({ ...prev, ...data }));
            setOriginalProfile(prev => ({ ...prev, ...data }));
          }
        }
        const saved = localStorage.getItem("userProfile");
        if (saved) {
          const data = JSON.parse(saved);
          setProfile(prev => ({ ...prev, ...data }));
          setOriginalProfile(prev => ({ ...prev, ...data }));
        }
      } catch (err) {
        console.error("Failed to load profile", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfileData();
  }, [user?.id]);

  const handleSaveProfile = async () => {
    if (!profile.full_name.trim()) {
      toast.error("Full name is required");
      return;
    }
    if (!profile.email.trim() || !profile.email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSaving(true);
    try {
      if (user?.id) {
        const res = await fetch(`${API_BASE_URL}/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profile),
        });
        if (!res.ok) throw new Error("Failed to save");
      }
      localStorage.setItem("userProfile", JSON.stringify(profile));
      setOriginalProfile({ ...profile });
      toast.success("Profile changes saved successfully");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error("Image must be smaller than 2MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile({ ...profile, avatar: reader.result as string });
        toast.success("Avatar updated");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleNotificationChange = async (key: keyof NotificationSettings, value: boolean) => {
    const updated = { ...notifications, [key]: value };
    setNotifications(updated);
    try {
      localStorage.setItem("notificationSettings", JSON.stringify(updated));
      toast.success(`${key.replace(/([A-Z])/g, ' $1').trim()} notification ${value ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to update notification settings");
      setNotifications(notifications);
    }
  };

  const handleAppearanceChange = async (key: keyof AppearanceSettings, value: boolean) => {
    const updated = { ...appearance, [key]: value };
    setAppearance(updated);
    try {
      localStorage.setItem("appearanceSettings", JSON.stringify(updated));
      toast.success(`${key === "darkMode" ? "Dark mode" : "Compact view"} ${value ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to update appearance settings");
      setAppearance(appearance);
    }
  };

  const handlePasswordChange = async () => {
    if (!security.currentPassword) {
      toast.error("Current password is required");
      return;
    }
    if (!security.newPassword) {
      toast.error("New password is required");
      return;
    }
    if (security.newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (security.newPassword !== security.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success("Password changed successfully");
      setSecurity({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch {
      toast.error("Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  const handlePrivacyChange = async (key: keyof typeof privacy, value: string | boolean) => {
    const updated = { ...privacy, [key]: value };
    setPrivacy(updated);
    try {
      localStorage.setItem("privacySettings", JSON.stringify(updated));
      toast.success("Privacy settings updated");
    } catch {
      toast.error("Failed to update privacy settings");
      setPrivacy(privacy);
    }
  };

  const handleExportData = () => {
    const userData = {
      profile,
      notifications,
      privacy,
      exportDate: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(userData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stockintel-data-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Data exported successfully");
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm("Are you sure you want to delete your account? This action cannot be undone.");
    if (confirmed) {
      toast.error("Account deletion initiated. Please contact support to complete the process.");
    }
  };

  const sections = [
    { icon: User, label: "Profile", id: "profile" },
    { icon: Bell, label: "Notifications", id: "notifications" },
    { icon: Shield, label: "Security", id: "security" },
    { icon: Palette, label: "Appearance", id: "appearance" },
    { icon: Database, label: "Data & Privacy", id: "privacy" },
  ];

  const renderSection = () => {
    switch (activeSection) {
      case "profile":
        return (
          <Card className="bg-white border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="w-6 h-6 text-[#0D7490]" />
              <h3 className="text-gray-900 text-xl">Profile Settings</h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-gray-700 text-sm mb-2 block">Full Name</label>
                <Input
                  value={profile.full_name}
                  onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                  className="bg-white border-gray-200 text-gray-900"
                />
              </div>

              <div>
                <label className="text-gray-700 text-sm mb-2 block">Email</label>
                <Input
                  value={profile.email}
                  onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  type="email"
                  className="bg-white border-gray-200 text-gray-900"
                />
              </div>

              <div>
                <label className="text-gray-700 text-sm mb-2 block">Phone Number</label>
                <Input
                  value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  className="bg-white border-gray-200 text-gray-900"
                />
              </div>

              <Button 
                onClick={handleSaveProfile}
                disabled={saving || !hasProfileChanges}
                className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </Card>
        );

      case "notifications":
        return (
          <Card className="bg-white border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Bell className="w-6 h-6 text-[#0D7490]" />
              <h3 className="text-gray-900 text-xl">Notification Preferences</h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Price Alerts</div>
                  <div className="text-gray-600 text-sm">Get notified when stocks hit target prices</div>
                </div>
                <Switch 
                  checked={notifications.priceAlerts}
                  onCheckedChange={(checked) => handleNotificationChange("priceAlerts", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Trading Signals</div>
                  <div className="text-gray-600 text-sm">Receive AI-generated trading signals</div>
                </div>
                <Switch 
                  checked={notifications.tradingSignals}
                  onCheckedChange={(checked) => handleNotificationChange("tradingSignals", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Market News</div>
                  <div className="text-gray-600 text-sm">Stay updated with NSE news</div>
                </div>
                <Switch 
                  checked={notifications.marketNews}
                  onCheckedChange={(checked) => handleNotificationChange("marketNews", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Portfolio Updates</div>
                  <div className="text-gray-600 text-sm">Daily portfolio performance summary</div>
                </div>
                <Switch 
                  checked={notifications.portfolioUpdates}
                  onCheckedChange={(checked) => handleNotificationChange("portfolioUpdates", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Chat Messages</div>
                  <div className="text-gray-600 text-sm">Notifications from trading groups</div>
                </div>
                <Switch 
                  checked={notifications.chatMessages}
                  onCheckedChange={(checked) => handleNotificationChange("chatMessages", checked)}
                />
              </div>
            </div>
          </Card>
        );

      case "security":
        return (
          <Card className="bg-white border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Shield className="w-6 h-6 text-[#0D7490]" />
              <h3 className="text-gray-900 text-xl">Security Settings</h3>
            </div>

            <div className="space-y-6">
              <div>
                <h4 className="text-gray-900 font-medium mb-4">Change Password</h4>
                <div className="space-y-4">
                  <div>
                    <label className="text-gray-700 text-sm mb-2 block">Current Password</label>
                    <div className="relative">
                      <Input
                        type={showCurrentPassword ? "text" : "password"}
                        value={security.currentPassword}
                        onChange={(e) => setSecurity({ ...security, currentPassword: e.target.value })}
                        className="bg-white border-gray-200 text-gray-900 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      >
                        {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-700 text-sm mb-2 block">New Password</label>
                    <div className="relative">
                      <Input
                        type={showNewPassword ? "text" : "password"}
                        value={security.newPassword}
                        onChange={(e) => setSecurity({ ...security, newPassword: e.target.value })}
                        className="bg-white border-gray-200 text-gray-900 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-gray-700 text-sm mb-2 block">Confirm New Password</label>
                    <Input
                      type="password"
                      value={security.confirmPassword}
                      onChange={(e) => setSecurity({ ...security, confirmPassword: e.target.value })}
                      className="bg-white border-gray-200 text-gray-900"
                    />
                  </div>

                  <Button 
                    onClick={handlePasswordChange}
                    disabled={saving}
                    className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      "Update Password"
                    )}
                  </Button>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h4 className="text-gray-900 font-medium mb-2">Two-Factor Authentication</h4>
                <p className="text-gray-600 text-sm mb-4">Add an extra layer of security to your account</p>
                <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50">
                  Enable 2FA
                </Button>
              </div>
            </div>
          </Card>
        );

      case "appearance":
        return (
          <Card className="bg-white border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Palette className="w-6 h-6 text-[#0D7490]" />
              <h3 className="text-gray-900 text-xl">Appearance</h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Dark Mode</div>
                  <div className="text-gray-600 text-sm">
                    {appearance.darkMode ? "Currently enabled" : "Currently disabled"}
                  </div>
                </div>
                <Switch 
                  checked={appearance.darkMode}
                  onCheckedChange={(checked) => handleAppearanceChange("darkMode", checked)}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                <div>
                  <div className="text-gray-900 font-medium">Compact View</div>
                  <div className="text-gray-600 text-sm">Show more data in less space</div>
                </div>
                <Switch 
                  checked={appearance.compactView}
                  onCheckedChange={(checked) => handleAppearanceChange("compactView", checked)}
                />
              </div>
            </div>
          </Card>
        );

      case "privacy":
        return (
          <Card className="bg-white border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <Database className="w-6 h-6 text-[#0D7490]" />
              <h3 className="text-gray-900 text-xl">Data & Privacy</h3>
            </div>

            <div className="space-y-6">
              <div>
                <h4 className="text-gray-900 font-medium mb-4">Data Visibility</h4>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div>
                      <div className="text-gray-900 font-medium">Profile Visibility</div>
                      <div className="text-gray-600 text-sm">Control who can see your profile</div>
                    </div>
                    <select
                      value={privacy.dataVisibility}
                      onChange={(e) => handlePrivacyChange("dataVisibility", e.target.value)}
                      className="bg-white border border-gray-200 text-gray-900 rounded-lg px-3 py-2"
                    >
                      <option value="public">Public</option>
                      <option value="friends">Friends Only</option>
                      <option value="private">Private</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div>
                      <div className="text-gray-900 font-medium">Analytics</div>
                      <div className="text-gray-600 text-sm">Allow anonymous usage analytics</div>
                    </div>
                    <Switch 
                      checked={privacy.allowAnalytics}
                      onCheckedChange={(checked) => handlePrivacyChange("allowAnalytics", checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                    <div>
                      <div className="text-gray-900 font-medium">Show Portfolio</div>
                      <div className="text-gray-600 text-sm">Let others view your portfolio</div>
                    </div>
                    <Switch 
                      checked={privacy.showPortfolio}
                      onCheckedChange={(checked) => handlePrivacyChange("showPortfolio", checked)}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h4 className="text-gray-900 font-medium mb-4">Data Management</h4>
                <div className="space-y-3">
                  <Button 
                    variant="outline"
                    onClick={handleExportData}
                    className="border-gray-300 text-gray-700 hover:bg-gray-50 w-full justify-start"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export My Data
                  </Button>
                  
                  <Button 
                    variant="outline"
                    onClick={handleDeleteAccount}
                    className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 w-full justify-start"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Account
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h2 className="text-gray-900 text-2xl mb-1">Settings</h2>
        <p className="text-gray-600">Manage your account and preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-2">
          {sections.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                activeSection === item.id
                  ? "bg-[#0D7490] text-white border border-[#0D7490]"
                  : "bg-white border border-gray-200 text-gray-700 hover:text-gray-900 hover:border-[#0D7490]"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}