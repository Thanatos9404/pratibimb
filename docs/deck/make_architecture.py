"""Generate docs/architecture.svg — the Pratibimb system architecture diagram.

OBLIQ design language (SPEC 6.1): Open Runde (embedded, subset), ink #1A1615, beige #F0EAE5,
sky #9CC1E7, soft warm shadows, big radii. Run from the repo root:

    python docs/deck/make_architecture.py

Needs fontTools + brotli (for the embedded WOFF2 subset). The PDF is rendered from this SVG by
docs/deck/render.mjs.
"""

from __future__ import annotations

import base64
import io
import re
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "web" / "public" / "fonts"
OUT = ROOT / "docs" / "architecture.svg"

W, H = 1600, 900
INK, BODY, MUTED, BROWN = "#1A1615", "#453F3D", "#757170", "#614A44"
BEIGE, WARM, OFF = "#F0EAE5", "#F4F1EE", "#F9F8F8"
SKY, SAND = "#9CC1E7", "#EDDFD0"
ARROW = "#614A44"

parts: list[str] = []
texts: list[str] = []


def t(x, y, s, size=12, weight=400, fill=BODY, anchor="start", mono=False, ls=None, upper=False):
    s = s.upper() if upper else s
    texts.append(s)
    if mono:  # code-ish lines: brown, medium weight (CSS font rule keeps Open Runde everywhere)
        fill, weight = BROWN, max(weight, 500)
    fam = ""
    lsp = f' letter-spacing="{ls}"' if ls is not None else ""
    parts.append(
        f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" '
        f'text-anchor="{anchor}" {fam}{lsp}>{escape(s)}</text>'
    )


def rect(x, y, w, h, r=20, fill="#FFFFFF", stroke=None, dash=None, shadow=False, sw=1.2, extra=""):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    da = f' stroke-dasharray="{dash}"' if dash else ""
    fl = ' filter="url(#soft)"' if shadow else ""
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{st}{da}{fl}{extra}/>')


def path(d, color=ARROW, dash=None, head=True, width=1.6):
    da = f' stroke-dasharray="{dash}"' if dash else ""
    mk = ' marker-end="url(#arrow)"' if head and not dash else (' marker-end="url(#arrowd)"' if head else "")
    parts.append(
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" '
        f'stroke-linejoin="round"{da}{mk}/>'
    )


def dot(x, y, r=3.2, fill=ARROW):
    parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')


def chip(x, y, s, fill=WARM, color=BROWN, size=11, weight=600, pad=10, anchor="start"):
    w = est(s, size, weight) + 2 * pad
    if anchor == "middle":
        x = x - w / 2
    elif anchor == "end":
        x = x - w
    rect(x, y - size - 4, w, size + 11, r=100, fill=fill)
    t(x + pad, y + 1, s, size=size, weight=weight, fill=color)
    return w


def est(s, size, weight=400):
    """Rough text-width estimate for Open Runde (good enough for chip sizing)."""
    k = 0.54 if weight < 600 else 0.575
    narrow = sum(1 for c in s if c in "il.,:;'|!·() ")
    return size * (k * (len(s) - narrow) + 0.3 * narrow)


def card(x, y, w, h, title, lines, dark=False, mono_lines=(), sub=None, tag=None):
    rect(x, y, w, h, r=20, fill=INK if dark else "#FFFFFF", shadow=True)
    tc = "#FFFFFF" if dark else INK
    bc = "#D9D2CD" if dark else BODY
    t(x + 16, y + 28, title, size=15, weight=700, fill=tc, ls="-0.3")
    yy = y + 48
    if sub:
        t(x + 16, yy, sub, size=11, weight=500, fill=SKY if dark else MUTED)
        yy += 19
    for i, ln in enumerate(lines):
        t(x + 16, yy, ln, size=12, fill=bc, mono=(i in mono_lines))
        yy += 17
    if tag:
        chip(x + 16, y + h - 14, tag, fill="#2B2523" if dark else WARM, color=SKY if dark else BROWN, size=10.5)


