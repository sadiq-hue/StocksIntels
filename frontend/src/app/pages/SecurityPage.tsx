import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { ThemeToggle } from "../components/ThemeToggle";
import { Shield, Lock, Server, Bell, Search } from "lucide-react";
import { useSEO } from "../hooks/useSEO";

const sections = [
  {
    icon: Lock,
    title: "Encryption",
    content: "StocksIntels uses HTTPS/TLS for data transmitted between your device and the platform. Infrastructure and database access is restricted to authorized services and personnel.",
  },
  {
    icon: Shield,
    title: "Authentication",
    content: "Passwords are hashed using bcrypt and never stored in plaintext. Sensitive login and account workflows use time-limited email verification codes.",
  },
  {
    icon: Server,
    title: "Infrastructure",
    content: "The platform runs on containerized cloud infrastructure with health monitoring, restricted production access, database backups and operational logging.",
  },
  {
    icon: Bell,
    title: "Incident Response",
    content: "We investigate suspected security incidents and provide notifications where required by applicable data-protection law.",
  },
  {
    icon: Search,
    title: "Responsible Disclosure",
    content: "If you discover a security vulnerability in StocksIntels, please report it to support@stocksintels.com. We take all reports seriously and will respond within 48 hours. Please do not publicly disclose vulnerabilities before we have had a chance to address them.",
  },
];

export function SecurityPage() {
  useSEO({
    title: "Security",
    description: "Learn about StocksIntels security practices for protecting financial research accounts, personal information and platform data.",
    canonical: "/security",
    keywords: "StocksIntels security, data protection, secure financial research platform",
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="size-9 overflow-hidden">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-xl font-bold text-foreground tracking-tight">StocksIntels</span>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link to="/login">
                <Button variant="ghost" className="text-muted-foreground hover:text-[#0D7490]">Sign In</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <section className="pt-32 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Security</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Security at StocksIntels</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Protecting your data and account is foundational to everything we build.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.title} className="bg-card border border-border rounded-2xl p-5 sm:p-8 hover:shadow-lg transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#0D7490]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-[#0D7490]" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground mb-2">{section.title}</h2>
                      <p className="text-muted-foreground leading-relaxed">{section.content}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="bg-gray-900 dark:bg-[#0a0a0b] text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="size-8 overflow-hidden">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-lg font-bold">StocksIntels</span>
            </div>
            <p className="text-gray-500 text-sm">© 2026 StocksIntels. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
