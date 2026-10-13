"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSource } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const LABEL = { api: "Live engine", demo: "Offline demo data", mock: "Mock fixtures" } as const;
const DOT = { api: "var(--pos)", demo: "var(--r-high)", mock: "var(--alert)" } as const;

export function DataBadge({ className }: { className?: string }) {
  const src = useSource();
  if (src.status !== "success") {
    return <span className={cn("inline-flex h-7 items-center rounded-full bg-card px-2.5 text-[11.5px] text-muted-ink", className)}>Connecting…</span>;
  }
  const k = src.data.kind;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex h-7 items-center gap-2 rounded-full bg-card px-2.5 text-[11.5px] font-medium text-ink shadow-[var(--shadow-card)]", className)}
          aria-label={`Data source: ${LABEL[k]}. ${src.data.reason}`}
        >
          <span className="relative flex size-2">
            {k === "api" && <span className="beat absolute inset-0 rounded-full" style={{ background: DOT[k] }} />}
            <span className="relative size-2 rounded-full" style={{ background: DOT[k] }} />
          </span>
          {LABEL[k]}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-[12px] leading-snug">
        {src.data.reason}
        {k === "demo" && " What-If is limited to precomputed presets offline."}
        {k === "mock" && " Placeholder numbers for UI development — not results."}
      </TooltipContent>
    </Tooltip>
  );
}
