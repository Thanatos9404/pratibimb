import { cn } from "@/lib/utils";

const TINTS = [
  ["#dce9f8", "#2b5ea8"],
  ["#f1e4d6", "#7a5236"],
  ["#e1ece3", "#2f6a48"],
  ["#f5e1de", "#9a3b33"],
  ["#ece6f3", "#5a4a7a"],
  ["#f6ecd2", "#7a5b12"],
] as const;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Initials avatar for synthetic patients (no photos of people). */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const [bg, fg] = TINTS[hash(name) % TINTS.length];
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.02em]", className)}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.38), boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.6)" }}
    >
      {initials}
    </span>
  );
}
