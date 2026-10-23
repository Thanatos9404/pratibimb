# Stack Underflow · BIT Mesra (Off Campus Jaipur)

Submission folder for the **Happiest Health Digital Twin Challenge 2026** (Unstop).

**Project:** Pratibimb (प्रतिबिम्ब), a hybrid physiology + machine-learning digital twin for Type 2 Diabetes, built for India.
**Team:** Stack Underflow (solo entry). Yashvardhan Thanvi (team leader), final-year BCA student at Birla Institute of Technology (BIT Mesra), Off Campus Jaipur.

| Deliverable | File |
|---|---|
| Architecture diagram (PDF, 2 pages: diagram + component reference) | [`Pratibimb_Architecture.pdf`](Pratibimb_Architecture.pdf) |
| Presentation with project details and outcome (PDF, 19 slides, 16:9) | [`Pratibimb_Presentation.pdf`](Pratibimb_Presentation.pdf) |
| Same presentation as PowerPoint (one full-slide image per slide) | [`Pratibimb_Presentation.pptx`](Pratibimb_Presentation.pptx) |
| Video walkthrough (20+ minutes) | [`VIDEO.md`](VIDEO.md) → **[https://youtu.be/3gu_ek68Mm0](https://youtu.be/3gu_ek68Mm0)** (unlisted YouTube, 22:57; MP4 + captions mirror: [GitHub release](https://github.com/Thanatos9404/pratibimb/releases/tag/submission-video)) |
| Live demo | **https://pratibimb-omega.vercel.app** |
| Project README (team, problem, use case, tech stack, AI/ML details, results, how to run, licence) | [`../README.md`](../README.md) |
| Open-source licence (Apache-2.0) | [`../LICENSE`](../LICENSE) |
| Model card · data card · API | [`../docs/MODEL_CARD.md`](../docs/MODEL_CARD.md) · [`../docs/DATA_CARD.md`](../docs/DATA_CARD.md) · [`../docs/API.md`](../docs/API.md) |
| Evaluation outputs | [`../reports/metrics.json`](../reports/metrics.json) · [`../reports/cohort_validation.json`](../reports/cohort_validation.json) · [`../reports/figures/`](../reports/figures) |
| Diagram source (SVG) | [`../docs/architecture.svg`](../docs/architecture.svg) |

The PDFs are generated from HTML sources in [`../docs/deck/`](../docs/deck) with Playwright (`node docs/deck/render.mjs`). Every number in them comes from `reports/metrics.json`, `reports/cohort_validation.json`, the engine's demo export or the cited literature.

All data are synthetic. Pratibimb is not a medical device.
