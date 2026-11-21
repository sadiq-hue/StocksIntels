import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";

export interface CandlestickPoint {
  date: string;
  displayDate?: string;
  fullDate?: string;
  open: number;
  high: number;
  low: number;
  price: number;
  volume: number;
}

interface NormalizedCandle {
  date: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const HEIGHT = 320;
const TOP = 14;
const RIGHT = 68;
const LEFT = 8;
const BOTTOM = 26;
const VOLUME_HEIGHT = 42;
const VOLUME_GAP = 14;
const VOLUME_BOTTOM = HEIGHT - BOTTOM;
const VOLUME_TOP = VOLUME_BOTTOM - VOLUME_HEIGHT;
const PRICE_BOTTOM = VOLUME_TOP - VOLUME_GAP;

function normalize(data: CandlestickPoint[]): NormalizedCandle[] {
  return data.flatMap((point) => {
    const close = Number(point.price);
    if (!Number.isFinite(close) || close <= 0) return [];
    const openValue = Number(point.open);
    const open = Number.isFinite(openValue) && openValue > 0 ? openValue : close;
    const highValue = Number(point.high);
    const lowValue = Number(point.low);
    const high = Math.max(open, close, Number.isFinite(highValue) && highValue > 0 ? highValue : close);
    const low = Math.min(open, close, Number.isFinite(lowValue) && lowValue > 0 ? lowValue : close);
    return [{
      date: point.date,
      label: point.fullDate || point.displayDate || point.date,
      open,
      high,
      low,
      close,
      volume: Math.max(0, Number(point.volume) || 0),
    }];
  });
}

function aggregate(data: NormalizedCandle[], maxBars: number): NormalizedCandle[] {
  if (data.length <= maxBars) return data;
  const bucketSize = Math.ceil(data.length / maxBars);
  const result: NormalizedCandle[] = [];
  for (let index = 0; index < data.length; index += bucketSize) {
    const bucket = data.slice(index, index + bucketSize);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    result.push({
      date: last.date,
      label: first === last ? last.label : `${first.label} - ${last.label}`,
      open: first.open,
      high: Math.max(...bucket.map((point) => point.high)),
      low: Math.min(...bucket.map((point) => point.low)),
      close: last.close,
      volume: bucket.reduce((sum, point) => sum + point.volume, 0),
    });
  }
  return result;
}

function axisPrice(value: number) {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: value < 1 ? 4 : 2 });
}

function tooltipPrice(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
  });
}

