// Render the submission PDFs with Playwright (Chromium), and optionally one image per slide for the PPTX.
//
//   node docs/deck/render.mjs                 # from the repo root
//   node docs/deck/render.mjs --png <dir>     # also write slide-NN.jpg (2560x1440) for make_pptx.py
//
// Inputs: docs/deck/slides.html, docs/deck/architecture.html (+ docs/architecture.svg from
// make_architecture.py), docs/deck/links.json (fills elements marked data-link).
// Outputs: StackUnderflow_BIT-Mesra-Jaipur/Pratibimb_Presentation.pdf and Pratibimb_Architecture.pdf.
// Playwright is resolved from web/node_modules (run `npx playwright install chromium` there once).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "web", "package.json"));
const { chromium } = require("@playwright/test");

const OUT = path.join(root, "StackUnderflow_BIT-Mesra-Jaipur");
const links = JSON.parse(readFileSync(path.join(here, "links.json"), "utf8"));
const pi = process.argv.indexOf("--png");
const pngDir = pi > 0 ? path.resolve(process.argv[pi + 1]) : null;
mkdirSync(OUT, { recursive: true });
if (pngDir) mkdirSync(pngDir, { recursive: true });

const browser = await chromium.launch();

async function render({ file, pdf, w, h, selector, png }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(here, file)).href, { waitUntil: "load" });
  await page.evaluate(async (links) => {
    for (const el of document.querySelectorAll("[data-link]")) {
      const v = links[el.dataset.link];
      if (v) el.textContent = v;
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r)))));
  }, links);
  await page.waitForTimeout(300);
  const n = await page.locator(selector).count();
  if (png && pngDir) {
    const els = page.locator(selector);
    for (let i = 0; i < n; i++) {
      const f = path.join(pngDir, `${png}-${String(i + 1).padStart(2, "0")}.jpg`);
      await els.nth(i).screenshot({ path: f, type: "jpeg", quality: 90 });
    }
  }
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: path.join(OUT, pdf), width: `${w}px`, height: `${h}px`, printBackground: true, preferCSSPageSize: true });
  console.log(`${pdf}: ${n} pages`);
  await page.close();
}

await render({ file: "architecture.html", pdf: "Pratibimb_Architecture.pdf", w: 1600, h: 900, selector: "section.page", png: "architecture" });
await render({ file: "slides.html", pdf: "Pratibimb_Presentation.pdf", w: 1280, h: 720, selector: "section.slide", png: "slide" });
await browser.close();
