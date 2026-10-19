"""Evaluation plots (owner: Member 3).

    python eval/plot_results.py --bw 100 --rtt 50
    python eval/plot_results.py --ts results/ts_<run_tag>.csv

Reads results/summary_*.csv (see docs/interfaces.md) and writes PNGs to results/plots/.
"""
import argparse
import glob
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

REPO = Path(__file__).resolve().parent.parent


def algo_name(row) -> str:
    if row.meta_tcp == "TcpLossAware":
        return f"LossAware ({row.meta_classifier})"
    return row.meta_tcp


def throughput_vs_loss(df: pd.DataFrame, out: Path):
    """Main result: goodput per flow as the random loss rate grows."""
    g = df.groupby(["algo", "meta_rand_loss"]).goodput_mbps.agg(["mean", "std"]).reset_index()
    fig, ax = plt.subplots(figsize=(7, 4.5))
    for algo, d in g.groupby("algo"):
        ax.errorbar(d.meta_rand_loss * 100, d["mean"], yerr=d["std"], marker="o",
                    capsize=3, label=algo)
    ax.set_xscale("symlog", linthresh=0.1)
    ax.set_xlabel("Random loss rate on wireless hop (%)")
    ax.set_ylabel("Goodput per flow (Mbps)")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.savefig(out / "throughput_vs_loss.png", dpi=150, bbox_inches="tight")
    print(f"Wrote {out / 'throughput_vs_loss.png'}")


def time_series(path: Path, out: Path):
    """cwnd and RTT over time for one run (needs --traceTs=1)."""
    ts = pd.read_csv(path)
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(8, 5), sharex=True)
    for flow, d in ts.groupby("flow_id"):
        a1.plot(d.time, d.cwnd_bytes / 1448, label=f"flow {flow}")
        a2.plot(d.time, d.rtt_ms)
    a1.set_ylabel("cwnd (segments)")
    a2.set_ylabel("RTT (ms)")
    a2.set_xlabel("time (s)")
    a1.legend()
    name = out / (path.stem + ".png")
    fig.savefig(name, dpi=150, bbox_inches="tight")
    print(f"Wrote {name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", type=Path, default=REPO / "results")
    ap.add_argument("--bw", type=float, help="only scenarios with this bottleneck (Mbps)")
    ap.add_argument("--rtt", type=float, help="only scenarios with this base RTT (ms)")
    ap.add_argument("--ts", type=Path, help="plot a time-series file instead")
    args = ap.parse_args()

    out = args.results / "plots"
    out.mkdir(parents=True, exist_ok=True)
    if args.ts:
        time_series(args.ts, out)
        return

    files = glob.glob(str(args.results / "summary_*.csv"))
    if not files:
        raise SystemExit(f"No summary files in {args.results}")
    df = pd.concat((pd.read_csv(f) for f in files), ignore_index=True)
    df["meta_classifier"] = df["meta_classifier"].fillna("")
    if args.bw is not None:
        df = df[df.meta_bw_mbps == args.bw]
    if args.rtt is not None:
        df = df[df.meta_rtt_ms == args.rtt]
    df["algo"] = df.apply(algo_name, axis=1)
    throughput_vs_loss(df, out)
    # TODO(Member 3): fairness (Jain) vs buffer size, classifier confusion matrix, RTT CDF.


if __name__ == "__main__":
    main()
