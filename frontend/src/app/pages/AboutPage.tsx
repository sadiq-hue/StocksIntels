import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { Target, Eye, Heart, Users, ArrowRight } from "lucide-react";

const values = [
  {
    icon: Eye,
    title: "Transparency",
    description: "How our AI signals are generated — fully open about our methodologies and data sources.",
  },
  {
    icon: Heart,
    title: "Accuracy Over Hype",
    description: "We publish our real signal performance. No inflated claims, just honest results.",
  },
  {
    icon: Users,
    title: "Local First",
    description: "Built for African market hours, conditions, and infrastructure — by traders who trade these markets.",
  },
];

const team = [
  { name: "Team of Engineers", role: "Building the platform" },
  { name: "Data Scientists", role: "Training AI models on African market dynamics" },
  { name: "Finance Professionals", role: "Ensuring market accuracy and relevance" },
];

export function AboutPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 h-16">
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

      <section className="pt-32 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">About</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-8">About StocksIntels</h1>

          <div className="prose prose-lg max-w-none text-gray-600 space-y-6">
            <p>
              StocksIntels was founded in Nairobi, Kenya, with a single conviction: African traders deserve the same caliber of market intelligence that institutional investors on Wall Street take for granted.
            </p>
            <p>
              We built StocksIntels to close that gap — combining real-time market data from 15+ African and global exchanges with AI models trained specifically on African market dynamics. The result is a platform that gives retail and professional traders alike the clarity, speed, and confidence to make better decisions.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">Our Mission</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              To democratize financial intelligence across Africa — making professional-grade market analysis accessible to every trader, from Nairobi to Lagos to Accra.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Our Team</p>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">Meet the People Behind StocksIntels</h2>
            <p className="text-lg text-gray-600 max-w-3xl mx-auto">
              We are a team of engineers, data scientists, and finance professionals based across East and West Africa. We understand the structural nuances of African markets — from NSE liquidity cycles to currency risk on cross-border trades — because we trade them ourselves.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {team.map((member) => (
              <div key={member.name} className="bg-white border border-gray-100 rounded-2xl p-6 text-center hover:shadow-lg transition-shadow">
                <div className="w-16 h-16 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-white" />
                </div>
                <h3 className="font-bold text-gray-900">{member.name}</h3>
                <p className="text-sm text-gray-500">{member.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Our Values</p>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">What We Stand For</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {values.map((value) => {
              const Icon = value.icon;
              return (
                <div key={value.title} className="bg-white border border-gray-100 rounded-2xl p-6 hover:shadow-lg transition-shadow">
                  <div className="w-12 h-12 bg-[#0D7490]/10 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{value.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{value.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative bg-gradient-to-br from-[#0D7490] to-[#0A5F7A] rounded-3xl p-4 md:p-6 lg:p-16 text-center overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full blur-3xl" />
              <div className="absolute bottom-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl" />
            </div>
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Ready to trade smarter?</h2>
              <p className="text-lg text-white/80 mb-8">Join 2,500+ traders using AI-powered insights.</p>
              <Link to="/login">
                <Button size="lg" className="bg-white text-[#0D7490] hover:bg-gray-100 px-8 py-6 text-base font-semibold shadow-xl">
                  Start Free Trial <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </Link>
            </div>
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
