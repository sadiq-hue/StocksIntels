import { GitCompare, Check } from "lucide-react";
import { Button } from "./ui/button";
import { useCompare, COMPARE_MAX } from "../contexts/CompareContext";

export function CompareButton({
  ticker,
  withLabel = true,
  size = "sm",
  className,
}: {
  ticker: string;
  withLabel?: boolean;
  size?: "sm" | "default" | "icon" | "lg";
  className?: string;
}) {
  const { has, toggle, isFull } = useCompare();
  const inList = has(ticker);
  const disabled = !inList && isFull;
  return (
    <Button
      type="button"
      variant={inList ? "default" : "outline"}
      size={size}
      disabled={disabled}
      title={disabled ? `Compare list is full (max ${COMPARE_MAX})` : inList ? "Remove from compare" : "Add to compare"}
      className={className}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(ticker); }}
    >
      {inList ? <Check className="size-3.5" /> : <GitCompare className="size-3.5" />}
      {withLabel && <span>{inList ? "In compare" : "Compare"}</span>}
    </Button>
  );
}
