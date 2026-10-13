"use client";

import { CheckIcon, CopyIcon, FileJson2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api/client";
import { useAsync } from "@/lib/api/hooks";
import type { PatientDetail } from "@/lib/api/types";
import { fmtDate, ms } from "@/lib/time";

import { Avatar } from "../avatar";
import { ErrorBlock } from "../panel";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function JsonView({ value }: { value: unknown }) {
  const lines = useMemo(() => JSON.stringify(value, null, 2).split("\n"), [value]);
  return (
    <pre className="thin-scroll max-h-[60vh] overflow-auto rounded-2xl bg-[#1a1615] p-4 font-mono text-[11.5px] leading-[1.6] text-[#e9e2dc]" data-lenis-prevent>
      {lines.map((ln, i) => {
        const parts: React.ReactNode[] = [];
        let last = 0;
        ln.replace(TOKEN, (m, str, colon, lit, numv, off: number) => {
          if (off > last) parts.push(ln.slice(last, off));
          if (str) parts.push(<span key={off} style={{ color: colon ? "#9cc1e7" : "#e6c79c" }}>{str}</span>, colon ?? "");
          else if (lit) parts.push(<span key={off} style={{ color: "#f0a3b5" }}>{lit}</span>);
          else if (numv) parts.push(<span key={off} style={{ color: "#a6dcb4" }}>{numv}</span>);
          last = off + m.length;
          return m;
        });
        if (last < ln.length) parts.push(ln.slice(last));
        return (
          <div key={i}>
            <span className="mr-3 inline-block w-8 text-right text-[#6c6663] select-none">{i + 1}</span>
            {parts}
          </div>
        );
      })}
    </pre>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-2 py-2.5 text-[13px] last:border-0">
      <dt className="text-muted-ink">{k}</dt>
      <dd className="num text-right font-medium text-ink">{v}</dd>
    </div>
  );
}

export function EhrSheet({ patient, trigger }: { patient: PatientDetail; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const fhir = useAsync(open ? `fhir:${patient.id}` : null, () => api.fhir(patient.id));
  const [copied, setCopied] = useState(false);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of fhir.data?.bundle.entry ?? []) c[e.resource.resourceType] = (c[e.resource.resourceType] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [fhir.data]);
  const labs = [...patient.labs].sort((a, b) => a.name.localeCompare(b.name) || b.date.localeCompare(a.date));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="gap-0 overflow-y-auto bg-page p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]" data-lenis-prevent>
        <SheetHeader className="border-b border-line bg-card px-6 py-5">
          <div className="flex items-center gap-3">
            <Avatar name={patient.display_name} size={40} />
            <div>
              <SheetTitle className="text-[18px] font-semibold tracking-[-0.025em]">{patient.display_name}</SheetTitle>
              <SheetDescription className="num text-[12.5px]">
                Electronic health record · ABHA {patient.abha} · synthetic
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <Tabs defaultValue="summary" className="px-4 py-4 sm:px-6">
          <TabsList className="mb-4 w-full justify-start overflow-x-auto rounded-full bg-page-warm p-1">
            {["summary", "labs", "medications", "genetics", "fhir"].map((t) => (
              <TabsTrigger key={t} value={t} className="rounded-full px-3 text-[12.5px] capitalize">
                {t === "fhir" ? "FHIR R4" : t}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="summary" className="space-y-4">
            <div className="rounded-3xl bg-card p-5 shadow-[var(--shadow-card)]">
              <dl>
                <Row k="Age / sex" v={`${patient.age} / ${patient.sex === "F" ? "Female" : "Male"}`} />
                <Row k="Region" v={patient.region} />
                <Row k="Height · weight" v={`${patient.height_cm} cm · ${patient.weight_kg} kg`} />
                <Row k="BMI (Asian cut-offs: 23 / 25)" v={`${patient.bmi} kg/m²`} />
                <Row k="Waist" v={`${patient.waist_cm} cm`} />
                <Row k="Diabetes duration" v={`${patient.diabetes_years} years`} />
                <Row k="HbA1c" v={`${patient.hba1c}%`} />
              </dl>
            </div>
            <div className="rounded-3xl bg-card p-5 shadow-[var(--shadow-card)]">
              <h3 className="mb-2 text-[14px] font-semibold">Conditions</h3>
              <ul className="space-y-2">
                {patient.conditions.map((c) => (
                  <li key={c.code + c.display} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="text-ink">{c.display}</span>
                    <span className="num shrink-0 text-[11.5px] text-muted-ink">
                      SNOMED {c.code}
                      {c.onset ? ` · since ${fmtDate(ms(c.onset))}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="labs">
            <div className="overflow-hidden rounded-3xl bg-card shadow-[var(--shadow-card)]">
              <table className="w-full text-[12.5px]">
                <thead className="bg-page-warm text-left">
                  <tr className="label-xs">
                    <th className="px-4 py-2.5 font-medium">Test</th>
                    <th className="px-2 py-2.5 font-medium">Value</th>
                    <th className="hidden px-2 py-2.5 font-medium sm:table-cell">Ref.</th>
                    <th className="px-4 py-2.5 text-right font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {labs.map((l, i) => (
                    <tr key={i} className="border-t border-line-2">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-ink">{l.name}</div>
                        <div className="num text-[11px] text-muted-ink">LOINC {l.loinc}</div>
                      </td>
                      <td className="num px-2 py-2.5 font-semibold whitespace-nowrap">
                        {l.value} <span className="font-normal text-muted-ink">{l.unit}</span>
                      </td>
                      <td className="hidden px-2 py-2.5 text-muted-ink sm:table-cell">{l.ref}</td>
                      <td className="num px-4 py-2.5 text-right whitespace-nowrap text-muted-ink">{fmtDate(ms(l.date))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="medications" className="space-y-2">
            {patient.medications.map((m) => (
              <div key={m.name + m.dose} className="flex items-center justify-between gap-3 rounded-3xl bg-card p-4 shadow-[var(--shadow-card)]">
                <div>
                  <div className="text-[14px] font-semibold">
                    {m.name} <span className="font-normal text-body">{m.dose}</span>
                  </div>
                  <div className="text-[12px] text-muted-ink">{m.drug_class}</div>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {m.times.map((t) => (
                    <span key={t} className="num inline-flex h-6 items-center rounded-full bg-page-warm px-2.5 text-[11.5px]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="genetics" className="space-y-2">
            {patient.genetics.map((g) => (
              <div key={g.marker} className="rounded-3xl bg-card p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-semibold">{g.marker}</span>
                  <span className="num text-[14px] font-semibold text-twin">{g.value}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-body">{g.note}</p>
              </div>
            ))}
            <p className="px-1 text-[11.5px] text-muted-ink">Synthetic markers, used only as a weak prior on β-cell decline. Not a genetic test.</p>
          </TabsContent>

          <TabsContent value="fhir" className="space-y-3">
            {fhir.status === "loading" && <Skeleton className="h-64 w-full rounded-2xl" />}
            {fhir.status === "error" && <ErrorBlock error={fhir.error} onRetry={fhir.retry} />}
            {fhir.data && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-[11.5px] font-semibold text-page">
                    <FileJson2Icon className="size-3.5" /> Bundle · {fhir.data.bundle.type}
                  </span>
                  {counts.map(([k, n]) => (
                    <span key={k} className="num inline-flex h-7 items-center rounded-full bg-card px-3 text-[11.5px] text-body shadow-[var(--shadow-card)]">
                      {k} {n}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(JSON.stringify(fhir.data!.bundle, null, 2)).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-card px-3 text-[11.5px] font-medium shadow-[var(--shadow-card)]"
                  >
                    {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />} {copied ? "Copied" : "Copy JSON"}
                  </button>
                </div>
                {fhir.data.derived && (
                  <p className="text-[12px] text-muted-ink">This export carries no FHIR file for the patient; the bundle below is derived in the browser from the patient record.</p>
                )}
                <JsonView value={fhir.data.bundle} />
                <p className="text-[11.5px] text-muted-ink">HL7 FHIR R4 collection bundle, ABDM-style ABHA identifier (synthetic). LOINC for labs, SNOMED CT for conditions.</p>
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
