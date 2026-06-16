import { Link } from "react-router";
import { Button } from "../components/ui/button";
import { ArrowRight, Calendar, User } from "lucide-react";

const posts = [
  {
    title: "How Our AI Achieves 92% Signal Accuracy on the NSE",
    excerpt: "A deep dive into the machine learning pipeline behind StocksIntels signals — the data sources, model architecture, and validation methodology we use to generate buy/sell recommendations.",
    date: "June 2026",
    author: "StocksIntels Team",
    category: "AI Research",
  },
  {
    title: "Trading the NSE in 2026: What the Data Shows",
    excerpt: "An analysis of NSE 20 Share Index performance, sector rotation patterns, and the stocks our AI flagged most consistently over the past 12 months.",
    date: "May 2026",
    author: "StocksIntels Team",
    category: "Market Analysis",
  },
  {
    title: "Why African Markets Behave Differently — And How We Model It",
    excerpt: "Thin liquidity, FX volatility, and information asymmetry make African exchanges unique. Here's how StocksIntels accounts for these factors in its signal generation.",
    date: "April 2026",
    author: "StocksIntels Team",
    category: "Research",
  },
  {
    title: "M-Pesa, Mobile Money, and What It Means for Safaricom's Valuation",
    excerpt: "A fundamental analysis of Safaricom's revenue mix and why mobile money flows are a leading indicator our AI monitors closely.",
    date: "March 2026",
    author: "StocksIntels Team",
    category: "Fundamental Analysis",
  },
];

export function BlogPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-9 h-9 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-xl flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
                <img src="/logo1.jpg" alt="StocksIntels" className="w-5 h-5" />
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
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Blog</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">From the StocksIntels Team</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Market intelligence, AI research, and trading insights for African investors.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-8">
            {posts.map((post) => (
              <article key={post.title} className="bg-white border border-gray-100 rounded-2xl p-4 md:p-6 hover:shadow-lg transition-shadow">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#0D7490]/5 text-[#0D7490] rounded-full text-xs font-semibold">
                    {post.category}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {post.date}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {post.author}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-3 hover:text-[#0D7490] transition-colors">
                  {post.title}
                </h2>
                <p className="text-gray-600 leading-relaxed mb-4">{post.excerpt}</p>
                <button className="inline-flex items-center gap-1 text-[#0D7490] font-semibold text-sm hover:text-[#0A5F7A] transition-colors">
                  Read More <ArrowRight className="w-4 h-4" />
                </button>
              </article>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm">
              New posts every week. Subscribe for updates at{' '}
              <a href="mailto:support@stocksintels.com" className="text-[#0D7490] hover:underline">support@stocksintels.com</a>
            </p>
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
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Stay informed with market insights</h2>
              <p className="text-lg text-white/80 mb-8">Subscribe to our newsletter for weekly updates.</p>
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
              <div className="w-8 h-8 bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] rounded-lg flex items-center justify-center">
                <img src="/logo1.jpg" alt="StocksIntels" className="w-5 h-5" />
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