# ---------------------------------------------------------------- canvas + defs
parts.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')

# ---------------------------------------------------------------- header
logo = (
    '<g transform="translate(40,34) scale(1.0)">'
    '<circle cx="24" cy="24" r="19.5" fill="none" stroke="#1A1615" stroke-width="2.6"/>'
    '<path d="M8.5 24H39.5" stroke="#1A1615" stroke-opacity=".28" stroke-width="1.6" stroke-linecap="round"/>'
    '<path d="M10 23.2C12.2 23.2 13.3 22.7 14.8 20.9C16.8 18.4 18 12.8 20.7 12.8C23.3 12.8 23.8 19.9 26.4 20.5C28.5 21 29.5 17.2 31.7 17.2C33.9 17.2 35.1 21.4 37.8 22.4" fill="none" stroke="#1A1615" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
    '<path d="M10 24.8C12.2 24.8 13.3 25.3 14.8 27.1C16.8 29.6 18 35.2 20.7 35.2C23.3 35.2 23.8 28.1 26.4 27.5C28.5 27 29.5 30.8 31.7 30.8C33.9 30.8 35.1 26.6 37.8 25.6" fill="none" stroke="#5B95DE" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
    "</g>"
)
parts.append(logo)
t(102, 54, "System architecture", size=11.5, weight=600, fill=MUTED, upper=True, ls="1.6")
texts.append("Pratibimb · hybrid physiology + ML digital twin for Type 2 Diabetes")
parts.append(
    '<text x="102" y="88" font-size="30" font-weight="700" fill="#1A1615" letter-spacing="-0.9">Pratibimb'
    '<tspan font-weight="600" fill="#A39D9A"> · hybrid physiology + ML digital twin for Type 2 Diabetes</tspan></text>'
)

# legend (top right)
lx = 1190
path(f"M{lx} 52 H{lx+34}")
t(lx + 44, 56, "data / control flow", size=11.5, fill=BODY)
path(f"M{lx} 78 H{lx+34}", color="#9A8F8A", dash="5 5")
t(lx + 44, 82, "evaluation only (hidden truth)", size=11.5, fill=BODY)
rect(lx + 214, 44, 14, 14, r=4, fill=INK)
t(lx + 236, 56, "core twin / UI", size=11.5, fill=BODY)
rect(lx + 214, 70, 14, 14, r=4, fill="#FFFFFF", stroke="#D9D2CD")
t(lx + 236, 82, "component", size=11.5, fill=BODY)

TOP, BOT = 136, 744

# ---------------------------------------------------------------- 01 data column
rect(40, TOP, 290, BOT - TOP, r=32, fill=BEIGE)
t(60, 166, "01  Data · synthetic only", size=11, weight=600, fill=BROWN, upper=True, ls="1.4")
cx, cw = 56, 258
card(cx, 182, cw, 146, "Truth simulator", [
    "240 patients × 28 days, 5-min",
    "INSPIRED subtypes SIDD · SIRD ·",
    "MARD · IROD, “thin-fat” phenotype",
    "Indian meals, late dinners, fasting",
    "sensor lag · drift · logging errors",
], sub="richer than the twin (no inverse crime)")
card(cx, 344, cw, 122, "Synthetic EHR → FHIR R4", [
    "Bundle: Patient + ABHA 91-0000-…",
    "Condition (SNOMED CT)",
    "Observation (LOINC) · Medication",
    "Statement · Device · genetics",
])
card(cx, 482, cw, 134, "Wearable + CGM streams", [
    "CGM every 5 min",
    "heart rate · HRV (RMSSD)",
    "steps · sleep stages",
    "logged meals (73 Indian foods)",
    "logged doses (taken / missed)",
])
rect(cx, 632, cw, 96, r=20, fill="none", stroke="#A39D9A", dash="6 5")
t(cx + 16, 660, "Hidden truth", size=15, weight=700, fill=INK, ls="-0.3")
t(cx + 16, 682, "plasma glucose · subtype label", size=12, fill=BODY)
t(cx + 16, 699, "never shown to the twin or the ML;", size=12, fill=BODY)
t(cx + 16, 716, "used only to score held-out patients", size=12, fill=BODY)
# generator rail
path("M47 300 V686", head=False, width=1.4)
path("M47 405 H54")
path("M47 549 H54")
path("M47 686 H54", color="#9A8F8A", dash="4 4")
dot(47, 300)

