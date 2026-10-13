"""Slide-ready figures (PNG + SVG) in a clean, minimal style using the Pratibimb palette."""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from ..config import SAMPLES_PER_DAY, STEP_MIN, Paths, Profile  # noqa: E402

INK, MUTED, HAIR = "#15140F", "#6E6A60", "#DAD4C6"
VERM, INDIGO = "#D9481C", "#2B3A67"
RANGE = {"vlow": "#8E1B2C", "low": "#C8324A", "in": "#2F7D5B", "high": "#D99A1E", "vhigh": "#C2561A"}
ARCH_COL = {"SIDD": INDIGO, "SIRD": VERM, "MARD": "#2F7D5B", "IROD": "#D99A1E"}
MODEL_COL = {"cgm_linear": "#B9B2A3", "ml_no_twin": "#6E6A60", "twin_only": "#7C8DB5", "hybrid": VERM}
MODEL_LABEL = {"cgm_linear": "CGM linear", "ml_no_twin": "ML (no twin)", "twin_only": "Twin only", "hybrid": "Hybrid"}
TASK_LABEL = {"hyper_2h": "Level-2 hyper < 2 h", "hypo_1h": "Hypo < 1 h", "nocturnal_hypo": "Nocturnal hypo"}


def _style() -> None:
    plt.rcParams.update({
        "font.size": 10, "font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False,
        "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
        "axes.titlesize": 11, "axes.titleweight": "bold", "axes.titlecolor": INK, "axes.grid": True,
        "grid.color": HAIR, "grid.linewidth": 0.6, "figure.facecolor": "white", "axes.facecolor": "white",
        "legend.frameon": False, "savefig.dpi": 200, "savefig.bbox": "tight",
    })


def _save(fig, paths: Paths, name: str, svg: bool = False) -> None:
    paths.figures.mkdir(parents=True, exist_ok=True)
    fig.savefig(paths.figures / f"{name}.png")
    if svg:
        fig.savefig(paths.figures / f"{name}.svg")
    plt.close(fig)


def _target_band(ax) -> None:
    ax.axhspan(70, 180, color=RANGE["in"], alpha=0.07, lw=0)
    for y in (70, 180, 250):
        ax.axhline(y, color=HAIR, lw=0.8, zorder=0)


def fig_agp(paths: Paths, val: dict) -> None:
    tab = pd.DataFrame(val["patients_table"])
    fig, axes = plt.subplots(1, 4, figsize=(16, 3.6), sharey=True)
    hours = np.arange(0, 24, 0.25)
    for ax, arch in zip(axes, ("SIDD", "SIRD", "MARD", "IROD"), strict=True):
        sub = tab[tab.archetype == arch]
        if sub.empty:
            ax.set_axis_off()
            continue
        pid = sub.iloc[(sub.tir - sub.tir.median()).abs().argsort().iloc[0]]["id"]
        c = np.load(paths.patients / f"{pid}.npz")["cgm"][SAMPLES_PER_DAY:].astype(float)
        days = c.shape[0] // SAMPLES_PER_DAY
        m = c[: days * SAMPLES_PER_DAY].reshape(days, 96, 3).transpose(1, 0, 2).reshape(96, -1)
        q = np.nanpercentile(m, [5, 25, 50, 75, 95], axis=1)
        _target_band(ax)
        col = ARCH_COL[arch]
        ax.fill_between(hours, q[0], q[4], color=col, alpha=0.12, lw=0)
        ax.fill_between(hours, q[1], q[3], color=col, alpha=0.28, lw=0)
        ax.plot(hours, q[2], color=col, lw=2)
        r = sub[sub.id == pid].iloc[0]
        ax.set_title(f"{arch} - {pid}", loc="left")
        ax.text(0.02, 0.96, f"TIR {r.tir:.0f}%  CV {r.cv:.0f}%  HbA1c {r.hba1c}%", transform=ax.transAxes,
                va="top", fontsize=8.5, color=MUTED)
        ax.set_xticks([0, 6, 12, 18, 24])
        ax.set_xticklabels(["00", "06", "12", "18", "24"])
        ax.set_xlim(0, 24)
        ax.set_ylim(40, 350)
    axes[0].set_ylabel("CGM glucose (mg/dL)")
    fig.suptitle("Ambulatory glucose profile by archetype (median, IQR, 5-95th percentile)", x=0.01, ha="left",
                 fontweight="bold")
    _save(fig, paths, "agp_by_subtype", svg=True)


