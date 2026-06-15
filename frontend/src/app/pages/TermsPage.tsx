import { Link } from "react-router";
import { Button } from "../components/ui/button";

const sections = [
  {
    title: "1. Acceptance",
    content: "By accessing or using StocksIntels, you agree to be bound by these Terms. If you do not agree, do not use the platform.",
  },
  {
    title: "2. Platform Use",
    content: "StocksIntels is a market intelligence and analytics platform. You may use it for personal or professional investment research. You may not resell, redistribute, or scrape data from the platform without written permission.",
  },
  {
    title: "3. AI Signals and Market Data",
    content: 'All AI signals, market data, and analytics provided by StocksIntels are for informational purposes only. They do not constitute financial advice, investment recommendations, or solicitations to buy or sell any security. You are solely responsible for your investment decisions.',
  },
  {
    title: "4. Subscription and Billing",
    content: "Paid subscriptions are billed monthly or annually. You may cancel at any time; cancellations take effect at the end of the current billing period. No refunds are issued for partial months.",
  },
  {
    title: "5. Intellectual Property",
    content: "All platform content, AI models, signal methodologies, and data visualizations are the intellectual property of StocksIntels. Unauthorized reproduction is prohibited.",
  },
  {
    title: "6. Limitation of Liability",
    content: "StocksIntels shall not be liable for any trading losses, missed opportunities, or financial damages arising from use of the platform, signal errors, or data interruptions. Your use of the platform is entirely at your own risk.",
  },
  {
    title: "7. Governing Law",
    content: "These Terms are governed by the laws of the Republic of Kenya. Disputes shall be resolved in the courts of Nairobi, Kenya.",
  },
  {
    title: "8. Changes",
    content: "We may update these Terms at any time. Continued use of the platform after changes constitutes acceptance of the revised Terms.",
  },
];

export function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
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

      <section className="pt-32 pb-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Terms of Service</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-gray-500 text-sm mb-12">Last updated: January 2026</p>

          <div className="space-y-10">
            {sections.map((section) => (
              <div key={section.title}>
                <h2 className="text-xl font-bold text-gray-900 mb-3">{section.title}</h2>
                <p className="text-gray-600 leading-relaxed">{section.content}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 p-6 bg-gray-50 rounded-2xl">
            <p className="text-gray-600 text-sm">
              <strong>Contact:</strong>{' '}
              <a href="mailto:support@stocksintels.com" className="text-[#0D7490] hover:underline">support@stocksintels.com</a>
            </p>
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
