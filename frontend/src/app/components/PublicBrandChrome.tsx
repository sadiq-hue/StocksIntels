import { Link } from "react-router";
import { ArrowRight, Mail, MapPin, Phone } from "lucide-react";
import { Button } from "./ui/button";

export function PublicBrandHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[#DCE5F0] bg-[#F5F8FC]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
        <Link to="/" className="flex items-center gap-3" aria-label="StocksIntels home">
          <img src="/logo1.jpg" alt="" className="size-9 rounded-lg object-cover" />
          <div>
            <span className="block text-sm font-extrabold tracking-[-0.02em] text-[#102B50]">StocksIntels</span>
            <span className="hidden text-[8px] font-bold uppercase tracking-[0.22em] text-[#4386C8] sm:block">Financial Intelligence</span>
          </div>
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Public navigation">
          <a href="/#platform" className="text-xs font-semibold text-[#52647A] hover:text-[#174A7E]">Platform</a>
          <Link to="/pricing" className="text-xs font-semibold text-[#52647A] hover:text-[#174A7E]">Pricing</Link>
          <Link to="/about" className="text-xs font-semibold text-[#52647A] hover:text-[#174A7E]">About</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" className="hidden text-sm text-[#174A7E] sm:inline-flex"><Link to="/login">Sign in</Link></Button>
          <Button asChild className="rounded-full bg-[#2563A6] px-4 text-xs text-white hover:bg-[#174A7E] sm:px-5 sm:text-sm"><Link to="/login">Explore <ArrowRight className="size-4" /></Link></Button>
        </div>
      </div>
    </header>
  );
}

export function PublicBrandFooter() {
  return (
    <footer className="bg-[#0B203D] text-white">
      <div className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12">
        <div className="grid gap-10 border-b border-white/10 pb-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Link to="/" className="flex items-center gap-3"><img src="/logo1.jpg" alt="" className="size-9 rounded-lg object-cover" /><span className="text-sm font-extrabold">StocksIntels</span></Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-slate-400">Super Intelligence. Financial Research. Human Expertise.</p>
          </div>
          <div className="space-y-3 text-sm text-slate-400">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200">Offices</p>
            <p className="flex items-center gap-2"><MapPin className="size-4 text-cyan-300" /> Nairobi, Kenya</p>
            <p className="flex items-center gap-2"><MapPin className="size-4 text-cyan-300" /> Delaware, United States</p>
          </div>
          <div className="space-y-3 text-sm text-slate-400">
            <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200">Contact</p>
            <a href="mailto:support@stocksintels.com" className="flex items-center gap-2 hover:text-white"><Mail className="size-4 text-cyan-300" /> support@stocksintels.com</a>
            <a href="tel:+254792754435" className="flex items-center gap-2 hover:text-white"><Phone className="size-4 text-cyan-300" /> +254 792 754 435</a>
          </div>
        </div>
        <div className="flex flex-col gap-4 pt-7 text-[11px] text-slate-500 sm:flex-row sm:justify-between">
          <span>Copyright {new Date().getFullYear()} StocksIntels.</span>
          <div className="flex gap-5"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/disclaimer">Disclaimer</Link><Link to="/developers">Developer Portal</Link></div>
        </div>
      </div>
    </footer>
  );
}