def fig_tir(paths: Paths, val: dict) -> None:
    rows = []
    for pid_row in val["patients_table"]:
        c = np.load(paths.patients / f"{pid_row['id']}.npz")["cgm"][SAMPLES_PER_DAY:].astype(float)
        c = c[~np.isnan(c)]
        rows.append({"arch": pid_row["archetype"], "vlow": np.mean(c < 54), "low": np.mean((c >= 54) & (c < 70)),
                     "in": np.mean((c >= 70) & (c <= 180)), "high": np.mean((c > 180) & (c <= 250)),
                     "vhigh": np.mean(c > 250)})
    df = pd.DataFrame(rows)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 3.8), gridspec_kw={"width_ratios": [1.2, 1]})
    agg = df.groupby("arch")[["vlow", "low", "in", "high", "vhigh"]].mean() * 100
    agg = agg.reindex([a for a in ("SIDD", "SIRD", "MARD", "IROD") if a in agg.index])
    left = np.zeros(len(agg))
    labels = {"vlow": "<54", "low": "54-69", "in": "70-180", "high": "181-250", "vhigh": ">250"}
    for key in ("vlow", "low", "in", "high", "vhigh"):
        a1.barh(agg.index, agg[key], left=left, color=RANGE[key], label=labels[key], height=0.6)
        left += agg[key].to_numpy()
    a1.set_xlabel("% of time (mean of patients)")
    a1.set_xlim(0, 100)
    a1.legend(ncol=5, loc="lower center", bbox_to_anchor=(0.5, 1.0), fontsize=8.5)
    a1.grid(axis="y", visible=False)
    tir = df["in"] * 100
    a2.hist(tir, bins=np.arange(0, 101, 5), color=RANGE["in"], alpha=0.85, edgecolor="white")
    a2.axvspan(55, 75, color=HAIR, alpha=0.4, lw=0, zorder=0)
    a2.axvline(np.median(tir), color=INK, lw=1.5)
    a2.text(np.median(tir) + 1, a2.get_ylim()[1] * 0.92, f"median {np.median(tir):.0f}%", fontsize=9)
    a2.set_xlabel("Time in range 70-180 mg/dL (%) per patient")
    a2.set_ylabel("patients")
    fig.suptitle("Time in ranges across the synthetic cohort (CGM)", x=0.01, ha="left", fontweight="bold")
    _save(fig, paths, "tir_distribution", svg=True)


def fig_hypo_med(paths: Paths, val: dict) -> None:
    d = val["hypo_by_medication_class"]
    order = [k for k in ("neither", "sulfonylurea", "insulin") if k in d]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.4))
    cols = ["#B9B2A3", VERM, INDIGO][: len(order)]
    a1.bar(order, [d[k]["hypo_episodes_per_week_mean"] for k in order], color=cols, width=0.6)
    a1.set_ylabel("hypo episodes / patient-week")
    a1.set_title("Level-1 hypoglycaemia (truth)", loc="left")
    a2.bar(order, [100 * d[k]["nocturnal_hypo_night_rate"] for k in order], color=cols, width=0.6)
    a2.set_ylabel("% of nights")
    a2.set_title("Nocturnal hypoglycaemia (00:00-06:00)", loc="left")
    for ax in (a1, a2):
        ax.grid(axis="x", visible=False)
        ax.set_xticks(range(len(order)))
        ax.set_xticklabels([f"{k}\n(n={d[k]['n']})" for k in order])
    _save(fig, paths, "hypo_by_medication", svg=True)


