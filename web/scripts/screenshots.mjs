// Full-page screenshots of every page at desktop and mobile sizes, light and dark.
// Usage: node scripts/screenshots.mjs [baseUrl] [filter]
//   baseUrl defaults to http://localhost:3000; filter is a substring of the route name.
// Also records console errors/warnings (incl. hydration) to screenshots/console-log.txt.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const FILTER = process.argv[3] ?? "";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { name: "landing", path: "/", themes: ["light"] },
  { name: "console", path: "/console", themes: ["light", "dark"] },
  { name: "patient", path: "/console/patient/P0029", themes: ["light", "dark"] },
  { name: "patient-hypo", path: "/console/patient/P0098", themes: ["light"] },
  { name: "model", path: "/console/model", themes: ["light", "dark"] },
  { name: "about", path: "/about", themes: ["light"] },
];
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
].filter((v) => !process.env.ONLY_VP || v.name === process.env.ONLY_VP);

const log = [];
const browser = await chromium.launch();
for (const r of ROUTES.filter((x) => x.name.includes(FILTER))) {
  for (const vp of VIEWPORTS) {
    for (const theme of r.themes.filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: theme });
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {}
      }, theme);
      const page = await ctx.newPage();
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") log.push(`[${r.name} ${vp.name} ${theme}] ${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => log.push(`[${r.name} ${vp.name} ${theme}] pageerror: ${e.message}`));
      await page.goto(BASE + r.path, { waitUntil: "networkidle", timeout: 120000 });
      await page.waitForTimeout(1500);
      // scroll through so in-view animations fire, then back to top
      await page.evaluate(async () => {
        const h = document.documentElement.scrollHeight;
        for (let y = 0; y < h; y += 400) {
          window.scrollTo(0, y);
          await new Promise((res) => setTimeout(res, 90));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1600);
      const file = `${OUT}/${r.name}-${vp.name}-${theme}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log("saved", file);
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(`${OUT}/console-log.txt`, log.join("\n") || "(no console errors or warnings)");
console.log(log.length ? `${log.length} console messages logged` : "no console errors/warnings");
