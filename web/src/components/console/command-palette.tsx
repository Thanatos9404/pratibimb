"use client";

import { ActivityIcon, FileTextIcon, HomeIcon, LayoutListIcon, MoonIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";

import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useCohort } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import { RiskDot } from "./risk";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const cohort = useCohort();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pratibimb:command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pratibimb:command", onOpen);
    };
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search patients and actions" description="Type a name, ABHA number or subtype">
      <Command>
      <CommandInput placeholder="Search patients by name, ABHA, subtype…" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No match.</CommandEmpty>
        <CommandGroup heading="Patients">
          {cohort.data?.patients.map((p) => (
            <CommandItem key={p.id} value={`${p.display_name} ${p.abha} ${p.inferred_subtype} ${p.id} ${p.meds.join(" ")}`} onSelect={() => go(`/console/patient/${p.id}`)}>
              <RiskDot level={p.risk.level} />
              <span className="flex-1 truncate">{p.display_name}</span>
              <span className="num text-[11px] text-muted-ink">{p.inferred_subtype}</span>
              <span className="num hidden text-[11px] text-muted-ink sm:inline">{p.abha}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem value="cohort triage" onSelect={() => go("/console")}>
            <LayoutListIcon /> Cohort triage
          </CommandItem>
          <CommandItem value="model card metrics evaluation" onSelect={() => go("/console/model")}>
            <ActivityIcon /> Model card
          </CommandItem>
          <CommandItem value="about architecture team" onSelect={() => go("/about")}>
            <FileTextIcon /> About & architecture
          </CommandItem>
          <CommandItem value="landing home" onSelect={() => go("/")}>
            <HomeIcon /> Landing page
          </CommandItem>
          <CommandItem
            value="toggle theme dark light"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setOpen(false);
            }}
          >
            <MoonIcon /> Toggle theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function CommandButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("pratibimb:command"))}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border border-line bg-card pr-1.5 pl-3 text-[12px] text-muted-ink transition-colors hover:border-ink/30 hover:text-ink",
        className,
      )}
      aria-label="Search patients (Ctrl+K)"
    >
      <SearchIcon className="size-3.5" />
      <span className="hidden md:inline">Search patients</span>
      <CommandShortcut className="num ml-1 hidden rounded border border-line px-1.5 py-px text-[10px] tracking-normal md:inline">Ctrl K</CommandShortcut>
    </button>
  );
}
