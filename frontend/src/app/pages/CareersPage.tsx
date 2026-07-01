import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { MapPin, Briefcase, ArrowRight } from "lucide-react";

const roles = [
  {
    title: "Senior ML Engineer — Signal Modeling",
    location: "Nairobi, Kenya",
    type: "Full-time",
    description: "Own the development and improvement of our AI signal models. You'll work with financial time-series data, evaluate model performance, and ship improvements that directly affect trader outcomes.",
  },
  {
    title: "Frontend Engineer — React/TypeScript",
    location: "Nairobi, Kenya",
    type: "Full-time · Remote-friendly",
    description: "Build the trading interfaces, dashboards, and data visualizations that traders interact with every day. Strong design sensibility and comfort with real-time data are a plus.",
  },
  {
    title: "Market Data Analyst",
    location: "Nairobi, Kenya",
    type: "Full-time",
    description: "Monitor data quality across our 15+ exchange feeds, identify anomalies, and work with our data engineering team to expand coverage to new African markets.",
  },
  {
    title: "Business Development — West Africa",
    location: "Lagos, Nigeria",
    type: "Full-time",
    description: "Drive partnerships with brokers, exchanges, and institutional clients across Nigeria and Ghana. Deep understanding of Nigerian financial markets required.",
  },
];

export function CareersPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="size-9 overflow-hidden">
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
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Careers</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">Join the StocksIntels Team</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            We're building the financial intelligence layer for African markets. If you're excited about AI, financial data, and building products that matter to millions of African investors, we'd love to hear from you.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {roles.map((role) => (
              <div key={role.title} className="bg-white border border-gray-100 rounded-2xl p-4 md:p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-[#0D7490]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-6 h-6 text-[#0D7490]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">{role.title}</h2>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-4">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {role.location}
                      </span>
                      <span className="px-2.5 py-0.5 bg-gray-100 rounded-full text-xs font-medium">{role.type}</span>
                    </div>
                    <p className="text-gray-600 leading-relaxed mb-4">{role.description}</p>
                    <Button className="bg-[#0D7490] hover:bg-[#0A5F7A] text-white">
                      Apply Now <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center p-4 md:p-6 bg-gray-50 rounded-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">How to Apply</h3>
            <p className="text-gray-600 text-sm">
              Send your CV and a short note on why you're excited about StocksIntels to{' '}
              <a href="mailto:support@stocksintels.com" className="text-[#0D7490] hover:underline">support@stocksintels.com</a>
              {' '}with the role name in the subject line. We review every application personally.
            </p>
          </div>
        </div>
      </section>

      <footer className="bg-gray-900 text-white py-12">
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
