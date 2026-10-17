"""Command-line interface: ``pratibimb generate|assimilate|train|evaluate|export-demo|serve|build|validate-real``."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from .config import get_profile, paths_for


def _log(msg: str) -> None:
    print(f"[pratibimb {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def cmd_generate(args) -> None:
    from .cohort.generate import generate_cohort

    p = get_profile(args.profile)
    generate_cohort(p, paths_for(p), workers=args.workers, log=_log)


def cmd_assimilate(args) -> None:
    from .twin.assimilate import assimilate_cohort

    p = get_profile(args.profile)
    assimilate_cohort(p, paths_for(p), workers=args.workers, log=_log)


def cmd_train(args) -> None:
    from .ml.dataset import build_datasets
    from .ml.train import train_all

    p = get_profile(args.profile)
    paths = paths_for(p)
    paths.ensure()
    if getattr(args, "thresholds_only", False):
        from .ml.train import recompute_operating_points

        recompute_operating_points(paths, log=_log)
        return
    build_datasets(paths, workers=args.workers, log=_log)
    train_all(paths, seed=p.seed % 10_000, log=_log)


def cmd_evaluate(args) -> None:
    from .ml.evaluate import build_alert_ledger, evaluate
    from .reports.validation import cohort_validation

    p = get_profile(args.profile)
    paths = paths_for(p)
    evaluate(p, paths, log=_log)
    build_alert_ledger(paths, log=_log)
    cohort_validation(p, paths, log=_log)
    from .api.service import TwinService

    t = time.time()
    TwinService(p.name).precompute_cohort()
    _log(f"cached cohort view at the demo clock ({time.time() - t:.1f}s)")
    if not args.no_figures:
        from .reports.figures import make_figures

        make_figures(p, paths, log=_log)


def cmd_export(args) -> None:
    from .export import export_demo

    p = get_profile(args.profile)
    export_demo(p, paths_for(p), Path(args.out), n_patients=args.patients, log=_log)


def cmd_serve(args) -> None:
    import uvicorn

    os.environ["PRATIBIMB_PROFILE"] = args.profile
    port = int(args.port or os.environ.get("PORT", 8000))
    uvicorn.run("pratibimb.api.app:app", host=args.host, port=port, log_level="info")


def cmd_validate_real(args) -> None:
    from .realdata.validate import validate_real

    glyco = args.glyco_path or os.environ.get("PRATIBIMB_GLYCO")
    if not glyco:
        raise SystemExit("validate-real needs --glyco-path <GlycoTwin repo> (or PRATIBIMB_GLYCO)")
    web = None if args.no_web else Path(args.web_out)
    validate_real(Path(glyco), workers=args.workers, ensemble=args.ensemble, reuse=args.reuse, web_out=web, log=_log)


def cmd_fusion(args) -> None:
    from .ml.fusion import fusion_ablation

    p = get_profile(args.profile)
    fusion_ablation(p, paths_for(p), workers=args.workers, seed=p.seed % 10_000, log=_log)


def cmd_build(args) -> None:
    t0 = time.time()
    timings = {}
    for name, fn in (("generate", cmd_generate), ("assimilate", cmd_assimilate), ("train", cmd_train),
                     ("evaluate", cmd_evaluate)):
        t = time.time()
        fn(args)
        timings[name] = round(time.time() - t, 1)
    if args.out:
        t = time.time()
        cmd_export(args)
        timings["export-demo"] = round(time.time() - t, 1)
    timings["total"] = round(time.time() - t0, 1)
    p = get_profile(args.profile)
    paths = paths_for(p)
    with (paths.root / "timings.json").open("w", encoding="utf-8") as fh:
        json.dump(timings, fh, indent=1)
    _log(f"build finished: {timings}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="pratibimb", description="Pratibimb T2D digital twin engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--profile", default="full", choices=["full", "small", "tiny"])
        sp.add_argument("--workers", type=int, default=6, help="worker processes (capped at 6)")

    for name, fn in (("generate", cmd_generate), ("assimilate", cmd_assimilate), ("train", cmd_train)):
        sp = sub.add_parser(name)
        common(sp)
        if name == "train":
            sp.add_argument("--thresholds-only", action="store_true",
                            help="re-select alert thresholds on validation patients without retraining")
        sp.set_defaults(func=fn)
    sp = sub.add_parser("evaluate")
    common(sp)
    sp.add_argument("--no-figures", action="store_true")
    sp.set_defaults(func=cmd_evaluate)
    sp = sub.add_parser("export-demo")
    common(sp)
    sp.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "web" / "public" / "demo"))
    sp.add_argument("--patients", type=int, default=None)
    sp.set_defaults(func=cmd_export)
    sp = sub.add_parser("serve")
    common(sp)
    sp.add_argument("--host", default="0.0.0.0")
    sp.add_argument("--port", type=int, default=None)
    sp.set_defaults(func=cmd_serve)
    sp = sub.add_parser("build", help="generate + assimilate + train + evaluate (+ export-demo with --out)")
    common(sp)
    sp.add_argument("--no-figures", action="store_true")
    sp.add_argument("--out", default=None)
    sp.add_argument("--patients", type=int, default=None)
    sp.set_defaults(func=cmd_build)
    sp = sub.add_parser("fusion-ablation", help="synthetic EHR / wearable fusion ablations -> metrics.json")
    common(sp)
    sp.set_defaults(func=cmd_fusion)

    sp = sub.add_parser("validate-real", help="external validation on real open CGM data (GlycoTwin store)")
    sp.add_argument("--glyco-path", default=None, help="path to the GlycoTwin repository (read-only)")
    sp.add_argument("--workers", type=int, default=6, help="worker processes (capped at 6)")
    sp.add_argument("--ensemble", type=int, default=64)
    sp.add_argument("--reuse", action="store_true", help="reuse cached twin runs in data/real/twin")
    sp.add_argument("--web-out", default=str(Path(__file__).resolve().parents[2] / "web" / "public" / "demo"))
    sp.add_argument("--no-web", action="store_true", help="do not copy the JSON into the web demo folder")
    sp.set_defaults(func=cmd_validate_real)

    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
