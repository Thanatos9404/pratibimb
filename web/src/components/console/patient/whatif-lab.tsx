"use client";

import { FlaskConicalIcon, MinusIcon, PlusIcon, SparklesIcon, Trash2Icon, UtensilsIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { WhatIfChart } from "@/components/charts/whatif-chart";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { useAsync, useFoods, useSource } from "@/lib/api/hooks";
import type { Food, PatientDetail, WhatIfMetrics, WhatIfPreset, WhatIfRequest, WhatIfResponse } from "@/lib/api/types";
import { useCarePlan } from "@/lib/careplan";
import { MIN, fmtDayTime, fmtTime, ms, toISO } from "@/lib/time";
import { cn } from "@/lib/utils";

import { ErrorBlock, Segmented } from "../panel";

interface MealDraft {
  offset: number;
  items: { food_id: string; portions: number }[];
}

const METRIC_ROWS: { key: keyof WhatIfMetrics; label: string; unit: string; better: "lower" | "higher"; fmt: (v: number) => string }[] = [
  { key: "peak", label: "Peak glucose", unit: "mg/dL", better: "lower", fmt: (v) => v.toFixed(0) },
  { key: "nadir", label: "Lowest glucose", unit: "mg/dL", better: "higher", fmt: (v) => v.toFixed(0) },
  { key: "min_above_180", label: "Time above 180", unit: "min", better: "lower", fmt: (v) => v.toFixed(0) },
  { key: "min_below_70", label: "Time below 70", unit: "min", better: "lower", fmt: (v) => v.toFixed(0) },
  { key: "hypo_probability", label: "Hypo probability", unit: "%", better: "lower", fmt: (v) => (v * 100).toFixed(0) },
  { key: "tir", label: "Time in range", unit: "%", better: "higher", fmt: (v) => v.toFixed(0) },
];

function FoodPicker({ foods, onPick }: { foods: Food[]; onPick: (f: Food) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const g: Record<string, Food[]> = {};
    for (const f of foods) (g[f.category] ??= []).push(f);
    return Object.entries(g);
  }, [foods]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-line bg-card px-4 text-[13px] font-medium text-ink hover:border-ink/40">
          <PlusIcon className="size-3.5" /> Add Indian food
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,380px)] rounded-2xl p-0">
        <Command>
          <CommandInput placeholder="Search roti, बाजरा, idli, chai…" />
          <CommandList className="max-h-[320px]" data-lenis-prevent>
            <CommandEmpty>No food found.</CommandEmpty>
            {groups.map(([cat, list]) => (
              <CommandGroup key={cat} heading={cat.replace(/_/g, " ")}>
                {list.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`${f.name} ${f.name_hi} ${f.id} ${f.category}`}
                    onSelect={() => {
                      onPick(f);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">
                        {f.name} <span className="font-deva text-[12px] text-muted-ink">{f.name_hi}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted-ink">{f.serving_desc}</div>
                    </div>
                    <div className="num text-right text-[11px] text-muted-ink">
                      {Math.round(f.carbs_g)} g<br />
                      GI {f.gi}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Field({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold tracking-[-0.015em]">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function WhatIfLab({ patient, clock, now, trigger }: { patient: PatientDetail; clock: number; now: number; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const src = useSource();
  const live = src.data?.kind === "api";
  const foods = useFoods();
  const presets = useAsync(open ? `presets:${patient.id}` : null, () => api.presets(patient.id));
  const foodById = useMemo(() => Object.fromEntries((foods.data?.foods ?? []).map((f) => [f.id, f])), [foods.data]);
  const care = useCarePlan(patient.id);

  const defaultOffset = presets.data?.find((p) => p.request?.scenario.meals?.length)?.request?.scenario.meals?.[0]?.offset_min ?? 90;
  const [meals, setMeals] = useState<MealDraft[]>([{ offset: 90, items: [] }]);
  const [replace, setReplace] = useState(true);
  const [walkOn, setWalkOn] = useState(false);
  const [walk, setWalk] = useState({ offset: 120, duration: 15, intensity: "brisk" as "light" | "brisk" });
  const [doseMode, setDoseMode] = useState<"none" | "skip" | "shift">("none");
  const drugs = patient.medications.map((m) => ({ key: m.drug ?? m.name, label: `${m.name} ${m.dose}` }));
  const [doseDrug, setDoseDrug] = useState(drugs[0]?.key ?? "");
  const [shiftMin, setShiftMin] = useState(60);
  const [sleepOn, setSleepOn] = useState(false);
  const [sleepH, setSleepH] = useState(5);

  const [result, setResult] = useState<{ res: WhatIfResponse; title: string } | null>(null);
  // The simulated window comes from the response itself: presets may start earlier than "now"
  // (e.g. a skipped-dose replay from 30 min before this morning's dose) and run 6 h, not 5.
  const win = useMemo(() => {
    if (!result) return null;
    const pts = result.res.baseline;
    const start = ms(result.res.at);
    const end = pts.length ? ms(pts[pts.length - 1].t) : start;
    return { start, hours: Math.round(((end - start) / 3_600_000) * 10) / 10 };
  }, [result]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);

  const runPreset = async (p: WhatIfPreset) => {
    setBusy(p.id);
    setErr(null);
    try {
      setResult({ res: await api.preset(patient.id, p), title: p.label });
      setSaved(false);
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(null);
    }
  };

  const buildRequest = (): WhatIfRequest => {
    const scenario: WhatIfRequest["scenario"] = {};
    const m = meals.filter((x) => x.items.length);
    if (m.length) {
      scenario.meals = m.map((x) => ({ offset_min: x.offset, items: x.items }));
      scenario.replace_planned_meals = replace;
    }
    if (walkOn) scenario.walk = { offset_min: walk.offset, duration_min: walk.duration, intensity: walk.intensity };
    if (doseMode === "skip" && doseDrug) scenario.skip_dose = doseDrug;
    if (doseMode === "shift" && doseDrug) scenario.shift_dose = { drug: doseDrug, offset_min: shiftMin };
    if (sleepOn) scenario.sleep_hours_last_night = sleepH;
    return { ...(clock !== now ? { at: toISO(clock) } : {}), horizon_min: 300, scenario };
  };

  const runCustom = async () => {
    setBusy("custom");
    setErr(null);
    try {
      const res = await api.whatif(patient.id, buildRequest());
      const parts = [
        meals.some((x) => x.items.length) && "meal change",
        walkOn && `${walk.duration}-min ${walk.intensity} walk`,
        doseMode !== "none" && `${doseMode} ${doseDrug}`,
        sleepOn && `${sleepH} h sleep`,
      ].filter(Boolean);
      setResult({ res, title: `Custom scenario: ${parts.join(", ") || "no change"}` });
      setSaved(false);
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(null);
    }
  };

  const hasChange = meals.some((x) => x.items.length) || walkOn || doseMode !== "none" || sleepOn;
  const offLabel = (o: number) => `${fmtTime(clock + o * MIN)} (+${o} min)`;

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (o) setMeals((m) => (m[0].items.length ? m : [{ offset: defaultOffset, items: [] }])); }}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="gap-0 overflow-y-auto bg-page p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[1040px]" data-lenis-prevent>
        <SheetHeader className="border-b border-line bg-card px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-ink text-page">
              <FlaskConicalIcon className="size-4.5" />
            </span>
            <div>
              <SheetTitle className="text-[18px] font-semibold tracking-[-0.025em]">What-If Lab · {patient.display_name}</SheetTitle>
              <SheetDescription className="text-[12.5px]">
                {win && Math.abs(win.start - (live ? clock : now)) > 5 * MIN
                  ? `This scenario runs ${win.hours} h from ${fmtDayTime(win.start)} on the synced twin`
                  : `Simulate the next ${win ? win.hours : 5} h from the synced twin at ${fmtDayTime(live ? clock : now)}`}
                {live ? "" : " (precomputed)"}. Illustrative, not a prescription.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Field title="Precomputed scenarios" aside={<span className="text-[11.5px] text-muted-ink">by the engine</span>}>
              {presets.status === "loading" ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 rounded-full" />
                  <Skeleton className="h-10 rounded-full" />
                </div>
              ) : presets.data && presets.data.length ? (
                <div className="flex flex-col gap-2">
                  {presets.data.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => runPreset(p)}
                      disabled={busy != null}
                      className={cn(
                        "flex min-h-10 items-center justify-between gap-3 rounded-full border px-4 py-2 text-left text-[13px] font-medium transition-colors",
                        result?.title === p.label ? "border-ink bg-ink text-page" : "border-line bg-card text-ink hover:bg-page-warm",
                      )}
                    >
                      {p.label}
                      {busy === p.id && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-muted-ink">No precomputed scenarios for this patient.</p>
              )}
            </Field>

            <fieldset disabled={!live} className="space-y-4 disabled:opacity-60">
              {!live && (
                <p className="rounded-2xl bg-page-warm px-4 py-3 text-[12.5px] leading-snug text-body">
                  Custom scenarios run on the live engine. Start the API and set <span className="font-mono text-[11.5px]">NEXT_PUBLIC_DATA_SOURCE=api</span> to build your own; offline, use the presets above.
                </p>
              )}
              <Field title="Meals" aside={<label className="flex items-center gap-2 text-[12px] text-body">Replace planned meals <Switch checked={replace} onCheckedChange={setReplace} /></label>}>
                {meals.map((m, mi) => (
                  <div key={mi} className="space-y-3">
                    <div>
                      <div className="mb-2 flex justify-between text-[12px] text-muted-ink">
                        <span>Eaten at</span>
                        <span className="num font-medium text-ink">{offLabel(m.offset)}</span>
                      </div>
                      <Slider value={[m.offset]} min={0} max={240} step={15} onValueChange={([v]) => setMeals((x) => x.map((y, j) => (j === mi ? { ...y, offset: v } : y)))} aria-label="Meal time offset" />
                    </div>
                    <ul className="space-y-1.5">
                      {m.items.map((it, ii) => {
                        const f = foodById[it.food_id];
                        return (
                          <li key={it.food_id} className="flex items-center gap-2 rounded-2xl bg-page px-3 py-2">
                            <UtensilsIcon className="size-3.5 shrink-0 text-muted-ink" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12.5px] font-medium">
                                {f?.name ?? it.food_id} <span className="font-deva text-[11.5px] text-muted-ink">{f?.name_hi}</span>
                              </div>
                              <div className="num text-[11px] text-muted-ink">{f ? `${Math.round(f.carbs_g * it.portions)} g carbs · GI ${f.gi}` : ""}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button type="button" aria-label="Fewer portions" className="inline-flex size-7 items-center justify-center rounded-full bg-card" onClick={() => setMeals((x) => x.map((y, j) => (j === mi ? { ...y, items: y.items.map((z, k) => (k === ii ? { ...z, portions: Math.max(0.5, z.portions - 0.5) } : z)) } : y)))}>
                                <MinusIcon className="size-3" />
                              </button>
                              <span className="num w-8 text-center text-[12.5px] font-semibold">{it.portions}×</span>
                              <button type="button" aria-label="More portions" className="inline-flex size-7 items-center justify-center rounded-full bg-card" onClick={() => setMeals((x) => x.map((y, j) => (j === mi ? { ...y, items: y.items.map((z, k) => (k === ii ? { ...z, portions: Math.min(4, z.portions + 0.5) } : z)) } : y)))}>
                                <PlusIcon className="size-3" />
                              </button>
                              <button type="button" aria-label="Remove food" className="inline-flex size-7 items-center justify-center rounded-full text-muted-ink hover:text-ink" onClick={() => setMeals((x) => x.map((y, j) => (j === mi ? { ...y, items: y.items.filter((_, k) => k !== ii) } : y)))}>
                                <Trash2Icon className="size-3" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {foods.data && (
                      <FoodPicker
                        foods={foods.data.foods}
                        onPick={(f) => setMeals((x) => x.map((y, j) => (j === mi && !y.items.some((z) => z.food_id === f.id) ? { ...y, items: [...y.items, { food_id: f.id, portions: 1 }] } : y)))}
                      />
                    )}
                  </div>
                ))}
              </Field>

              <Field title="Walk" aside={<Switch checked={walkOn} onCheckedChange={setWalkOn} aria-label="Add a walk" />}>
                <div className={cn("space-y-3", !walkOn && "opacity-50")}>
                  <div className="flex justify-between text-[12px] text-muted-ink">
                    <span>Starts</span>
                    <span className="num font-medium text-ink">{offLabel(walk.offset)}</span>
                  </div>
                  <Slider disabled={!walkOn} value={[walk.offset]} min={0} max={240} step={5} onValueChange={([v]) => setWalk((w) => ({ ...w, offset: v }))} aria-label="Walk start offset" />
                  <div className="flex justify-between text-[12px] text-muted-ink">
                    <span>Duration</span>
                    <span className="num font-medium text-ink">{walk.duration} min</span>
                  </div>
                  <Slider disabled={!walkOn} value={[walk.duration]} min={5} max={60} step={5} onValueChange={([v]) => setWalk((w) => ({ ...w, duration: v }))} aria-label="Walk duration" />
                  <Segmented label="Walk intensity" value={walk.intensity} onChange={(v) => setWalk((w) => ({ ...w, intensity: v }))} options={[{ value: "light", label: "Light" }, { value: "brisk", label: "Brisk" }]} />
                </div>
              </Field>

              <Field title="Medication">
                <div className="space-y-3">
                  <Segmented label="Dose change" value={doseMode} onChange={setDoseMode} options={[{ value: "none", label: "As prescribed" }, { value: "skip", label: "Skip next" }, { value: "shift", label: "Shift" }]} />
                  {doseMode !== "none" && (
                    <>
                      <select value={doseDrug} onChange={(e) => setDoseDrug(e.target.value)} className="h-10 w-full rounded-full border border-line bg-card px-4 text-[13px]" aria-label="Drug">
                        {drugs.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      {doseMode === "shift" && (
                        <>
                          <div className="flex justify-between text-[12px] text-muted-ink">
                            <span>Shift by</span>
                            <span className="num font-medium text-ink">{shiftMin > 0 ? "+" : ""}{shiftMin} min</span>
                          </div>
                          <Slider value={[shiftMin]} min={-120} max={180} step={15} onValueChange={([v]) => setShiftMin(v)} aria-label="Dose shift" />
                        </>
                      )}
                    </>
                  )}
                </div>
              </Field>

              <Field title="Last night’s sleep" aside={<Switch checked={sleepOn} onCheckedChange={setSleepOn} aria-label="Override last night's sleep" />}>
                <div className={cn("space-y-3", !sleepOn && "opacity-50")}>
                  <div className="flex justify-between text-[12px] text-muted-ink">
                    <span>Hours asleep</span>
                    <span className="num font-medium text-ink">{sleepH.toFixed(1)} h</span>
                  </div>
                  <Slider disabled={!sleepOn} value={[sleepH]} min={3} max={9} step={0.5} onValueChange={([v]) => setSleepH(v)} aria-label="Sleep hours" />
                </div>
              </Field>

              <button type="button" onClick={runCustom} disabled={!hasChange || busy != null} className="pill-dark w-full disabled:opacity-40">
                {busy === "custom" ? "Simulating…" : "Run on the twin"}
              </button>
            </fieldset>
          </div>

          <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
            {err && <ErrorBlock error={err} />}
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div key={result.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="space-y-4">
                  <section className="rounded-3xl bg-card p-5 shadow-[var(--shadow-card)]">
                    <div className="mb-1 text-[11.5px] font-medium text-muted-ink">Scenario</div>
                    <h3 className="mb-4 text-[17px] font-semibold tracking-[-0.025em]">{result.title}</h3>
                    <WhatIfChart baseline={result.res.baseline} scenario={result.res.scenario} />
                  </section>
                  <section className="overflow-hidden rounded-3xl bg-card shadow-[var(--shadow-card)]">
                    <table className="w-full text-[13px]">
                      <thead className="bg-page-warm">
                        <tr className="label-xs text-left">
                          <th className="px-5 py-2.5 font-medium">{win ? `${win.hours} h from ${fmtTime(win.start)}` : "Next 5 h"}</th>
                          <th className="px-2 py-2.5 text-right font-medium">Baseline</th>
                          <th className="px-2 py-2.5 text-right font-medium">Scenario</th>
                          <th className="px-5 py-2.5 text-right font-medium">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {METRIC_ROWS.map((r) => {
                          const a = result.res.metrics.baseline[r.key];
                          const b = result.res.metrics.scenario[r.key];
                          const d = b - a;
                          const good = r.better === "lower" ? d < 0 : d > 0;
                          const zero = Math.abs(d) < (r.key === "hypo_probability" ? 0.005 : 0.5);
                          return (
                            <tr key={r.key} className="border-t border-line-2">
                              <td className="px-5 py-2.5 text-body">{r.label}</td>
                              <td className="num px-2 py-2.5 text-right">{r.fmt(a)}</td>
                              <td className="num px-2 py-2.5 text-right font-semibold">{r.fmt(b)}</td>
                              <td className="px-5 py-2.5 text-right">
                                <span
                                  className="num inline-flex h-6 items-center rounded-full px-2 text-[11.5px] font-semibold"
                                  style={{
                                    color: zero ? "var(--muted-ink)" : good ? "var(--pos)" : "var(--neg)",
                                    background: zero ? "var(--page-warm)" : `color-mix(in oklab, ${good ? "var(--pos)" : "var(--neg)"} 10%, var(--card))`,
                                  }}
                                >
                                  {zero ? "±0" : `${d > 0 ? "+" : "−"}${r.fmt(Math.abs(d))}`} {r.unit}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                  <section className="rounded-3xl bg-card p-5 shadow-[var(--shadow-card)]">
                    <h4 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
                      <SparklesIcon className="size-4 text-twin" /> What the twin expects
                    </h4>
                    <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-body">
                      {result.res.narrative.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={saved}
                        onClick={() => {
                          care.add({
                            title: result.title,
                            at: fmtDayTime(clock),
                            bullets: result.res.narrative,
                            deltas: METRIC_ROWS.filter((r) => ["peak", "min_above_180", "hypo_probability"].includes(r.key)).map((r) => ({
                              label: r.label,
                              baseline: `${r.fmt(result.res.metrics.baseline[r.key])}${r.unit === "%" ? "%" : ""}`,
                              scenario: `${r.fmt(result.res.metrics.scenario[r.key])}${r.unit === "%" ? "%" : ""}`,
                            })),
                          });
                          setSaved(true);
                        }}
                        className="pill-dark h-11 disabled:opacity-60"
                      >
                        {saved ? "Saved to care plan" : "Save as advice"}
                      </button>
                      <span className="text-[11.5px] text-muted-ink">Appears in the Care plan card. Illustrative only.</span>
                    </div>
                  </section>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl bg-card p-8 text-center shadow-[var(--shadow-card)]">
                  <FlaskConicalIcon className="mb-3 size-6 text-twin" />
                  <p className="max-w-[300px] text-[14px] font-semibold tracking-[-0.015em]">Pick a scenario to see baseline and scenario side by side.</p>
                  <p className="mt-1 max-w-[300px] text-[12.5px] text-muted-ink">Bands are the twin ensemble’s p10–p90 over the next five hours.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
