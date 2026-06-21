import { Search } from "lucide-react";
import { Input } from "./ui/input";
import { Command, CommandList, CommandItem, CommandGroup, CommandEmpty } from "./ui/command";
import { useNavigate } from "react-router";
import { useState, useRef, useEffect } from "react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
}

export function StockSearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/stocks/search/yahoo?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data || []);
          setOpen(data?.length > 0);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectStock = (symbol: string) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(`/app/stock/${symbol}`);
  };

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        placeholder="Search any stock symbol..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && results.length > 0) selectStock(results[0].symbol);
        }}
        className="pl-10 bg-muted border-border text-foreground placeholder:text-muted-foreground h-9"
      />
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
          <Command shouldFilter={false}>
            <CommandList>
              {results.length === 0 && !loading && (
                <CommandEmpty>No stocks found</CommandEmpty>
              )}
              <CommandGroup heading="Stocks">
                {results.map((result) => (
                  <CommandItem
                    key={result.symbol}
                    onSelect={() => selectStock(result.symbol)}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium shrink-0">{result.symbol}</span>
                        <span className="text-muted-foreground text-sm truncate">{result.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">{result.exchange}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
