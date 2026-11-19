import { Button } from "../components/ui/button";
import { MapPin, Briefcase, ArrowRight } from "lucide-react";
import { useSEO } from "../hooks/useSEO";
import { PublicBrandHeader, PublicBrandFooter } from "../components/PublicBrandChrome";

const roles = [
  {
    title: "Senior ML Engineer — Signal Modeling",
    location: "Nairobi, Kenya",
    type: "Full-time",
    description: "Work on financial time-series models, evaluation, monitoring and research systems that support StocksIntels market intelligence.",
  },
  {
    title: "Frontend Engineer — React/TypeScript",
    location: "Nairobi, Kenya",
    type: "Full-time · Remote-friendly",
    description: "Build research interfaces, financial data visualizations and responsive product experiences in React and TypeScript.",
  },
  {
    title: "Market Data Analyst",
    location: "Nairobi, Kenya",
    type: "Full-time",
    description: "Monitor data quality across African and global feeds, investigate anomalies and support responsible market coverage.",
  },
  {
    title: "Business Development — West Africa",
    location: "Lagos, Nigeria",
    type: "Full-time",
    description: "Drive partnerships with brokers, exchanges, and institutional clients across Nigeria and Ghana. Deep understanding of Nigerian financial markets required.",
  },
];

export function CareersPage() {
  useSEO({
    title: "Careers at StocksIntels | Build Financial Intelligence",
    absoluteTitle: true,
    description: "Join StocksIntels and help build Super Intelligence-powered financial research, data and analytical infrastructure for African and global equity markets.",
    canonical: "/careers",
    keywords: "fintech careers, financial data jobs, market intelligence careers, StocksIntels hiring",
  });

  return (
    <div className="si-landing min-h-screen bg-[#F5F8FC] text-[#202B3A]">
      <PublicBrandHeader />

      <section className="relative overflow-hidden pt-36 pb-20">
        <div className="si-grid pointer-events-none absolute inset-0" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#2563A6] font-semibold text-xs uppercase tracking-[0.22em] mb-3">Careers</p>
          <h1 className="si-display text-5xl sm:text-7xl font-medium tracking-[-0.04em] text-[#102B50] mb-5">Build financial intelligence with us.</h1>
          <p className="text-base leading-7 text-[#607187] max-w-3xl mx-auto">
            We are building analytical infrastructure and research experiences for African and global markets. We value disciplined engineering, data quality and intellectual honesty.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-6">
            {roles.map((role) => (
              <div key={role.title} className="bg-white border border-[#D5E0EB] rounded-2xl p-5 md:p-7 hover:shadow-lg transition-shadow">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-[#2563A6]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-6 h-6 text-[#2563A6]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-foreground mb-2">{role.title}</h2>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {role.location}
                      </span>
                      <span className="px-2.5 py-0.5 bg-muted rounded-full text-xs font-medium">{role.type}</span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed mb-4">{role.description}</p>
                    <Button asChild className="bg-[#2563A6] hover:bg-[#174A7E] text-white"><a href={`mailto:support@stocksintels.com?subject=${encodeURIComponent(`Application: ${role.title}`)}`}>Apply Now <ArrowRight className="ml-2 w-4 h-4" /></a></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center p-5 md:p-7 bg-[#EDF3F9] border border-[#D5E0EB] rounded-2xl">
            <h3 className="text-lg font-bold text-foreground mb-2">How to Apply</h3>
            <p className="text-muted-foreground text-sm">
              Send your CV and a short note on why you're excited about StocksIntels to{' '}
              <a href="mailto:support@stocksintels.com" className="text-[#0D7490] hover:underline">support@stocksintels.com</a>
              {' '}with the role name in the subject line.
            </p>
          </div>
        </div>
      </section>

      <PublicBrandFooter />
    </div>
  );
}
