// Viewport screenshots at evenly spaced scroll positions (to compare with the reference shots).
// Usage: node scripts/screenshot-scroll.mjs <url> <name> [positions=8] [width=1440] [height=900]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [url, name, n = "8", w = "1440", h = "900"] = process.argv.slice(2);
mkdirSync("screenshots/scroll", { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(e.message));
await p.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(2500);
const total = await p.evaluate(() => document.documentElement.scrollHeight);
for (let i = 0; i < +n; i++) {
  const y = Math.round((i / (+n - 1)) * Math.max(0, total - +h));
  await p.evaluate(async (target) => {
    const s = window.scrollY;
    for (let k = 1; k <= 14; k++) { window.scrollTo(0, s + ((target - s) * k) / 14); await new Promise((r) => setTimeout(r, 50)); }
  }, y);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `screenshots/scroll/${name}-${String(i).padStart(2, "0")}.png` });
}
console.log("height", total, "errors", errs.length, errs.slice(0, 5).join(" | "));
await b.close();
