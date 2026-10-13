// Reports horizontal overflow (page wider than viewport) at a phone width.
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://localhost:3000";
const w = +(process.argv[3] ?? 360);
const routes = ["/", "/console", "/console/patient/P0029", "/console/model", "/about"];
const b = await chromium.launch();
for (const r of routes) {
  const p = await b.newPage({ viewport: { width: w, height: 800 } });
  await p.goto(base + r, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const res = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")].filter((e) => { const b = e.getBoundingClientRect(); return b.right > vw + 1 && getComputedStyle(e).position !== "fixed"; })
      .slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 50)} r=${Math.round(e.getBoundingClientRect().right)}`);
    return { sw: document.documentElement.scrollWidth, vw, wide };
  });
  console.log(r, res.sw > res.vw ? "OVERFLOW" : "ok", res.sw, res.vw, res.sw > res.vw ? res.wide.join(" | ") : "");
  await p.close();
}
await b.close();
