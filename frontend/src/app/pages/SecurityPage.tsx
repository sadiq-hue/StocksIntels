import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { Shield, Lock, Server, Bell, Search } from "lucide-react";

const sections = [
  {
    icon: Lock,
    title: "Encryption",
    content: "All data transmitted between your device and StocksIntels is encrypted using TLS 1.3. All stored personal and financial data is encrypted at rest using AES-256.",
  },
  {
    icon: Shield,
    title: "Authentication",
    content: "We support two-factor authentication (2FA) via authenticator app or SMS. We strongly recommend all users enable 2FA. Passwords are hashed using bcrypt and never stored in plaintext.",
  },
  {
    icon: Server,
    title: "Infrastructure",
    content: "Our platform runs on enterprise-grade cloud infrastructure with 99% uptime SLA. We conduct regular penetration testing and security audits. Access to production systems is restricted to authorized personnel with logged, audited access.",
  },
  {
    icon: Bell,
    title: "Incident Response",
    content: "In the event of a security incident affecting your data, we will notify you within 72 hours in accordance with applicable data protection regulations.",
  },
  {
    icon: Search,
    title: "Responsible Disclosure",
    content: "If you discover a security vulnerability in StocksIntels, please report it to support@stocksintels.com. We take all reports seriously and will respond within 48 hours. Please do not publicly disclose vulnerabilities before we have had a chance to address them.",
  },
];

export function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="size-9 rounded-xl overflow-hidden shadow-lg shadow-[#0D7490]/20">
                <img src="/logo1.jpg" alt="StocksIntels" className="size-full object-cover" />
              </div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">StocksIntels</span>
            </Link>
            <Link to="/login">
              <Button variant="ghost" className="text-gray-600 hover:text-[#0D7490]">Sign In</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="pt-32 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Security</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">Security at StocksIntels</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
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
                <div key={section.title} className="bg-white border border-gray-100 rounded-2xl p-8 hover:shadow-lg transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#0D7490]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-[#0D7490]" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-2">{section.title}</h2>
                      <p className="text-gray-600 leading-relaxed">{section.content}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg overflow-hidden">
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
