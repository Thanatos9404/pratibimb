// Captures design-reference screenshots (viewport at several scroll positions).
// Usage: node scripts/screenshot-reference.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "screenshots/reference";
mkdirSync(OUT, { recursive: true });
const SITES = [
  { name: "obliq", url: "https://obliqq.framer.ai/", positions: 14 },
  { name: "llmslim", url: "https://www.llmslim.app/", positions: 8 },
];

const browser = await chromium.launch();
for (const s of SITES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.goto(s.url, { waitUntil: "networkidle", timeout: 60000 });
  } catch (e) {
    console.log("goto warn", s.name, e.message);
  }
  await page.waitForTimeout(2500);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(s.name, "height", total);
  for (let i = 0; i < s.positions; i++) {
    const y = Math.round((i / (s.positions - 1)) * Math.max(0, total - 900));
    // scroll in steps so scroll-linked animations run
    await page.evaluate(async (target) => {
      const start = window.scrollY;
      const steps = 12;
      for (let k = 1; k <= steps; k++) {
        window.scrollTo(0, start + ((target - start) * k) / steps);
        await new Promise((r) => setTimeout(r, 60));
      }
    }, y);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${OUT}/${s.name}-${String(i).padStart(2, "0")}.png` });
  }
  await page.close();
}
await browser.close();
