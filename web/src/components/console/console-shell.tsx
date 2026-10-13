"use client";

import { ActivityIcon, InfoIcon, LayoutGridIcon, MenuIcon, PauseIcon, PlayIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useCohort } from "@/lib/api/hooks";
import type { CohortPatient } from "@/lib/api/types";
import { fmtDay, fmtTime, istMinuteOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { CommandPalette } from "./command-palette";
import { ConsoleClockProvider, useConsoleClock } from "./console-clock";
import { DataBadge } from "./data-badge";
import { Avatar } from "./avatar";
import { RiskDot } from "./risk";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/console", label: "Cohort", icon: LayoutGridIcon, match: (p: string) => p === "/console" },
  { href: "/console/model", label: "Model card", icon: ActivityIcon, match: (p: string) => p.startsWith("/console/model") },
  { href: "/about", label: "About the twin", icon: InfoIcon, match: (p: string) => p.startsWith("/about") },
];

const openSearch = () => window.dispatchEvent(new Event("pratibimb:command"));

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const cohort = useCohort();
  const watch: CohortPatient[] = (cohort.data?.patients ?? [])
    .filter((p) => p.risk.level !== "low")
    .sort((a, b) => (a.risk.level === b.risk.level ? 0 : a.risk.level === "high" ? -1 : 1))
    .slice(0, 6);

  return (
    <div className="flex h-full flex-col">
      <Link href="/" onClick={onNavigate} className="mb-7 flex items-center gap-2.5 rounded-full px-2" aria-label="Pratibimb home">
        <Logo size={28} title={null} />
        <span className="text-[19px] font-bold tracking-[-0.03em]">Pratibimb</span>
      </Link>

      <nav aria-label="Console" className="space-y-1">
        {NAV.map((n) => {
          const active = n.match(pathname);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-full px-3.5 text-[14px] transition-colors",
                active ? "bg-beige font-semibold text-ink" : "text-body hover:bg-page-warm hover:text-ink",
              )}
            >
              <Icon className="size-[17px]" strokeWidth={1.8} />
              {n.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => { onNavigate?.(); openSearch(); }} className="flex h-10 w-full items-center gap-3 rounded-full px-3.5 text-[14px] text-body transition-colors hover:bg-page-warm hover:text-ink">
          <SearchIcon className="size-[17px]" strokeWidth={1.8} />
          Search
          <kbd className="ml-auto rounded-md border border-line px-1.5 text-[10.5px] font-medium text-muted-ink">Ctrl K</kbd>
        </button>
      </nav>

      <div className="mt-7 mb-2 border-t border-line pt-5">
        <div className="label-xs px-3.5">On watch</div>
      </div>
      <ul className="space-y-0.5">
        {cohort.status === "loading" &&
          Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex h-10 items-center gap-3 px-3.5">
              <span className="size-6 animate-pulse rounded-full bg-beige" />
              <span className="h-3 w-24 animate-pulse rounded bg-beige" />
            </li>
          ))}
        {watch.map((p) => {
          const href = `/console/patient/${p.id}`;
          const active = pathname === href;
          return (
            <li key={p.id}>
              <Link
                href={href}
                onClick={onNavigate}
                className={cn("flex h-10 items-center gap-3 rounded-full px-2.5 text-[13.5px] transition-colors", active ? "bg-beige text-ink" : "text-body hover:bg-page-warm hover:text-ink")}
              >
                <Avatar name={p.display_name} size={26} />
                <span className="min-w-0 flex-1 truncate">{p.display_name}</span>
                <RiskDot level={p.risk.level} />
              </Link>
            </li>
          );
        })}
        {cohort.status === "success" && watch.length === 0 && <li className="px-3.5 text-[12.5px] text-muted-ink">No one above low risk right now.</li>}
      </ul>

      <div className="mt-auto space-y-3 pt-6">
        <div className="rounded-2xl bg-page-warm p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <DataBadge />
            <ThemeToggle />
          </div>
          <p className="text-[11.5px] leading-snug text-muted-ink">Synthetic patients only. Not a medical device; recommendations are illustrative.</p>
        </div>
      </div>
    </div>
  );
}

