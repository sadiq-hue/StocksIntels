import type { ReactNode } from "react";

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

function StockAnalysisContentSkeleton() {
  return (
    <div role="status" aria-label="Loading stock analysis" className="w-full space-y-4 px-3 py-5 md:px-5">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Pulse className="h-7 w-52" />
            <Pulse className="h-3 w-40" />
          </div>
          <Pulse className="h-10 w-44" />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(100px,1fr))_260px]">
          {[0, 1, 2, 3].map((item) => <Pulse key={item} className="h-11 w-full" />)}
          <Pulse className="col-span-2 h-20 w-full sm:col-span-4 lg:col-span-1 lg:row-span-2" />
        </div>
      </div>
      <div className="flex gap-5 border-b border-border pb-2">
        {["w-16", "w-20", "w-16", "w-20", "w-14", "w-14"].map((width, index) => <Pulse key={index} className={`h-5 ${width}`} />)}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="h-1 bg-[#0D7490]/60" />
        <div className="p-4">
          <div className="flex items-center justify-between gap-4">
            <Pulse className="h-6 w-40" />
            <Pulse className="h-7 w-64" />
          </div>
          <div className="relative mt-5 h-[300px] overflow-hidden rounded-xl bg-muted/35">
            <div className="absolute inset-x-0 top-1/4 border-t border-dashed border-border" />
            <div className="absolute inset-x-0 top-2/4 border-t border-dashed border-border" />
            <div className="absolute inset-x-0 top-3/4 border-t border-dashed border-border" />
            <div className="absolute inset-x-[8%] bottom-[18%] h-20 animate-pulse rounded-[50%] border-t-4 border-[#0D7490]/25" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-2xl border border-border bg-card p-4">
            <Pulse className="h-5 w-32" />
            <div className="mt-4 space-y-2.5">
              <Pulse className="h-3 w-full" />
              <Pulse className="h-3 w-11/12" />
              <Pulse className="h-3 w-4/5" />
              <Pulse className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading stock data and research modules</span>
    </div>
  );
}

function GenericAppContentSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-5 p-5">
      <Pulse className="h-9 w-56" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Pulse key={item} className="h-28 w-full" />)}
      </div>
      <Pulse className="h-80 w-full" />
    </div>
  );
}

function AppShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar p-4 md:block">
        <div className="flex items-center gap-3 border-b border-border pb-5">
          <Pulse className="size-10 rounded-xl" />
          <div className="space-y-2"><Pulse className="h-4 w-24" /><Pulse className="h-2.5 w-28" /></div>
        </div>
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((item) => <Pulse key={item} className="h-9 w-full" />)}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 md:px-6">
          <Pulse className="h-9 w-full max-w-xl" />
          <div className="ml-4 flex gap-3"><Pulse className="size-9 rounded-full" /><Pulse className="h-9 w-28" /></div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

export function RouteLoadingFallback({ pathname, withShell = false }: { pathname: string; withShell?: boolean }) {
  const content = pathname.startsWith("/app/stock/") ? <StockAnalysisContentSkeleton /> : <GenericAppContentSkeleton />;
  if (withShell && pathname.startsWith("/app")) return <AppShellSkeleton>{content}</AppShellSkeleton>;
  if (pathname.startsWith("/app")) return content;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <div className="size-7 animate-spin rounded-full border-2 border-[#0D7490]/25 border-t-[#0D7490]" />
        Loading StocksIntels
      </div>
    </div>
  );
}