def fig_postprandial(paths: Paths, man: dict) -> None:
    data: dict[str, list] = {}
    for p in man["patients"]:
        with (paths.patients / f"{p['id']}.json").open(encoding="utf-8") as fh:
            rec = json.load(fh)
        g = np.load(paths.patients / f"{p['id']}.npz")["g"].astype(float)
        for m in rec["truth"]["meals"]:
            if m["slot"] in ("breakfast", "lunch", "evening_snack", "dinner") and m["carbs_g"] > 20:
                k = m["t"] // STEP_MIN
                if k + 30 < g.shape[0]:
                    data.setdefault(m["slot"], []).append(g[k:k + 30].max())
    order = [s for s in ("breakfast", "lunch", "evening_snack", "dinner") if s in data]
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    bp = ax.boxplot([data[s] for s in order], widths=0.5, patch_artist=True, showfliers=False,
                    medianprops={"color": INK, "lw": 1.5})
    for patch, col in zip(bp["boxes"], ["#D99A1E", VERM, "#B9B2A3", INDIGO], strict=False):
        patch.set_facecolor(col)
        patch.set_alpha(0.55)
        patch.set_edgecolor(MUTED)
    ax.set_xticks(range(1, len(order) + 1))
    ax.set_xticklabels([s.replace("_", " ") for s in order])
    ax.axhline(180, color=RANGE["high"], lw=1, ls="--")
    ax.axhline(250, color=RANGE["vhigh"], lw=1, ls="--")
    ax.set_ylabel("2-h post-meal peak (mg/dL, truth)")
    ax.set_title("Post-prandial peaks by meal (late Indian dinners run highest)", loc="left")
    _save(fig, paths, "postprandial_peaks", svg=True)


def _example_patient(paths: Paths, split_ids: list[str]) -> str:
    best, score = split_ids[0], -1.0
    for pid in split_ids[:30]:
        g = np.load(paths.patients / f"{pid}.npz")["g"]
        s = float(np.std(g))
        if s > score:
            best, score = pid, s
    return best


