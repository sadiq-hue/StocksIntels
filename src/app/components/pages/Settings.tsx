import { useState } from "react";
import { Bot, MessageSquare, Bell, Shield, CheckCircle } from "lucide-react";
import { api } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

export function Settings() {
  const { business, businesses, loading } = useBusiness();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [businessDesc, setBusinessDesc] = useState(
    business?.name ? `${business.name} - ${business.industry || 'Business automation platform'}` : ''
  );

  const handleSave = async () => {
    if (!business) return;
    setSaving(true);
    try {
      await api.businesses.update(business.id, {
        name: businessDesc || business.name,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full p-8 space-y-8 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <h1>Settings</h1>
        <p className="text-muted-foreground">Configure your AI assistant and preferences</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto max-w-3xl space-y-6">
        <div className="p-6 border border-border rounded-xl bg-card space-y-6">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1">AI Configuration</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Customize how your AI assistant interacts with leads
              </p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="business-desc">Business Description</label>
                  <textarea
                    id="business-desc"
                    rows={3}
                    placeholder="Describe your business and what you offer..."
                    className="w-full mt-2 px-4 py-2 rounded-lg bg-input-background border border-border resize-none"
                    defaultValue="FlowOps AI is a unified business automation platform connecting sales, payments, and financial insights for SMEs."
                  />
                </div>

                <div>
                  <label htmlFor="qualification">Qualification Questions</label>
                  <textarea
                    id="qualification"
                    rows={3}
                    placeholder="What questions should the AI ask to qualify leads?"
                    className="w-full mt-2 px-4 py-2 rounded-lg bg-input-background border border-border resize-none"
                    defaultValue="1. What's your biggest challenge with lead management?&#10;2. What's your team size?&#10;3. What's your monthly lead volume?"
                  />
                </div>

                <div>
                  <label htmlFor="faqs">Common FAQs</label>
                  <textarea
                    id="faqs"
                    rows={3}
                    placeholder="Add frequently asked questions and answers..."
                    className="w-full mt-2 px-4 py-2 rounded-lg bg-input-background border border-border resize-none"
                    defaultValue="Q: What platforms do you integrate with?&#10;A: We integrate with WhatsApp Business, Gmail, and major CRMs like Salesforce and HubSpot."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-6">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <MessageSquare className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1">Automation Level</h3>
              <p className="text-sm text-muted-foreground mb-4">Control how much the AI handles automatically</p>

              <div className="space-y-3">
                <label className="flex items-center gap-3 p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                  <input type="radio" name="automation" value="full" defaultChecked className="w-4 h-4" />
                  <div>
                    <p className="font-medium">Full AI</p>
                    <p className="text-sm text-muted-foreground">
                      AI handles all conversations and bookings automatically
                    </p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                  <input type="radio" name="automation" value="assisted" className="w-4 h-4" />
                  <div>
                    <p className="font-medium">Assisted</p>
                    <p className="text-sm text-muted-foreground">AI qualifies leads, you handle final conversations</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                  <input type="radio" name="automation" value="manual" className="w-4 h-4" />
                  <div>
                    <p className="font-medium">Manual</p>
                    <p className="text-sm text-muted-foreground">AI provides suggestions, you control all responses</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-6">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1">Notifications</h3>
              <p className="text-sm text-muted-foreground mb-4">Choose what updates you want to receive</p>

              <div className="space-y-3">
                <label className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                  <div>
                    <p className="font-medium">New lead alerts</p>
                    <p className="text-sm text-muted-foreground">Get notified when new leads arrive</p>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4" />
                </label>
                <label className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                  <div>
                    <p className="font-medium">Lead qualified</p>
                    <p className="text-sm text-muted-foreground">Alert when AI qualifies a high-value lead</p>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4" />
                </label>
                <label className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer">
                  <div>
                    <p className="font-medium">Meeting booked</p>
                    <p className="text-sm text-muted-foreground">Confirmation when meetings are scheduled</p>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4" />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border border-border rounded-xl bg-card space-y-6">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1">Integrations</h3>
              <p className="text-sm text-muted-foreground mb-4">Connect your tools and platforms</p>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium">WhatsApp Business</p>
                      <p className="text-sm text-green-600">Connected</p>
                    </div>
                  </div>
                  <button className="px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors">
                    Configure
                  </button>
                </div>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <MessageSquare className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium">Gmail</p>
                      <p className="text-sm text-muted-foreground">Not connected</p>
                    </div>
                  </div>
                  <button className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    Connect
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 items-center">
          {saved && (
            <span className="flex items-center gap-1 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" /> Saved
            </span>
          )}
          <button className="px-6 py-2 rounded-lg border border-border hover:bg-accent transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !business}
            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
