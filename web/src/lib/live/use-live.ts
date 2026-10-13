"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { wsUrl, type ResolvedSource } from "@/lib/api/source";
import type { Forecast, Risk, StreamMessage } from "@/lib/api/types";
import { parseForecast, type Series } from "@/lib/series";
import { MIN, ms, toISO } from "@/lib/time";

export type Speed = 60 | 120 | 300;
type ParsedForecast = ReturnType<typeof parseForecast> & { raw: Forecast };

/**
 * Live mode.
 *  - api source: WebSocket replay from the engine (`/api/stream/{id}`), ticks appended to the series.
 *  - static source: client-side replay of the export's future timeline (now..now+3d), using the
 *    hourly forecasts (`forecasts/{id}.json`) and the 15-min risk series when present.
 * `speed` = simulated seconds per real second.
 */
export function useLive({
  source,
  patientId,
  base,
  now,
  initialForecast,
  forecastSeries,
}: {
  source: ResolvedSource | undefined;
  patientId: string;
  base: Series | undefined;
  now: number | null;
  initialForecast: Forecast | undefined;
  forecastSeries: Forecast[];
}) {
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>(120);
  const [clock, setClock] = useState<number | null>(null);
  const [series, setSeries] = useState<Series | undefined>(base);
  const [wsForecast, setWsForecast] = useState<Forecast | null>(null);
  const [wsRisk, setWsRisk] = useState<Risk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clockRef = useRef<number | null>(null);

  useEffect(() => setSeries(base), [base]);
  useEffect(() => {
    if (now != null && clockRef.current == null) {
      clockRef.current = now;
      setClock(now);
    }
  }, [now]);

  const isApi = source?.kind === "api";
  const end = base ? (isApi ? Infinity : base.to) : null;

  // ---- static replay
  useEffect(() => {
    if (!running || isApi || end == null) return;
    let acc = 0;
    let last = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now();
      acc += ((t - last) / 1000) * speed * 1000;
      last = t;
      const steps = Math.floor(acc / (5 * MIN));
      if (steps <= 0) return;
      acc -= steps * 5 * MIN;
      const next = Math.min(end, (clockRef.current ?? 0) + steps * 5 * MIN);
      clockRef.current = next;
      setClock(next);
      if (next >= end) {
        setRunning(false);
        setEnded(true);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [running, isApi, speed, end]);

  // ---- websocket replay
  useEffect(() => {
    if (!running || !isApi || !source?.apiBase || clockRef.current == null) return;
    const from = toISO(clockRef.current);
    const ws = new WebSocket(wsUrl(source.apiBase, `/api/stream/${encodeURIComponent(patientId)}?from=${encodeURIComponent(from)}&speed=${speed}`));
    wsRef.current = ws;
    setError(null);
    ws.onmessage = (ev) => {
      let msg: StreamMessage | { type: "error"; message: string };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "tick") {
        const t = ms(msg.t);
        clockRef.current = t;
        setClock(t);
        setWsRisk(msg.risk);
        setSeries((s) =>
          s
            ? {
                ...s,
                cgm: [...s.cgm, { t, g: msg.cgm }],
                twin: [...s.twin, { t, ...msg.twin }],
                hr: msg.hr != null ? [...s.hr, { t, v: msg.hr }] : s.hr,
                hrv: msg.hrv != null ? [...s.hrv, { t, v: msg.hrv }] : s.hrv,
                steps: [...s.steps, { t, v: msg.steps }],
                risk: [...s.risk, { t, hyper_2h: msg.risk.hyper_2h, hypo_1h: msg.risk.hypo_1h, nocturnal_hypo: msg.risk.nocturnal_hypo, level: msg.risk.level }],
              }
            : s,
        );
      } else if (msg.type === "meal") {
        const m = msg.meal;
        setSeries((s) => (s ? { ...s, meals: [...s.meals, { ...m, ms: ms(m.t) }] } : s));
      } else if (msg.type === "dose") {
        const d = msg.dose;
        setSeries((s) => (s ? { ...s, doses: [...s.doses, { ...d, ms: ms(d.t) }] } : s));
      } else if (msg.type === "alert") {
        const a = msg.alert;
        setSeries((s) => (s ? { ...s, alerts: [...s.alerts, { ...a, ms: ms(a.t) }] } : s));
      } else if (msg.type === "forecast") {
        setWsForecast(msg.forecast);
      } else if (msg.type === "end") {
        setRunning(false);
        setEnded(true);
      } else if (msg.type === "error") {
        setError(msg.message);
        setRunning(false);
      }
    };
    ws.onerror = () => {
      setError("Live stream connection failed.");
      setRunning(false);
    };
    return () => {
      ws.onmessage = null;
      ws.onerror = null;
      ws.close();
      wsRef.current = null;
    };
  }, [running, isApi, source?.apiBase, patientId, speed]);

  const toggle = useCallback(() => {
    if (ended) return;
    setRunning((r) => !r);
  }, [ended]);

  const reset = useCallback(() => {
    setRunning(false);
    setEnded(false);
    setWsForecast(null);
    setWsRisk(null);
    setSeries(base);
    if (now != null) {
      clockRef.current = now;
      setClock(now);
    }
  }, [base, now]);

  // current forecast + risk at the replay clock
  const parsedSeries = useMemo<ParsedForecast[]>(
    () => forecastSeries.map((f) => ({ ...parseForecast(f), raw: f })).sort((a, b) => a.at - b.at),
    [forecastSeries],
  );
  const initial = useMemo<ParsedForecast | null>(() => (initialForecast ? { ...parseForecast(initialForecast), raw: initialForecast } : null), [initialForecast]);

  const forecast = useMemo<ParsedForecast | null>(() => {
    if (isApi && wsForecast) return { ...parseForecast(wsForecast), raw: wsForecast };
    if (clock == null) return initial;
    let best = initial && initial.at <= clock ? initial : null;
    for (const f of parsedSeries) if (f.at <= clock && (!best || f.at > best.at)) best = f;
    return best ?? initial;
  }, [isApi, wsForecast, clock, initial, parsedSeries]);

  const risk = useMemo<Risk | null>(() => {
    if (isApi && wsRisk) return wsRisk;
    if (forecast && clock != null && forecast.at === clock) return forecast.raw.risk;
    const s = series?.risk;
    if (s && s.length && clock != null) {
      let r: (typeof s)[number] | null = null;
      for (const x of s) if (x.t <= clock) r = x;
      if (r && clock - r.t <= 20 * MIN) return { hyper_2h: r.hyper_2h, hypo_1h: r.hypo_1h, nocturnal_hypo: r.nocturnal_hypo, level: r.level };
    }
    return forecast?.raw.risk ?? null;
  }, [isApi, wsRisk, forecast, clock, series]);

  return {
    running,
    speed,
    setSpeed,
    clock,
    series,
    forecast,
    risk,
    error,
    ended,
    toggle,
    reset,
    moved: clock != null && now != null && clock !== now,
  };
}
