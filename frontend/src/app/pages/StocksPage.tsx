"use client";

import { useState } from "react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "../components/ui/collapsible";
import { ScrollArea } from "../components/ui/scroll-area";
import {
  Building2, CalendarDays, BarChart3, Star, Trophy,
  ChevronDown, LineChart, Search, SlidersHorizontal,
} from "lucide-react";
import { StockScreener } from "./stocks/StockScreener";
import { StockExchanges } from "./stocks/StockExchanges";
import { EarningsCalendar } from "./stocks/EarningsCalendar";
import { Industries } from "./stocks/Industries";
import { TopAnalysts } from "./stocks/TopAnalysts";
import { TopStocks } from "./stocks/TopStocks";

type TabId = "screener" | "exchanges" | "earnings" | "industries" | "analysts" | "top-stocks";

interface TabSection {
  id: TabId;
  label: string;
  icon: typeof LineChart;
  description: string;
}

const sections: TabSection[] = [
  { id: "screener", label: "Stock Screener", icon: SlidersHorizontal, description: "Advanced multi-criteria stock filtering" },
  { id: "exchanges", label: "Stock Exchanges", icon: Building2, description: "Major exchanges worldwide" },
  { id: "earnings", label: "Earnings Calendar", icon: CalendarDays, description: "Upcoming earnings reports" },
  { id: "industries", label: "By Industries", icon: BarChart3, description: "Industry performance" },
  { id: "analysts", label: "Top Analysts", icon: Star, description: "Analyst ratings & picks" },
  { id: "top-stocks", label: "Top Stocks", icon: Trophy, description: "Best performing stocks" },
];

export function StocksPage() {
  const [activeTab, setActiveTab] = useState<TabId>("screener");
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);

  const toggleSection = (id: string) => {
    setCollapsedSections(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const ActiveIcon = sections.find(s => s.id === activeTab)?.icon || LineChart;
  const activeLabel = sections.find(s => s.id === activeTab)?.label || "";
  const activeDescription = sections.find(s => s.id === activeTab)?.description || "";

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      <aside className="w-56 shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center shadow-sm">
              <LineChart className="size-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground leading-tight">Stock Intel</h2>
              <p className="text-[10px] text-muted-foreground">Market Explorer</p>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 p-2">
          <nav className="space-y-0.5">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = activeTab === section.id;
              const isCollapsed = collapsedSections.includes(section.id);

              return (
                <Collapsible
                  key={section.id}
                  open={!isCollapsed}
                  onOpenChange={() => toggleSection(section.id)}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                        isActive
                          ? "bg-[#0D7490] text-white shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                      onClick={() => setActiveTab(section.id)}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="font-medium truncate">{section.label}</span>
                      <ChevronDown
                        className={`size-3.5 ml-auto shrink-0 transition-transform ${
                          isCollapsed ? "" : "rotate-180"
                        } ${isActive ? "text-white/70" : "text-muted-foreground/50"}`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-8 mt-0.5 space-y-0.5">
                      <p className={`text-[10px] px-2 py-1 rounded ${isActive ? "text-white/60" : "text-muted-foreground/60"}`}>
                        {section.description}
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="p-3 border-t mt-auto">
          <div className="bg-muted/50 rounded-lg p-2.5 text-center">
            <p className="text-[10px] text-muted-foreground font-medium">Active View</p>
            <p className="text-xs font-bold text-foreground truncate">{activeLabel}</p>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="size-10 rounded-xl bg-gradient-to-br from-[#0D7490] to-[#0EA5E9] flex items-center justify-center shadow-lg shadow-[#0D7490]/20">
              <ActiveIcon className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">{activeLabel}</h1>
              <p className="text-xs text-muted-foreground font-medium">{activeDescription}</p>
            </div>
          </div>

          {activeTab === "screener" && <StockScreener />}
          {activeTab === "exchanges" && <StockExchanges />}
          {activeTab === "earnings" && <EarningsCalendar />}
          {activeTab === "industries" && <Industries />}
          {activeTab === "analysts" && <TopAnalysts />}
          {activeTab === "top-stocks" && <TopStocks />}
        </div>
      </main>
    </div>
  );
}
