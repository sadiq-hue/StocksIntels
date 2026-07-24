export function parseVolume(vol: string | number): number {
  if (typeof vol === "number") return Number.isFinite(vol) ? vol : 0;
  if (!vol) return 0;
  const str = String(vol).trim();
  if (!str || str === "—" || str === "-") return 0;
  const num = parseFloat(str.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(num)) return 0;
  if (/[Bb]/.test(str)) return num * 1e9;
  if (/[Mm]/.test(str)) return num * 1e6;
  if (/[Kk]/.test(str)) return num * 1e3;
  return num;
}

export function formatVolume(vol: number | string): string {
  const n = typeof vol === "string" ? parseVolume(vol) : vol;
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  return new Intl.NumberFormat("en-KE", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
