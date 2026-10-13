"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Number ticker. Renders the final value on the server (no hydration
 * mismatch), then counts up from `from` when scrolled into view.
 */
export function Ticker({
  value,
  digits = 0,
  from = 0,
  duration = 1.2,
  className,
  suffix = "",
  once = true,
}: {
  value: number;
  digits?: number;
  from?: number;
  duration?: number;
  className?: string;
  suffix?: string;
  once?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const last = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!reduce && last.current == null && ref.current) ref.current.textContent = from.toFixed(digits) + suffix;
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    const start = last.current ?? from;
    if (reduce) {
      el.textContent = value.toFixed(digits) + suffix;
      last.current = value;
      return;
    }
    const ctrl = animate(start, value, {
      duration: last.current == null ? duration : 0.5,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = v.toFixed(digits) + suffix;
      },
    });
    last.current = value;
    return () => ctrl.stop();
  }, [inView, value, digits, from, duration, reduce, suffix]);

  return (
    <span ref={ref} className={className}>
      {value.toFixed(digits) + suffix}
    </span>
  );
}
