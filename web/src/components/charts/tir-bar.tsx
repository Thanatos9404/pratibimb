import { RANGE_VAR, type RangeKey, type RangeShares } from "@/lib/glucose";
import { cn } from "@/lib/utils";

const ORDER: RangeKey[] = ["vhigh", "high", "in", "low", "vlow"];
const NAMES: Record<RangeKey, string> = { vhigh: "Very high", high: "High", in: "In range", low: "Low", vlow: "Very low" };
const LIMITS: Record<RangeKey, string> = { vhigh: ">250", high: "181–250", in: "70–180", low: "54–69", vlow: "<54" };
const TARGET: Record<RangeKey, string> = { vhigh: "<5%", high: "<25% (>180)", in: ">70%", low: "<4% (<70)", vlow: "<1%" };

/** Standard clinical stacked TIR bar (vertical) with labelled shares and consensus targets. */
export function TirStack({ shares, className }: { shares: RangeShares; className?: string }) {
  const H = 220;
  const GAP = 2;
  const visible = ORDER.filter((k) => shares[k] > 0);
  const avail = H - GAP * Math.max(0, visible.length - 1);
  let yAcc = 0;
  return (
    <div className={cn("flex gap-4", className)}>
      <svg width={22} height={H} className="shrink-0" role="img" aria-label="Time in ranges">
        {ORDER.map((k) => {
          if (shares[k] <= 0) return null;
          const h = Math.max(2, (shares[k] / 100) * avail);
          const y = yAcc;
          yAcc += h + GAP;
          return <rect key={k} x={0} y={y} width={22} height={h} rx={2} fill={RANGE_VAR[k]} />;
        })}
      </svg>
      <ul className="flex flex-1 flex-col justify-between py-0.5 text-[12px]">
        {ORDER.map((k) => (
          <li key={k} className="grid grid-cols-[1fr_auto] items-baseline gap-x-2">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: RANGE_VAR[k] }} />
              <span className={k === "in" ? "font-medium text-ink" : "text-body"}>{NAMES[k]}</span>
              <span className="num text-[10.5px] text-muted-ink">{LIMITS[k]}</span>
            </span>
            <span className={cn("num text-right", k === "in" ? "text-[15px] font-semibold" : "")}>{shares.n ? `${shares[k].toFixed(k === "vlow" || k === "low" ? 1 : 0)}%` : "—"}</span>
            <span className="col-span-2 text-[10.5px] text-muted-ink">Target {TARGET[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact horizontal TBR | TIR | TAR bar for table rows. */
export function TirMini({ tbr, tir, tar, className }: { tbr: number; tir: number; tar: number; className?: string }) {
  const total = tbr + tir + tar || 1;
  const segs = [
    { k: "low", v: tbr, c: "var(--r-low)" },
    { k: "in", v: tir, c: "var(--r-in)" },
    { k: "high", v: tar, c: "var(--r-high)" },
  ].filter((s) => s.v > 0);
  return (
    <div className={cn("flex h-2 w-full gap-[2px] overflow-hidden rounded-full", className)} aria-hidden>
      {segs.map((s) => (
        <div key={s.k} style={{ width: `${(s.v / total) * 100}%`, background: s.c, minWidth: 2 }} className="h-full first:rounded-l-full last:rounded-r-full" />
      ))}
    </div>
  );
}
