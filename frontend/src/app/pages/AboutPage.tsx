import { Link } from "react-router";
import { ArrowRight, Cpu, Eye, Globe2, ShieldCheck, Users } from "lucide-react";
import { Button } from "../components/ui/button";
import { PublicBrandHeader, PublicBrandFooter } from "../components/PublicBrandChrome";
import { useSEO } from "../hooks/useSEO";

const values = [
  { icon: Eye, title: "Clarity before confidence", text: "We explain the evidence, limitations and source context behind analytical outputs." },
  { icon: ShieldCheck, title: "Accuracy over hype", text: "Markets are uncertain. We avoid guaranteed outcomes and make risk visible in the research process." },
  { icon: Globe2, title: "African relevance", text: "African exchanges are treated as first-class markets, understood alongside the global forces that shape them." },
];

const dimensions = [
  "Computational intelligence",
  "Fundamental analysis",
  "Technical analysis",
  "Financial statement analysis",
  "Macroeconomic context",
  "News and market sentiment",
  "Human financial expertise",
];

export function AboutPage() {
  useSEO({
    title: "About StocksIntels | African & Global Market Intelligence",
    absoluteTitle: true,
    description: "Learn how StocksIntels combines Super Intelligence, company financials, market analysis and human analyst expertise to deepen research across African and global equity markets.",
    canonical: "/about",
    keywords: "StocksIntels, Super Intelligence, African market intelligence, global equity research, company financials, Nairobi fintech, Delaware fintech",
  });

  return (
    <div className="si-landing min-h-screen bg-[#F5F8FC] text-[#202B3A]">
      <PublicBrandHeader />

      <main>
        <section className="relative overflow-hidden pt-36 pb-20 sm:pt-44 sm:pb-28">
          <div className="si-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-[1320px] gap-12 px-5 sm:px-8 lg:grid-cols-[.9fr_1.1fr] lg:px-12">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#2563A6]">About StocksIntels</p>
              <h1 className="si-display mt-5 text-5xl leading-[.98] tracking-[-0.04em] text-[#102B50] sm:text-7xl">Built for a deeper understanding of markets.</h1>
            </div>
            <div className="self-end border-l border-[#C9D7E6] pl-7 sm:pl-10">
              <p className="text-lg leading-8 text-[#52647A]">StocksIntels exists to make sophisticated financial research more accessible across African and global markets.</p>
              <p className="mt-5 text-sm leading-7 text-[#607187]">We combine advanced technology, company and market analysis, and human expertise into a research experience designed for clarity rather than prediction theatre.</p>
            </div>
          </div>
        </section>

        <section className="bg-[#102B50] py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-[1320px] gap-14 px-5 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:px-12">
            <div>
              <span className="grid size-14 place-items-center rounded-full border border-[#D5A64A]/40 bg-[#D5A64A]/10 font-mono text-sm font-bold text-[#E3C27D]">SI</span>
              <h2 className="si-display mt-8 text-4xl leading-[1.03] tracking-[-0.035em] sm:text-6xl">Our philosophy: Super Intelligence.</h2>
              <p className="mt-7 text-sm leading-7 text-slate-300">SI is our framework for combining different forms of intelligence. It is a brand philosophy, not a claim that artificial superintelligence has been achieved.</p>
            </div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {dimensions.map((dimension, index) => (
                <div key={dimension} className="flex items-center gap-5 py-5">
                  <span className="font-mono text-[10px] text-cyan-300/70">0{index + 1}</span>
                  <span className="text-sm font-semibold text-slate-100">{dimension}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#2563A6]">Why we exist</p>
                <h2 className="si-display mt-5 text-4xl leading-[1.03] tracking-[-0.035em] text-[#102B50] sm:text-6xl">African markets deserve analytical depth.</h2>
              </div>
              <div className="space-y-6 text-sm leading-7 text-[#607187]">
                <p>Information across African exchanges can be fragmented, delayed and difficult to interpret in context. At the same time, investors increasingly need to understand how global rates, currencies, sectors and companies affect local markets.</p>
                <p>StocksIntels brings those perspectives together through market intelligence, company financials, technical evidence, news, portfolio tools and research workflows.</p>
              </div>
            </div>

            <div className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-[#D6E1EC] bg-[#D6E1EC] md:grid-cols-3">
              {values.map((value) => {
                const Icon = value.icon;
                return (
                  <article key={value.title} className="bg-[#F8FAFD] p-8 sm:p-10">
                    <Icon className="size-6 text-[#2563A6]" />
                    <h3 className="mt-9 text-lg font-semibold text-[#102B50]">{value.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#607187]">{value.text}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-[#EDF3F9] py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1320px] gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:px-12">
            <div className="rounded-3xl border border-[#D1DDE9] bg-white p-8 sm:p-10">
              <Cpu className="size-6 text-[#2563A6]" />
              <h2 className="mt-8 text-2xl font-semibold text-[#102B50]">Technology designed to support research.</h2>
              <p className="mt-5 text-sm leading-7 text-[#607187]">Models and data systems help process financial information, identify patterns and organize evidence. They support decision-making; they do not remove uncertainty.</p>
            </div>
            <div className="rounded-3xl border border-[#D5A64A]/35 bg-[#F9F5EC] p-8 sm:p-10">
              <Users className="size-6 text-[#A67A2D]" />
              <h2 className="mt-8 text-2xl font-semibold text-[#3C3427]">Human context remains essential.</h2>
              <p className="mt-5 text-sm leading-7 text-[#675B49]">Financial judgement, qualitative interpretation and regional knowledge complement computational analysis. Not every automated output is manually reviewed.</p>
            </div>
          </div>
        </section>

        <section className="bg-white py-20 sm:py-28">
          <div className="mx-auto max-w-[1320px] px-5 sm:px-8 lg:px-12">
            <div className="grid gap-12 lg:grid-cols-[.75fr_1.25fr]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#2563A6]">Our presence</p>
                <h2 className="si-display mt-5 text-4xl tracking-[-0.035em] text-[#102B50] sm:text-5xl">African roots. Global ambition.</h2>
              </div>
              <div className="divide-y divide-[#D7E1EC] border-y border-[#D7E1EC]">
                <div className="grid gap-2 py-6 sm:grid-cols-[160px_1fr]"><span className="font-mono text-xs font-bold text-[#2563A6]">NAIROBI</span><span className="text-sm text-[#607187]">Kenya - African market intelligence and product operations</span></div>
                <div className="grid gap-2 py-6 sm:grid-cols-[160px_1fr]"><span className="font-mono text-xs font-bold text-[#A67A2D]">DELAWARE</span><span className="text-sm text-[#607187]">United States - Global company presence</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#174A7E] py-20 text-white">
          <div className="mx-auto flex max-w-[1180px] flex-col items-start justify-between gap-8 px-5 sm:px-8 lg:flex-row lg:items-end">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200">Financial Intelligence. Elevated.</p><h2 className="si-display mt-5 max-w-3xl text-4xl leading-[1.02] tracking-[-0.035em] sm:text-6xl">Explore a more comprehensive way to research markets.</h2></div>
            <Button asChild size="lg" className="rounded-full bg-white px-7 text-[#174A7E] hover:bg-cyan-50"><Link to="/login">Explore StocksIntels <ArrowRight className="size-4" /></Link></Button>
          </div>
        </section>
      </main>

      <PublicBrandFooter />
    </div>
  );
}
