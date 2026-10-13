"use client";

import { createContext, useContext, useMemo, useState } from "react";

import { useClock } from "@/lib/api/hooks";
import { ms } from "@/lib/time";

export interface LiveControl {
  running: boolean;
  toggle: () => void;
  label: string;
}

interface Ctx {
  /** demo clock "now" from the engine (ms), or null while loading */
  now: number | null;
  /** clock override while a live replay is running (ms) */
  live: number | null;
  setLive: (t: number | null) => void;
  start: number | null;
  end: number | null;
  /** a page (the patient view) can expose its live-replay toggle to the header clock pill */
  control: LiveControl | null;
  setControl: (c: LiveControl | null) => void;
}

const ClockCtx = createContext<Ctx>({ now: null, live: null, setLive: () => {}, start: null, end: null, control: null, setControl: () => {} });

export function ConsoleClockProvider({ children }: { children: React.ReactNode }) {
  const clock = useClock();
  const [live, setLive] = useState<number | null>(null);
  const [control, setControl] = useState<LiveControl | null>(null);
  const value = useMemo<Ctx>(
    () => ({
      now: clock.data ? ms(clock.data.now) : null,
      start: clock.data ? ms(clock.data.start) : null,
      end: clock.data ? ms(clock.data.end) : null,
      live,
      setLive,
      control,
      setControl,
    }),
    [clock.data, live, control],
  );
  return <ClockCtx.Provider value={value}>{children}</ClockCtx.Provider>;
}

export function useConsoleClock() {
  return useContext(ClockCtx);
}