def fig_sync_and_cone(paths: Paths, profile: Profile, test_ids: list[str]) -> None:
    from ..observables import load_observed, load_truth
    from ..twin.assimilate import patient_seed
    from ..twin.enkf import TwinRun
    from ..twin.forecast import HabitPrior, ensemble_forecast, forecast_seed

    pid = _example_patient(paths, test_ids)
    z = np.load(paths.patients / f"{pid}.npz")
    tw = np.load(paths.twin / f"{pid}.npz")
    k_now = profile.now_minute // STEP_MIN
    a, b = k_now - SAMPLES_PER_DAY, k_now
    t = (np.arange(a, b) * STEP_MIN - a * STEP_MIN) / 60.0 + (a * STEP_MIN % 1440) / 60.0
    fig, ax = plt.subplots(figsize=(12, 3.8))
    _target_band(ax)
    ax.fill_between(t, tw["q"][a:b, 0], tw["q"][a:b, 2], color=INDIGO, alpha=0.18, lw=0, label="Twin p10-p90")
    ax.plot(t, tw["q"][a:b, 1], color=INDIGO, lw=1.6, label="Twin estimate")
    ax.plot(t, z["g"][a:b], color=INK, lw=1, ls="--", label="Truth (hidden)")
    ax.scatter(t, z["cgm"][a:b], s=7, color=VERM, label="CGM", zorder=3)
    ax.set_xlabel("hour of day")
    ax.set_ylabel("glucose (mg/dL)")
    ax.set_title(f"Twin sync: CGM vs EnKF twin vs hidden truth ({pid}, 24 h)", loc="left")
    ax.legend(ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.2), fontsize=8.5)
    ticks = np.arange(np.ceil(t[0] / 3) * 3, t[-1] + 0.1, 3)
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{int(h % 24):02d}" for h in ticks])
    _save(fig, paths, "twin_sync_example", svg=True)

    obs = load_observed(paths, pid)
    run = TwinRun(obs, profile.ensemble_size, patient_seed(profile.seed, pid))
    zk = run.ensemble_at(k_now, tw["snaps"], tw["rej"])
    traj = ensemble_forecast(run, zk, k_now, 240, HabitPrior(run), forecast_seed(run, k_now))
    q = np.quantile(traj, [0.05, 0.25, 0.5, 0.75, 0.95], axis=0)
    cal = paths.models / "forecast_calibration.json"
    if cal.exists():  # same validation-fitted interval rescaling as the API
        d = json.loads(cal.read_text(encoding="utf-8"))
        lead = np.arange(q.shape[1]) * STEP_MIN
        sc = np.interp(lead, [0, *d["horizons_min"], 240], [1.0, *d["scale"], d["scale"][-1]])
        q = q[2] + sc * (q - q[2])
    _, ts = load_truth(paths, pid)
    past = np.arange(k_now - 72, k_now + 1)
    fut = np.arange(k_now, k_now + 49)
    hp = (past * STEP_MIN % 1440) / 60.0
    hp = np.where(hp < hp[0], hp + 24, hp)
    hf = hp[-1] + (fut - k_now) * STEP_MIN / 60.0
    fig, ax = plt.subplots(figsize=(10, 3.8))
    _target_band(ax)
    ax.scatter(hp, obs.cgm[past], s=8, color=VERM, label="CGM (past)")
    ax.fill_between(hf, q[0], q[4], color=INDIGO, alpha=0.14, lw=0, label="p05-p95")
    ax.fill_between(hf, q[1], q[3], color=INDIGO, alpha=0.3, lw=0, label="p25-p75")
    ax.plot(hf, q[2], color=INDIGO, lw=2, label="median")
    okf = fut < ts["g"].shape[0]
    ax.plot(hf[okf], ts["g"][fut[okf]], color=INK, lw=1, ls="--", label="what happened (truth)")
    ax.axvline(hp[-1], color=MUTED, lw=1)
    ax.text(hp[-1] + 0.05, ax.get_ylim()[1] * 0.95, "now", color=MUTED, fontsize=9)
    ax.set_xlabel("hour of day")
    ax.set_ylabel("glucose (mg/dL)")
    ax.set_title(f"4-hour forecast cone with habitual-meal prior ({pid})", loc="left")
    ax.legend(ncol=5, fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.2))
    ticks = np.arange(np.ceil(hp[0]), hf[-1] + 0.1, 1)
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{int(h % 24):02d}" for h in ticks])
    _save(fig, paths, "forecast_cone_example", svg=True)


def fig_metrics(paths: Paths, metrics: dict) -> None:
    ab = metrics["ablation"]
    tasks = ["hyper_2h", "hypo_1h", "nocturnal_hypo"]
    fig, axes = plt.subplots(1, 2, figsize=(12, 3.8))
    for ax, metric in zip(axes, ("auroc", "auprc"), strict=True):
        w = 0.2
        for i, row in enumerate(ab):
            vals = [row.get(f"{t}_{metric}", np.nan) for t in tasks]
            x = np.arange(len(tasks)) + (i - 1.5) * w
            ax.bar(x, vals, width=w, color=MODEL_COL[row["model"]], label=MODEL_LABEL[row["model"]])
            for xi, v in zip(x, vals, strict=True):
                if v == v:
                    ax.text(xi, v + 0.01, f"{v:.2f}", ha="center", fontsize=7, color=MUTED)
        ax.set_xticks(range(len(tasks)))
        ax.set_xticklabels([TASK_LABEL[t] for t in tasks])
        ax.set_ylim(0, 1.05)
        ax.set_title(metric.upper() + " on held-out patients", loc="left")
        ax.grid(axis="x", visible=False)
    axes[0].legend(ncol=4, fontsize=8.5, loc="lower center", bbox_to_anchor=(1.1, -0.28))
    _save(fig, paths, "ablation", svg=True)

    fig, axes = plt.subplots(1, 3, figsize=(12, 3.6))
    for ax, t in zip(axes, tasks, strict=True):
        cal = metrics["tasks"][t]["calibration"]
        p = [c["pred"] for c in cal]
        o = [c["obs"] for c in cal]
        hi = max(max(p + o) * 1.1, 0.05)
        ax.plot([0, hi], [0, hi], color=HAIR, lw=1)
        ax.plot(p, o, "o-", color=VERM, ms=4)
        ax.set_xlim(0, hi)
        ax.set_ylim(0, hi)
        ax.set_title(TASK_LABEL[t], loc="left")
        ax.set_xlabel("predicted probability")
    axes[0].set_ylabel("observed frequency")
    fig.suptitle("Calibration (isotonic on validation patients; deciles on test)", x=0.01, ha="left", fontweight="bold")
    _save(fig, paths, "calibration", svg=True)

    fig, axes = plt.subplots(1, 3, figsize=(12, 3.4))
    for ax, t in zip(axes, tasks, strict=True):
        h = metrics["tasks"][t]["lead_time_hist"]
        ax.bar([b["min"] + 7.5 for b in h], [b["count"] for b in h], width=13, color=INDIGO, alpha=0.8)
        med = metrics["tasks"][t]["operating_point"]["median_lead_min"]
        ax.axvline(med, color=VERM, lw=1.5)
        ax.set_title(f"{TASK_LABEL[t]} - median {med:.0f} min", loc="left")
        ax.set_xlabel("lead time before event onset (min)")
    axes[0].set_ylabel("detected events")
    _save(fig, paths, "lead_time_hist", svg=True)


