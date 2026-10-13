import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

export const alt = "Pratibimb — a living reflection of a person with diabetes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const WAVE =
  "M8 23.2C10.6 23.2 11.9 22.7 13.6 20.7C15.9 18 17.3 11.6 20.4 11.6C23.4 11.6 24 19.7 27 20.4C29.4 20.9 30.6 16.6 33.1 16.6C35.6 16.6 37 21.5 40 22.6";

function Mark({ s }: { s: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#1A1615" strokeWidth="2.2" />
      <path d="M7 24H41" stroke="#1A1615" strokeOpacity="0.28" strokeWidth="1.4" />
      <path d={WAVE} stroke="#1A1615" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={WAVE} transform="matrix(1 0 0 -1 0 48)" stroke="#5B95DE" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function OpengraphImage() {
  const dir = path.join(process.cwd(), "src", "assets", "fonts");
  const [bold, medium] = await Promise.all([readFile(path.join(dir, "open-runde-latin-700-normal.woff")), readFile(path.join(dir, "open-runde-latin-500-normal.woff"))]);
  // a glucose-like trace and its reflection for the card
  const pts = Array.from({ length: 61 }, (_, i) => {
    const x = i / 60;
    const y = 0.45 + 0.28 * Math.exp(-(((x - 0.22) / 0.07) ** 2)) + 0.2 * Math.exp(-(((x - 0.55) / 0.08) ** 2)) + 0.34 * Math.exp(-(((x - 0.84) / 0.06) ** 2));
    return [40 + x * 920, 150 - y * 120] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const dm = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(300 - y).toFixed(1)}`).join(" ");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", background: "linear-gradient(180deg, #9CC1E7 0%, #EDDFD0 100%)", fontFamily: "Runde", padding: "54px 60px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Mark s={46} />
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1.2, color: "#1A1615" }}>Pratibimb</div>
        </div>
        <div style={{ marginTop: 26, fontSize: 64, fontWeight: 700, letterSpacing: -2.4, color: "#1A1615", textAlign: "center", lineHeight: 1.04, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span>A living reflection</span>
          <span>of a person with diabetes.</span>
        </div>
        <div style={{ marginTop: 18, fontSize: 24, fontWeight: 500, color: "#453F3D" }}>A digital twin for Type 2 Diabetes · it sees the spike two hours before it happens</div>
        <div style={{ marginTop: 34, width: 1000, height: 260, background: "rgba(255,255,255,0.9)", borderRadius: 28, display: "flex", boxShadow: "0 30px 60px -20px rgba(97,74,68,0.35)" }}>
          <svg width="1000" height="300" viewBox="0 0 1000 300">
            <line x1="40" x2="960" y1="150" y2="150" stroke="#1A1615" strokeOpacity="0.15" />
            <path d={d} fill="none" stroke="#1A1615" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={dm} fill="none" stroke="#5B95DE" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Runde", data: bold, weight: 700, style: "normal" },
        { name: "Runde", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
