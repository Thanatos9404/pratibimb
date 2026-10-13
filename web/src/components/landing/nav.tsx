"use client";

import { ArrowRightIcon, MenuIcon } from "lucide-react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how", label: "How it works" },
  { href: "#whatif", label: "What-If" },
  { href: "#evidence", label: "Evidence" },
  { href: "#india", label: "India" },
  { href: "#team", label: "Team" },
];

/** OBLIQ nav: a transparent full-width bar that condenses into a frosted pill on scroll. */
export function LandingNav() {
  const { scrollY } = useScroll();
  const [pill, setPill] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setPill(v > 60));
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:pt-4">
      <motion.nav
        layout
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        aria-label="Primary"
        className={cn(
          "flex w-full items-center gap-4 rounded-full transition-[background,box-shadow] duration-300",
          pill ? "frost max-w-[880px] py-2 pr-2 pl-5 shadow-[0_8px_30px_-12px_rgb(97_74_68/0.3)] ring-1 ring-white/70" : "max-w-[1180px] py-2 pr-2 pl-3",
        )}
      >
        <Link href="/" className="flex items-center gap-2 rounded-full" aria-label="Pratibimb home">
          <Logo size={30} title={null} />
          <span className="text-[19px] font-bold tracking-[-0.035em] text-ink">Pratibimb</span>
        </Link>
        <ul className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="rounded-full px-3 py-2 text-[15px] text-ink/85 transition-colors hover:bg-white/50 hover:text-ink">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <Link href="/console" className="pill-dark ml-auto hidden h-12 px-5 md:ml-0 md:inline-flex">
          Open console <ArrowRightIcon className="arrow size-4" />
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button type="button" className="frost ml-auto inline-flex size-11 items-center justify-center rounded-full ring-1 ring-white/70 md:hidden" aria-label="Open menu">
              <MenuIcon className="size-4.5" />
            </button>
          </SheetTrigger>
          <SheetContent side="top" className="rounded-b-[28px] bg-[#f9f8f8] px-6 pt-6 pb-8">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Page sections</SheetDescription>
            <ul className="mt-6 space-y-1">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} onClick={() => setOpen(false)} className="block rounded-2xl px-3 py-3 text-[18px] font-semibold tracking-[-0.02em] text-ink hover:bg-page-warm">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <Link href="/console" className="pill-dark mt-4 w-full">
              Open clinician console <ArrowRightIcon className="arrow size-4" />
            </Link>
          </SheetContent>
        </Sheet>
      </motion.nav>
    </header>
  );
}