def fig_parkes(paths: Paths, metrics: dict) -> None:
    from ..ml.parkes import _POLYS

    df = pd.read_parquet(paths.ml / "forecast_sample.parquet")
    zone_col = {"A": "#2F7D5B", "B": "#D99A1E", "C": "#C2561A", "D": "#C8324A", "E": "#8E1B2C"}
    fig, axes = plt.subplots(1, 3, figsize=(13, 4.4))
    for ax, h in zip(axes, metrics["forecast"]["horizons_min"], strict=True):
        d = df[df.horizon == h]
        for _, poly in _POLYS:
            ax.plot(poly[:, 0], poly[:, 1], color=HAIR, lw=0.8)
        ax.scatter(d.ref, d.pred, s=3, c=[zone_col[z] for z in d.zone], alpha=0.5, lw=0)
        ax.plot([0, 450], [0, 450], color=MUTED, lw=0.6, ls=":")
        pk = next(p for p in metrics["forecast"]["parkes"] if p["horizon_min"] == h)
        ax.set_title(f"+{h} min  A {pk['A']:.0f}%  B {pk['B']:.0f}%  C+ {pk['C'] + pk['D'] + pk['E']:.1f}%",
                     loc="left")
        ax.set_xlim(40, 450)
        ax.set_ylim(40, 450)
        ax.set_xlabel("truth plasma glucose (mg/dL)")
        ax.set_aspect("equal")
    axes[0].set_ylabel("twin forecast median (mg/dL)")
    fig.suptitle("Parkes error grid (type 2) for twin forecasts on held-out patients", x=0.01, ha="left",
                 fontweight="bold")
    _save(fig, paths, "parkes_grid", svg=False)


def make_figures(profile: Profile, paths: Paths, log=print) -> None:
    _style()
    with (paths.reports / "cohort_validation.json").open(encoding="utf-8") as fh:
        val = json.load(fh)
    with (paths.reports / "metrics.json").open(encoding="utf-8") as fh:
        metrics = json.load(fh)
    with (paths.cohort / "manifest.json").open(encoding="utf-8") as fh:
        man = json.load(fh)
    test_ids = [p["id"] for p in man["patients"] if p["split"] == "test"]
    fig_agp(paths, val)
    fig_tir(paths, val)
    fig_hypo_med(paths, val)
    fig_postprandial(paths, man)
    fig_sync_and_cone(paths, profile, test_ids)
    fig_metrics(paths, metrics)
    fig_parkes(paths, metrics)
    log(f"figures written to {paths.figures}")
