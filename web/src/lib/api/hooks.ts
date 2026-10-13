"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./client";
import type { ResolvedSource } from "./source";

export type AsyncState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "error"; data?: undefined; error: Error }
  | { status: "success"; data: T; error?: undefined };

/**
 * Minimal data hook: runs `fn` when `key` changes, exposes loading/error/success
 * and a `retry`. `key = null` pauses the request.
 */
export function useAsync<T>(key: string | null, fn: () => Promise<T>): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (key == null) return;
    let alive = true;
    setState((s) => (s.status === "success" ? s : { status: "loading" }));
    fnRef
      .current()
      .then((data) => alive && setState({ status: "success", data }))
      .catch((error: Error) => alive && setState({ status: "error", error }));
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

export function useSource() {
  return useAsync<ResolvedSource>("source", api.source);
}

export function useClock() {
  return useAsync("clock", api.clock);
}

export function useCohort() {
  return useAsync("cohort", api.cohort);
}

export function usePatient(id: string) {
  return useAsync(`patient:${id}`, () => api.patient(id));
}

export function useTimeline(id: string) {
  return useAsync(`timeline:${id}`, () => api.timeline(id));
}

export function useForecast(id: string) {
  return useAsync(`forecast:${id}`, () => api.forecast(id));
}

export function useFoods() {
  return useAsync("foods", api.foods);
}

export function useMetrics() {
  return useAsync("metrics", api.metrics);
}

export function useValidation() {
  return useAsync("validation", api.validation);
}
