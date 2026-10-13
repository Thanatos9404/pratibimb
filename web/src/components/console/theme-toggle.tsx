"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full bg-card text-body shadow-[var(--shadow-card)] transition-colors hover:text-ink",
        className,
      )}
      aria-label={mounted ? `Switch to ${dark ? "light" : "dark"} theme` : "Toggle theme"}
    >
      {mounted ? dark ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" /> : <span className="size-3.5" />}
    </button>
  );
}
