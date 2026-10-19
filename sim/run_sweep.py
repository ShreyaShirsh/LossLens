#!/usr/bin/env python3
"""Run a grid of loss-diff-sim scenarios in parallel.

Run inside WSL after building the simulator:
    python3 sim/run_sweep.py --ns3 ~/ns-3 --preset quick
    python3 sim/run_sweep.py --ns3 ~/ns-3 --preset dataset --sample 300 --jobs 4
    python3 sim/run_sweep.py --ns3 ~/ns-3 --preset eval --jobs 4

Outputs go to data/ (dataset) or results/ (quick, eval); see docs/interfaces.md.
"""
import argparse
import glob
import itertools
import os
import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Each preset: list of (tcp, classifier) pairs plus value lists for every other flag.
PRESETS = {
    # Smoke test: a few short runs to check that everything works.
    "quick": dict(
        out="results",
        algos=[("TcpLossAware", "cubic"), ("TcpLossAware", "oracle")],
        bw=[100], rtt=[50], loss=[0.0, 0.02], buffer=[1.0], flows=[1],
        crossLoad=[0.3], crossTcp=[0], seed=[1], duration=[5],
    ),
    # Training data, features logged at every loss. Half the runs behave like
    # CUBIC, half like an ideal LossLens (oracle): the classifier must work in
    # the conditions it creates itself (large windows, queues that build).
    "dataset": dict(
        out="data",
        algos=[("TcpLossAware", "cubic"), ("TcpLossAware", "oracle")],
        bw=[50, 100, 500], rtt=[20, 50, 150],
        loss=[0.0, 0.001, 0.005, 0.01, 0.02, 0.05],
        buffer=[0.5, 1.0, 2.0], flows=[1, 2],
        crossLoad=[0.0, 0.3, 0.6], crossTcp=[0, 1], seed=[1], duration=[20],
    ),
    # Final comparison.
    "eval": dict(
        out="results",
        algos=[("TcpNewReno", ""), ("TcpCubic", ""), ("TcpWestwoodPlus", ""),
               ("TcpVeno", ""), ("TcpBbr", ""),
               ("TcpLossAware", "oracle"), ("TcpLossAware", "tree")],
        bw=[100], rtt=[50, 150], loss=[0.0, 0.001, 0.005, 0.01, 0.02, 0.05],
        buffer=[1.0], flows=[1], crossLoad=[0.3], crossTcp=[0],
        seed=[1, 2, 3], duration=[30],
    ),
    # Fairness and safety: our flow must not hurt CUBIC under pure congestion.
    "fairness": dict(
        out="results",
        algos=[("TcpCubic", ""), ("TcpLossAware", "tree")],
        bw=[100], rtt=[50], loss=[0.0, 0.01], buffer=[0.5, 1.0, 2.0], flows=[1],
        crossLoad=[0.0], crossTcp=[1, 3], seed=[1, 2, 3], duration=[30],
    ),
}

GRID_KEYS = ["bw", "rtt", "loss", "buffer", "flows", "crossLoad", "crossTcp", "seed", "duration"]


def find_binary(ns3: Path) -> str:
    hits = [p for p in glob.glob(str(ns3 / "build" / "scratch" / "**" / "*loss-diff-sim*"),
                                 recursive=True)
            if os.path.isfile(p) and os.access(p, os.X_OK)]
    if not hits:
        sys.exit(f"Simulator binary not found under {ns3}/build. "
                 "Run scripts/link-into-ns3.sh and './ns3 build' first.")
    return max(hits, key=os.path.getmtime)


def build_runs(preset: dict, sample: int | None, rng_seed: int) -> list[dict]:
    runs = []
    for (tcp, classifier), values in itertools.product(
            preset["algos"], itertools.product(*(preset[k] for k in GRID_KEYS))):
        run = dict(zip(GRID_KEYS, values), tcp=tcp)
        if classifier:
            run["classifier"] = classifier
        runs.append(run)
    if sample and sample < len(runs):
        runs = random.Random(rng_seed).sample(runs, sample)
    return runs


def run_one(binary: str, ns3: Path, out_dir: Path, run: dict, log_features: bool):
    args = [binary] + [f"--{k}={v}" for k, v in run.items()]
    args += [f"--outDir={out_dir}", f"--logFeatures={int(log_features)}"]
    proc = subprocess.run(args, cwd=ns3, capture_output=True, text=True)
    return run, proc


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--ns3", type=Path, required=True, help="path to the ns-3 directory")
    ap.add_argument("--preset", choices=PRESETS, default="quick")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--sample", type=int, help="run a random subset of this many scenarios")
    ap.add_argument("--rng-seed", type=int, default=0, help="seed for --sample")
    ap.add_argument("--dry-run", action="store_true", help="only print the runs")
    args = ap.parse_args()

    preset = PRESETS[args.preset]
    runs = build_runs(preset, args.sample, args.rng_seed)
    out_dir = REPO / preset["out"]
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"{len(runs)} runs -> {out_dir} ({args.jobs} in parallel)")
    if args.dry_run:
        for r in runs:
            print(r)
        return

    ns3 = args.ns3.expanduser().resolve()
    binary = find_binary(ns3)
    log_features = args.preset in ("dataset", "quick")
    failures = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(run_one, binary, ns3, out_dir, r, log_features) for r in runs]
        for i, fut in enumerate(as_completed(futures), 1):
            run, proc = fut.result()
            status = "ok" if proc.returncode == 0 else f"FAILED ({proc.returncode})"
            print(f"[{i}/{len(runs)}] {status}: {run}")
            if proc.returncode != 0:
                failures += 1
                print(proc.stderr[-2000:], file=sys.stderr)
    print(f"Done: {len(runs) - failures} ok, {failures} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
