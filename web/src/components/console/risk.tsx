import type { Risk } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export const LEVEL_COLOR: Record<Risk["level"], string> = {
  high: "var(--alert)",
  moderate: "var(--r-high)",
  low: "var(--pos)",
};

export const LEVEL_LABEL: Record<Risk["level"], string> = { high: "High", moderate: "Moderate", low: "Low" };

export function RiskDot({ level, className }: { level: Risk["level"]; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {level === "high" && <span className="beat absolute inset-0 rounded-full" style={{ background: LEVEL_COLOR.high }} />}
      <span className="relative size-2 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
    </span>
  );
}

/** OBLIQ-style status chip: tinted pill with a dot. */
export function LevelPill({ level, className, children }: { level: Risk["level"]; className?: string; children?: React.ReactNode }) {
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium text-ink", className)}
      style={{ background: `color-mix(in oklab, ${LEVEL_COLOR[level]} 12%, var(--card))` }}
    >
      <RiskDot level={level} />
      {children ?? LEVEL_LABEL[level]}
    </span>
  );
}

export function probLevel(p: number | null | undefined, kind: "hyper_2h" | "hypo_1h" | "nocturnal_hypo"): Risk["level"] {
  if (p == null) return "low";
  const hi = kind === "hyper_2h" ? 0.5 : 0.3;
  const mid = kind === "hyper_2h" ? 0.2 : 0.1;
  return p >= hi ? "high" : p >= mid ? "moderate" : "low";
}

/** Small probability chip used in tables. */
export function ProbChip({ label, p, kind, title }: { label: string; p: number | null; kind: "hyper_2h" | "hypo_1h" | "nocturnal_hypo"; title: string }) {
  const lvl = probLevel(p, kind);
  return (
    <span
      title={title}
      className="num inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium"
      style={{
        background: lvl === "low" ? "var(--page-warm)" : `color-mix(in oklab, ${LEVEL_COLOR[lvl]} 13%, var(--card))`,
        color: lvl === "low" ? "var(--muted-ink)" : "var(--ink)",
      }}
    >
      {lvl !== "low" && <span className="size-1.5 rounded-full" style={{ background: LEVEL_COLOR[lvl] }} />}
      <span className="text-[10.5px] font-medium text-muted-ink">{label}</span>
      {p == null ? "—" : `${Math.round(p * 100)}%`}
    </span>
  );
}
