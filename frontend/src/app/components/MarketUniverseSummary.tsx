import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Database, ArrowUpRight } from "lucide-react";
import { Card } from "./ui/card";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

type Coverage = {
  total?: number;
  freshLastHour?: number;
  dueNow?: number;
  byTier?: Record<string, number>;
};

export function MarketUniverseSummary() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);

  useEffect(() => {
    let dead = false;
    fetch(`${API_BASE}/market/intelligence/coverage`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!dead && d) setCoverage(d); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);

  return (
    <Card className="border shadow-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-[#0D7490]/15 flex items-center justify-center">
            <Database className="size-4 text-[#0D7490]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Universe Coverage</h3>
            <p className="text-[11px] text-muted-foreground">
              {coverage
                ? `${(coverage.total || 0).toLocaleString()} analysed · ${(coverage.freshLastHour || 0).toLocaleString()} fresh this hour · ${(coverage.dueNow || 0).toLocaleString()} due`
                : "Loading coverage…"}
            </p>
          </div>
        </div>
        <Link
          to="/app/signals?view=universe"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          Open universe <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      {coverage?.byTier && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          Core {(coverage.byTier.core || 0).toLocaleString()} · Screened {(coverage.byTier.screen || 0).toLocaleString()} · Catalog {(coverage.byTier.catalog || 0).toLocaleString()} · Africa {(coverage.byTier.africa || 0).toLocaleString()}
        </p>
      )}
    </Card>
  );
}