# ---------------------------------------------------------------- 02 engine
EX, EW = 352, 860
parts.append(
    f'<rect x="{EX}" y="{TOP}" width="{EW}" height="{BOT-TOP}" rx="32" fill="url(#sky)"/>'
)
t(EX + 22, 166, "02  Pratibimb engine · Python 3.12", size=11, weight=600, fill=BROWN, upper=True, ls="1.4")
t(EX + EW - 22, 166, "numpy · numba · scikit-learn · LightGBM", size=11.5, weight=500, fill=BROWN, anchor="end")

# lane A — twin
LA_Y, LA_H = 182, 286
rect(368, LA_Y, 828, LA_H, r=24, fill="#FFFFFF", extra=' fill-opacity="0.55"')
t(388, 206, "Twin · physiology", size=11, weight=600, fill=MUTED, upper=True, ls="1.4")
t(1176, 206, "personalised from the record, re-synced every 5 minutes", size=11.5, fill=MUTED, anchor="end")
ax = [388, 548, 708, 868, 1028]
aw, ay, ah = 146, 220, 168
card(ax[0], ay, aw, ah, "EHR priors", [
    "TyG index", "ADAG eAG (HbA1c)", "waist/height · BMI", "duration · C-peptide", "TCF7L2 (weak)", "→ θ prior",
], mono_lines=(5,))
card(ax[1], ay, aw, ah, "Twin model", [
    "extended Bergman", "minimal-model ODE", "G · X · I · gut · Gi", "exercise · sleep ·", "stress · 5 drug", "classes",
])
card(ax[2], ay, aw, ah, "EnKF sync", [
    "64 members", "states + log-params", "CGM update / 5 min", "4σ innovation gate", "inflation 1.001",
], dark=True, sub="the live twin")
card(ax[3], ay, aw, ah, "Ensemble forecast", [
    "+4 h cone", "p05 · p25 · p50 ·", "p75 · p95", "habitual-meal prior", "80 % intervals", "calibrated",
])
card(ax[4], ay, aw, ah, "What-If simulator", [
    "Indian meal swaps", "post-meal walk", "skip / shift a dose", "short-sleep night", "→ baseline vs", "scenario + narrative",
])
for i in range(4):
    path(f"M{ax[i]+aw+1} {ay+ah/2} H{ax[i+1]-2}")
# streams -> EnKF (observation path along the lane bottom)
path(f"M314 520 H341 V424 H{ax[2]+73} V{ay+ah+3}")
chip(572, 446, "CGM observations → EnKF update · wearables, meals, doses → model inputs", fill="#FFFFFF", size=10.5, anchor="middle")
# EHR -> priors
path(f"M314 392 H333 V{ay+ah/2} H{ax[0]-2}")

