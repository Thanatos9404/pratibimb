import { cn } from "@/lib/utils";

/**
 * Pratibimb mark: a glucose waveform and its mirror reflection across a
 * horizontal axis (the twin), inside a thin circle. Hand-built SVG.
 */
export const WAVE_PATH =
  "M8 23.2C10.6 23.2 11.9 22.7 13.6 20.7C15.9 18 17.3 11.6 20.4 11.6C23.4 11.6 24 19.7 27 20.4C29.4 20.9 30.6 16.6 33.1 16.6C35.6 16.6 37 21.5 40 22.6";

export function Logo({ size = 32, className, title = "Pratibimb" }: { size?: number; className?: string; title?: string | null }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title ?? undefined}
    >
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2.2" />
      <path d="M7 24H41" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.28" strokeLinecap="round" />
      <path d={WAVE_PATH} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="matrix(1 0 0 -1 0 48)">
        <path d={WAVE_PATH} stroke="var(--logo-reflection, #6fa3e3)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Wordmark({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2 leading-none", className)}>
      <Logo size={size + 8} title={null} />
      <span className="font-bold tracking-[-0.03em]" style={{ fontSize: size }}>
        Pratibimb
      </span>
    </span>
  );
}