function compactVolume(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function CandlestickChart({ data, currency }: { data: CandlestickPoint[]; currency: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setWidth(Math.max(220, Math.round(container.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const normalized = useMemo(() => normalize(data), [data]);
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const candles = useMemo(
    () => aggregate(normalized, Math.max(24, Math.floor(plotWidth / 5))),
    [normalized, plotWidth],
  );

  const bounds = useMemo(() => {
    if (candles.length === 0) return { min: 0, max: 1 };
    const rawMin = Math.min(...candles.map((point) => point.low));
    const rawMax = Math.max(...candles.map((point) => point.high));
    const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.01, 0.01);
    return { min: Math.max(0, rawMin - span * 0.08), max: rawMax + span * 0.08 };
  }, [candles]);

  const priceSpan = Math.max(bounds.max - bounds.min, 0.0001);
  const priceY = (value: number) => TOP + ((bounds.max - value) / priceSpan) * (PRICE_BOTTOM - TOP);
  const step = candles.length > 0 ? plotWidth / candles.length : plotWidth;
  const candleWidth = Math.max(1.5, Math.min(10, step * 0.62));
  const maxVolume = Math.max(1, ...candles.map((point) => point.volume));
  const yTicks = Array.from({ length: 5 }, (_, index) => bounds.max - (priceSpan * index) / 4);
  const xTickCount = Math.min(6, candles.length);
  const xTickIndexes = new Set(
    Array.from({ length: xTickCount }, (_, index) =>
      Math.round((index * (candles.length - 1)) / Math.max(1, xTickCount - 1)),
    ),
  );

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
    if (candles.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    if (x < LEFT || x > width - RIGHT) {
      setHovered(null);
      return;
    }
    setHovered(Math.max(0, Math.min(candles.length - 1, Math.floor((x - LEFT) / step))));
  };

  const hoveredCandle = hovered == null ? null : candles[hovered];
  const hoveredX = hovered == null ? 0 : LEFT + (hovered + 0.5) * step;
  const tooltipLeft = Math.max(8, Math.min(width - 190, hoveredX > width / 2 ? hoveredX - 188 : hoveredX + 10));

  return (
    <div ref={containerRef} className="relative h-[320px] w-full select-none">
      {width > 0 && candles.length > 0 ? (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Candlestick price chart with ${candles.length} bars`}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovered(null)}
            className="block max-w-full"
          >
            {yTicks.map((tick) => {
              const y = priceY(tick);
              return (
                <g key={tick}>
                  <line x1={LEFT} x2={width - RIGHT} y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 3" />
                  <text x={width - RIGHT + 8} y={y + 3} fill="var(--muted-foreground)" fontSize="10">{axisPrice(tick)}</text>
                </g>
              );
            })}

            <line x1={LEFT} x2={width - RIGHT} y1={VOLUME_TOP - 7} y2={VOLUME_TOP - 7} stroke="var(--border)" />
            <text x={LEFT} y={VOLUME_TOP - 10} fill="var(--muted-foreground)" fontSize="9">VOLUME</text>

            {candles.map((point, index) => {
              const x = LEFT + (index + 0.5) * step;
              const openY = priceY(point.open);
              const closeY = priceY(point.close);
              const highY = priceY(point.high);
              const lowY = priceY(point.low);
              const rising = point.close >= point.open;
              const color = rising ? "#10B981" : "#EF4444";
              const bodyY = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
              const volumeHeight = (point.volume / maxVolume) * VOLUME_HEIGHT;
              return (
                <g key={`${point.date}-${index}`} opacity={hovered == null || hovered === index ? 1 : 0.72}>
                  <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1" />
                  <rect x={x - candleWidth / 2} y={bodyY} width={candleWidth} height={bodyHeight} rx="0.6" fill={color} />
                  {point.volume > 0 && (
                    <rect x={x - candleWidth / 2} y={VOLUME_BOTTOM - volumeHeight} width={candleWidth} height={volumeHeight} fill={color} opacity="0.32" />
                  )}
                </g>
              );
            })}

            {[...xTickIndexes].map((index) => {
              const point = candles[index];
              return (
                <text key={`x-${index}`} x={LEFT + (index + 0.5) * step} y={HEIGHT - 7} textAnchor="middle" fill="var(--muted-foreground)" fontSize="9">
                  {point.date}
                </text>
              );
            })}

            {hoveredCandle && (
              <>
                <line x1={hoveredX} x2={hoveredX} y1={TOP} y2={VOLUME_BOTTOM} stroke="var(--muted-foreground)" strokeDasharray="3 3" opacity="0.55" />
                <line x1={LEFT} x2={width - RIGHT} y1={priceY(hoveredCandle.close)} y2={priceY(hoveredCandle.close)} stroke="var(--muted-foreground)" strokeDasharray="3 3" opacity="0.35" />
              </>
            )}
          </svg>

          {hoveredCandle && (
            <div className="pointer-events-none absolute top-2 z-10 w-[180px] rounded-lg border border-border bg-popover/95 p-2.5 text-[10px] shadow-lg backdrop-blur" style={{ left: tooltipLeft }}>
              <p className="mb-1.5 truncate font-semibold text-foreground">{hoveredCandle.label}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                <span>Open</span><span className="text-right font-medium text-foreground">{currency} {tooltipPrice(hoveredCandle.open)}</span>
                <span>High</span><span className="text-right font-medium text-foreground">{currency} {tooltipPrice(hoveredCandle.high)}</span>
                <span>Low</span><span className="text-right font-medium text-foreground">{currency} {tooltipPrice(hoveredCandle.low)}</span>
                <span>Close</span><span className="text-right font-medium text-foreground">{currency} {tooltipPrice(hoveredCandle.close)}</span>
                <span>Volume</span><span className="text-right font-medium text-foreground">{compactVolume(hoveredCandle.volume)}</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No valid OHLC data available</div>
      )}
    </div>
  );
}