# lane B — risk layer
LB_Y, LB_H = 484, 244
rect(368, LB_Y, 828, LB_H, r=24, fill="#FFFFFF", extra=' fill-opacity="0.55"')
t(1176, 508, "Risk layer · machine learning", size=11, weight=600, fill=MUTED, upper=True, ls="1.4", anchor="end")
bx = [388, 589, 790, 991]
bw, by, bh = 185, 522, 186
card(bx[0], by, bw, bh, "Causal features", [
    "~100 per decision point,", "every 15 min, data ≤ t", "CGM dynamics · carbs on", "board · meds · steps ·", "HR/HRV · sleep · EHR", "+ 33 twin features",
])
card(bx[1], by, bw, bh, "LightGBM × 3", [
    "hyper_2h · >250 in 2 h", "hypo_1h · <70 in 1 h", "nocturnal_hypo · tonight", "patient-level split", "70 / 15 / 15",
], mono_lines=(0, 1, 2))
card(bx[2], by, bw, bh, "Calibrate + explain", [
    "isotonic calibration", "(validation patients)", "TreeSHAP pred_contrib", "→ plain-language", "drivers: “twin +2 h", "forecast raises risk”",
])
card(bx[3], by, bw, bh, "Alert logic", [
    "threshold: ≤ 1 false", "alert / patient-day", "cool-down + hysteresis", "→ alert with drivers", "and a care note",
])
for i in range(3):
    path(f"M{bx[i]+bw+1} {by+bh/2} H{bx[i+1]-2}")
# twin features: forecast -> features
path(f"M{ax[3]+73} {ay+ah+3} V476 H{bx[0]+92} V{by-3}")
chip(780, 480, "33 twin features: forecast quantiles, exceedance probabilities, posteriors", fill=INK, color="#FFFFFF", size=10.5, anchor="middle")
# streams + EHR statics -> features
path(f"M314 600 H{bx[0]-2}")

# ---------------------------------------------------------------- 03 serving + clinician
RX, RW = 1234, 326
rect(RX, TOP, RW, BOT - TOP, r=32, fill=BEIGE)
t(RX + 20, 166, "03  Serving · clinician", size=11, weight=600, fill=BROWN, upper=True, ls="1.4")
dx, dw = 1250, 294
rect(dx, 182, dw, 160, r=20, fill="#FFFFFF", shadow=True)
t(dx + 16, 210, "FastAPI · REST + WebSocket", size=15, weight=700, fill=INK, ls="-0.3")
for i, ln in enumerate([
    "GET  /api/cohort · /api/patients/{id}",
    "GET  …/timeline · …/forecast",
    "GET  …/fhir  (FHIR R4 Bundle)",
    "POST …/whatif",
    "GET  /api/metrics · /cohort/validation",
    "WS   /api/stream/{id}  live replay",
]):
    t(dx + 16, 234 + i * 17, ln, size=11, mono=True, fill=BODY)
rect(dx, 358, 244, 92, r=20, fill="#FFFFFF", shadow=True)
t(dx + 16, 384, "Static demo export", size=15, weight=700, fill=INK, ls="-0.3")
t(dx + 16, 404, "pratibimb export-demo", size=11, mono=True, fill=BODY)
t(dx + 16, 421, "→ JSON in web/public/demo", size=12, fill=BODY)
t(dx + 16, 438, "console runs with no backend", size=12, fill=BODY)
card(dx, 480, dw, 160, "Clinician console", [
    "Cohort triage, risk-sorted",
    "Virtual patient: twin band, forecast",
    "cone, risk + TreeSHAP, alert feed",
    "What-If Lab · EHR / FHIR sheet",
    "Model card (reads metrics.json)",
], dark=True, sub="Next.js 15 · TypeScript · Tailwind v4 · SVG charts")
rect(dx, 656, dw, 72, r=20, fill="#FFFFFF", shadow=True)
t(dx + 16, 680, "Deploy", size=15, weight=700, fill=INK, ls="-0.3")
t(dx + 76, 680, "static demo, or live api + web", size=11.5, fill=MUTED)
xx = dx + 16
for s_ in ["Vercel", "Docker Compose", "uv + npm (local)"]:
    xx += chip(xx, 712, s_, size=10.5) + 6
# engine -> serving bus
path(f"M{ax[4]+aw+1} {ay+ah/2} H{dx-2}")
path(f"M{bx[3]+bw+1} {by+bh/2} H1223 V{ay+ah/2}", head=False)
dot(1223, ay + ah / 2)
path(f"M1223 404 H{dx-2}")
dot(1223, 404)
# serving -> console -> deploy
path(f"M1522 343 V{480-3}")
path(f"M{dx+122} 451 V{480-3}")
path(f"M{dx+dw/2} 641 V{656-3}")