function greeting(t: number | null) {
  if (t == null) return "Hello, Doctor";
  const h = istMinuteOfDay(t) / 60;
  return h < 12 ? "Good morning, Doctor" : h < 17 ? "Good afternoon, Doctor" : "Good evening, Doctor";
}

function ClockPill() {
  const { now, live, control } = useConsoleClock();
  const t = live ?? now;
  return (
    <div className="flex h-10 items-center gap-2 rounded-full border border-line bg-card pr-1 pl-3.5 shadow-[var(--shadow-card)]">
      <span className="hidden text-[11px] font-medium text-muted-ink sm:inline">{live ? "Replay" : "Demo clock"}</span>
      <span className={cn("num text-[14px] font-semibold tracking-tight", live && "text-twin")}>{t == null ? "--:--" : fmtTime(t)}</span>
      {control ? (
        <button
          type="button"
          onClick={control.toggle}
          aria-pressed={control.running}
          aria-label={control.label}
          title={control.label}
          className="inline-flex size-8 items-center justify-center rounded-full bg-ink text-page transition-transform hover:scale-105"
        >
          {control.running ? <PauseIcon className="size-3.5" fill="currentColor" /> : <PlayIcon className="ml-0.5 size-3.5" fill="currentColor" />}
        </button>
      ) : (
        <span className="mr-1.5 size-2 rounded-full bg-pos" aria-hidden />
      )}
    </div>
  );
}

function Header() {
  const { now, live } = useConsoleClock();
  const [open, setOpen] = useState(false);
  const t = live ?? now;
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-page/80 backdrop-blur-xl">
      <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button type="button" className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-card lg:hidden" aria-label="Open navigation">
              <MenuIcon className="size-4" />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-card p-5 data-[side=left]:w-[290px] data-[side=left]:sm:max-w-[290px]">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Console navigation and patients on watch</SheetDescription>
            <SidebarBody onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink sm:text-[16px]">{greeting(t)}</div>
          <div className="truncate text-[12.5px] text-muted-ink">{t == null ? "Syncing twins…" : `${fmtDay(t)} · twins synced to the demo clock`}</div>
        </div>
        <button
          type="button"
          onClick={openSearch}
          className="mx-auto hidden h-10 w-full max-w-[340px] items-center gap-2.5 rounded-full border border-line bg-card px-4 text-[13.5px] text-muted-ink shadow-[var(--shadow-card)] transition-colors hover:text-ink md:flex"
        >
          <SearchIcon className="size-4" />
          Search patients, ABHA, drugs
          <kbd className="ml-auto rounded-md border border-line px-1.5 text-[10.5px] font-medium">Ctrl K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <button type="button" onClick={openSearch} className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-card md:hidden" aria-label="Search patients">
            <SearchIcon className="size-4" />
          </button>
          <ClockPill />
        </div>
      </div>
    </header>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleClockProvider>
      <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-page">
          Skip to content
        </a>
        <div className="hidden border-r border-line bg-card lg:block">
          <aside className="thin-scroll sticky top-0 h-dvh overflow-y-auto px-4 py-6">
            <SidebarBody />
          </aside>
        </div>
        <div className="min-w-0">
          <Header />
          <main id="main" className="px-4 pt-6 pb-16 sm:px-6 lg:px-8">
            {children}
          </main>
          <footer className="px-4 pb-8 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-1 border-t border-line pt-5 text-[12px] text-muted-ink sm:flex-row sm:justify-between">
              <p>All patients are synthetic. Not a medical device. Recommendations are illustrative.</p>
              <p>Pratibimb · Apache-2.0 · Stack Underflow, BIT Mesra (Off Campus Jaipur)</p>
            </div>
          </footer>
        </div>
        <CommandPalette />
      </div>
    </ConsoleClockProvider>
  );
}
