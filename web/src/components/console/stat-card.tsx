import { Ticker } from "@/components/motion/ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ChipTone = "pos" | "neg" | "neutral" | "warn";

const TONE: Record<ChipTone, string> = {
  pos: "var(--pos)",
  neg: "var(--neg)",
  warn: "var(--r-high)",
  neutral: "var(--muted-ink)",
};

/** OBLIQ KPI card: icon chip + label, large figure, tiny coloured context chip. */
export function StatCard({
  icon,
  label,
  value,
  digits = 0,
  suffix,
  unit,
  chip,
  chipTone = "neutral",
  className,
  valueColor,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
  unit?: string;
  chip?: string;
  chipTone?: ChipTone;
  className?: string;
  valueColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("relative min-w-0 overflow-hidden rounded-[20px] border border-line/80 p-4 shadow-[var(--shadow-card)] sm:p-5", className)}
      style={{ background: "linear-gradient(180deg, var(--card) 45%, color-mix(in oklab, var(--beige) 55%, var(--card)) 100%)" }}
    >
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-card text-body [&_svg]:size-3.5">{icon}</span>
        <span className="truncate text-[12.5px] font-medium text-body">{label}</span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1">
          {value == null || Number.isNaN(value) ? (
            <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] text-muted-ink">—</span>
          ) : (
            <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] sm:text-[30px]" style={{ color: valueColor }}>
              <Ticker value={value} digits={digits} suffix={suffix} />
            </span>
          )}
          {unit && <span className="text-[12px] font-medium text-muted-ink">{unit}</span>}
          {children}
        </div>
        {chip && (
          <span className="num shrink-0 text-[11px] font-semibold whitespace-nowrap" style={{ color: TONE[chipTone] }}>
            {chip}
          </span>
        )}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-[20px] border border-line/80 bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-3 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-5 h-7 w-20 rounded-full" />
    </div>
  );
}