# ---------------------------------------------------------------- 04 evaluation strip
EY = 762
rect(40, EY, 1520, 74, r=24, fill=OFF, stroke="#A39D9A", dash="6 5")
t(62, EY + 28, "04  Evaluation · held-out synthetic patients", size=11, weight=600, fill=BROWN, upper=True, ls="1.4")
t(62, EY + 52, "36 test patients never used for training or tuning · labels from hidden plasma glucose (CGM-labelled variant too)", size=12.5, fill=BODY)
xx = 760
for s in ["AUROC / AUPRC + bootstrap 95 % CI", "4-model ablation", "forecast RMSE vs baselines", "Parkes error grid", "lead time"]:
    xx += chip(xx, EY + 33, s, fill="#FFFFFF", size=10.5) + 6
t(1540, EY + 58, "→ reports/metrics.json → /api/metrics → Model card", size=11, mono=True, fill=BROWN, anchor="end")
path(f"M{cx+129} 729 V{EY-3}", color="#9A8F8A", dash="5 5")
path(f"M{bx[1]+92} {by+bh+1} V{EY-3}", color="#9A8F8A", dash="5 5")
t(bx[1] + 100, 752, "predictions", size=10.5, fill=MUTED)

# ---------------------------------------------------------------- footer
t(40, 872, "All data are synthetic (DPDP Act / HIPAA sandbox). Not a medical device. Recommendations are illustrative.", size=11.5, fill=MUTED)
t(1560, 872, "Pratibimb · Team Stack Underflow · BIT Mesra, Off Campus Jaipur · Apache-2.0", size=11.5, fill=MUTED, anchor="end")


# ---------------------------------------------------------------- fonts (subset + embed)
def subset_b64(weight: int, text: str) -> str:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    font = TTFont(FONTS / f"open-runde-latin-{weight}-normal.woff2")
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "calt", "tnum"]
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return base64.b64encode(buf.getvalue()).decode()


charset = "".join(sorted(set("".join(texts)) | set(" 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;-–—·→()/%+")))
faces = "".join(
    f"@font-face{{font-family:'Open Runde';font-weight:{w};src:url(data:font/woff2;base64,{subset_b64(w, charset)}) format('woff2');}}"
    for w in (400, 500, 600, 700)
)

defs = f"""<defs>
<style>{faces} text{{font-family:'Open Runde',Inter,'Segoe UI',system-ui,sans-serif;}}</style>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#B7D5F1"/><stop offset="0.55" stop-color="#DCE6EE"/><stop offset="1" stop-color="#F4E6DA"/>
</linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="160%">
  <feDropShadow dx="0" dy="4" stdDeviation="9" flood-color="#614A44" flood-opacity="0.10"/>
</filter>
<marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
  <path d="M1 1 L9 5 L1 9" fill="none" stroke="{ARROW}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
<marker id="arrowd" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
  <path d="M1 1 L9 5 L1 9" fill="none" stroke="#9A8F8A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</marker>
</defs>"""

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
    f'role="img" aria-labelledby="title desc">'
    f"<title id=\"title\">Pratibimb system architecture</title>"
    f"<desc id=\"desc\">Synthetic EHR (FHIR R4 with ABHA) and wearable/CGM streams from a truth simulator feed the "
    f"Pratibimb engine: EHR priors, a minimal-model twin kept in sync by an ensemble Kalman filter, ensemble "
    f"forecasts and a what-if simulator; a LightGBM risk layer with isotonic calibration, TreeSHAP drivers and "
    f"alert logic; served by FastAPI (REST + WebSocket) or a static export to a Next.js clinician console; "
    f"evaluated on held-out patients against hidden truth.</desc>"
    + defs
    + "".join(parts)
    + "</svg>"
)
svg = re.sub(r"\s+\n", "\n", svg)
OUT.write_text(svg, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1024:.0f} KB)")
