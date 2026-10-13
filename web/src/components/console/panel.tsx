"use client";

import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useSource } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/** OBLIQ-style dashboard card: white, 24px radius, soft warm shadow, title row with optional pill actions. */
export function Panel({
  title,
  kicker,
  actions,
  children,
  className,
  bodyClassName,
  id,
  icon,
}: {
  title: React.ReactNode;
  kicker?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  icon?: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn("min-w-0 rounded-3xl border border-line/80 bg-card shadow-[var(--shadow-card)]", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-2 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-body">{icon}</span>}
          <div className="min-w-0">
            <h2 id={id ? `${id}-title` : undefined} className="text-[15.5px] font-semibold tracking-[-0.02em] text-ink">
              {title}
            </h2>
            {kicker && <p className="mt-0.5 text-[12.5px] text-muted-ink">{kicker}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-5 sm:p-6", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelSkeleton({ className, rows = 3, chart = true }: { className?: string; rows?: number; chart?: boolean }) {
  return (
    <div className={cn("rounded-3xl border border-line/80 bg-card p-6 shadow-[var(--shadow-card)]", className)} aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-5 h-5 w-40 rounded-full" />
      {chart && <Skeleton className="mb-4 h-48 w-full rounded-2xl" />}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="mb-2 h-4 rounded-full" style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, className }: { error: Error; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-3xl border border-line bg-card p-6", className)}>
      <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <AlertTriangleIcon className="size-4 text-alert" />
        Couldn’t load this data
      </div>
      <p className="max-w-prose font-mono text-[11.5px] break-all text-muted-ink">{error.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-semibold text-page">
          <RotateCwIcon className="size-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-1 rounded-2xl bg-page-warm px-4 py-5", className)}>
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      {children && <p className="text-[12.5px] text-muted-ink">{children}</p>}
    </div>
  );
}

/** Loud stamp shown whenever numbers come from development fixtures. */
export function MockStamp({ className }: { className?: string }) {
  const src = useSource();
  if (src.data?.kind !== "mock") return null;
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 text-[12.5px] text-body", className)} style={{ background: "color-mix(in oklab, var(--alert) 8%, var(--card))" }}>
      <span className="mt-px rounded-full bg-alert px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">Mock</span>
      <p>These numbers are development fixtures, not results. The engine’s export (/demo) or the live API replaces them automatically.</p>
    </div>
  );
}

/** Segmented pill control (OBLIQ "Mobile App / Web App" style). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-page-warm p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full font-semibold transition-all",
              size === "sm" ? "h-7 px-3 text-[12px]" : "h-9 px-4 text-[13px]",
              on ? "bg-card text-ink shadow-[0_1px_3px_rgb(97_74_68/0.18)]" : "text-muted-ink hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
