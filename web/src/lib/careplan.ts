"use client";

import { useCallback, useEffect, useState } from "react";

export interface CareNote {
  id: string;
  created: number;
  /** demo-clock time the advice refers to */
  at: string;
  title: string;
  bullets: string[];
  deltas: { label: string; baseline: string; scenario: string }[];
}

const key = (pid: string) => `pratibimb.careplan.${pid}`;
const EVT = "pratibimb:careplan";

function read(pid: string): CareNote[] {
  try {
    const raw = localStorage.getItem(key(pid));
    return raw ? (JSON.parse(raw) as CareNote[]) : [];
  } catch {
    return [];
  }
}

/** Care-plan notes saved from the What-If Lab. Local to this browser (illustrative, not a record system). */
export function useCarePlan(pid: string) {
  const [notes, setNotes] = useState<CareNote[]>([]);
  useEffect(() => {
    setNotes(read(pid));
    const on = () => setNotes(read(pid));
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener("storage", on);
    };
  }, [pid]);

  const write = useCallback(
    (next: CareNote[]) => {
      try {
        localStorage.setItem(key(pid), JSON.stringify(next));
      } catch {
        /* storage unavailable: keep in memory only */
      }
      setNotes(next);
      window.dispatchEvent(new Event(EVT));
    },
    [pid],
  );

  const add = useCallback((n: Omit<CareNote, "id" | "created">) => write([{ ...n, id: `${Date.now()}`, created: Date.now() }, ...read(pid)]), [pid, write]);
  const remove = useCallback((id: string) => write(read(pid).filter((n) => n.id !== id)), [pid, write]);
  return { notes, add, remove };
}
