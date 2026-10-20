"""Evaluation plots and tables.

    python eval/plot_results.py                       # all figures + results table
    python eval/plot_results.py --ts results/ts_<run_tag>.csv

Reads results/summary_*.csv (see docs/interfaces.md) and writes PNGs and a CSV
table to results/plots/.
"""
import argparse
import glob
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

# Display order and style: baselines muted, LossLens highlighted, oracle dashed.
ALGOS = {
    "NewReno": dict(color="#8c8c8c", ls="-", marker="v"),
    "CUBIC": dict(color="#4c72b0", ls="-", marker="o"),
    "Westwood+": dict(color="#55a868", ls="-", marker="s"),
    "Veno": dict(color="#8172b3", ls="-", marker="D"),
    "BBR": dict(color="#937860", ls="-", marker="^"),
    "LossLens (tree)": dict(color="#c44e52", ls="-", marker="*", lw=2.5, ms=10),
    "LossLens (oracle)": dict(color="#c44e52", ls="--", marker="", lw=1.5),
}
NAMES = {"TcpNewReno": "NewReno", "TcpCubic": "CUBIC", "TcpWestwoodPlus": "Westwood+",
         "TcpVeno": "Veno", "TcpBbr": "BBR"}


def algo_name(row) -> str:
    if row.meta_tcp == "TcpLossAware":
        return f"LossLens ({row.meta_classifier})"
    return NAMES.get(row.meta_tcp, row.meta_tcp)


def load(results: Path) -> pd.DataFrame:
    files = glob.glob(str(results / "summary_*.csv"))
    if not files:
        raise SystemExit(f"No summary files in {results}")
    df = pd.concat((pd.read_csv(f) for f in files), ignore_index=True)
    df["meta_classifier"] = df["meta_classifier"].fillna("")
    if "cross_tcp_mbps" not in df:
        df["cross_tcp_mbps"] = 0.0
    df["algo"] = df.apply(algo_name, axis=1)
    return df


def throughput_vs_loss(df: pd.DataFrame, out: Path):
    """Main result: goodput as the random loss rate grows, one panel per RTT."""
    rtts = sorted(df.meta_rtt_ms.unique())
    fig, axes = plt.subplots(1, len(rtts), figsize=(6 * len(rtts), 4.5), sharey=True,
                             squeeze=False)
    for ax, rtt in zip(axes[0], rtts):
        g = (df[df.meta_rtt_ms == rtt].groupby(["algo", "meta_rand_loss"]).goodput_mbps
             .agg(["mean", "std"]).reset_index())
        for algo, style in ALGOS.items():
            d = g[g.algo == algo]
            if d.empty:
                continue
            ax.errorbar(d.meta_rand_loss * 100, d["mean"], yerr=d["std"].fillna(0), capsize=3,
                        label=algo, **style)
        ax.set_xscale("symlog", linthresh=0.1)
        ax.set_xticks([0, 0.1, 0.5, 1, 2, 5])
        ax.set_xticklabels(["0", "0.1", "0.5", "1", "2", "5"])
        ax.set_title(f"Base RTT {rtt:g} ms")
        ax.set_xlabel("Random loss on wireless hop (%)")
        ax.grid(alpha=0.3)
    axes[0][0].set_ylabel("Goodput (Mbps)")
    axes[0][-1].legend(fontsize=8)
    fig.suptitle("Goodput vs random wireless loss (100 Mbps bottleneck, 30% bursty cross traffic)")
    fig.savefig(out / "throughput_vs_loss.png", dpi=150, bbox_inches="tight")
    print(f"Wrote {out / 'throughput_vs_loss.png'}")


def results_table(df: pd.DataFrame, out: Path):
    """Mean goodput per algorithm, RTT and loss rate, for the report."""
    t = (df.groupby(["meta_rtt_ms", "algo", "meta_rand_loss"]).goodput_mbps.mean()
         .unstack("meta_rand_loss").round(1))
    t.columns = [f"loss {c * 100:g}%" for c in t.columns]
    order = {a: i for i, a in enumerate(ALGOS)}
    t = t.reset_index().sort_values(["meta_rtt_ms", "algo"], key=lambda s: s.map(order)
                                     if s.name == "algo" else s)
    t = t.rename(columns={"meta_rtt_ms": "rtt_ms"})
    t.to_csv(out / "results_table.csv", index=False)
    print(f"Wrote {out / 'results_table.csv'}")
    print(t.to_string(index=False))


def fairness(df: pd.DataFrame, out: Path):
    """Our flow's share of the link relative to a fair share (1.0 = fair)."""
    if df.empty:
        print("No fairness runs found (crossTcp > 0); skipping fairness plot")
        return
    n = df.meta_cross_tcp
    df = df.assign(norm_share=df.goodput_mbps / ((df.goodput_mbps + n * df.cross_tcp_mbps) / (n + 1)))
    losses = sorted(df.meta_rand_loss.unique())
    comps = sorted(df.meta_cross_tcp.unique())
    fig, axes = plt.subplots(len(losses), len(comps), figsize=(5 * len(comps), 3.6 * len(losses)),
                             sharey=True, squeeze=False)
    algos = [a for a in ALGOS if a in set(df.algo)]
    width = 0.8 / len(algos)
    for i, loss in enumerate(losses):
        for j, comp in enumerate(comps):
            ax = axes[i][j]
            d = df[(df.meta_rand_loss == loss) & (df.meta_cross_tcp == comp)]
            g = d.groupby(["algo", "meta_buffer_bdp"]).norm_share.agg(["mean", "std"]).reset_index()
            buffers = sorted(g.meta_buffer_bdp.unique())
            for k, algo in enumerate(algos):
                a = g[g.algo == algo].set_index("meta_buffer_bdp").reindex(buffers)
                xs = [b + (k - (len(algos) - 1) / 2) * width for b in range(len(buffers))]
                ax.bar(xs, a["mean"], width, yerr=a["std"].fillna(0), capsize=3, label=algo,
                       color=ALGOS[algo]["color"])
            ax.axhline(1.0, color="k", ls="--", lw=0.8)
            ax.set_xticks(range(len(buffers)))
            ax.set_xticklabels([f"{b:g}x BDP" for b in buffers])
            ax.set_title(f"{loss * 100:g}% wireless loss, vs {comp} CUBIC flow(s)", fontsize=10)
            ax.grid(alpha=0.3, axis="y")
        axes[i][0].set_ylabel("Share / fair share")
    axes[0][-1].legend(fontsize=8)
    fig.suptitle("Fairness: 1.0 = exactly a fair share of the bottleneck")
    fig.savefig(out / "fairness.png", dpi=150, bbox_inches="tight")
    print(f"Wrote {out / 'fairness.png'}")


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
    ap.add_argument("--ts", type=Path, help="plot a time-series file instead")
    args = ap.parse_args()

    out = args.results / "plots"
    out.mkdir(parents=True, exist_ok=True)
    if args.ts:
        time_series(args.ts, out)
        return

    df = load(args.results)
    comparison = df[(df.meta_cross_tcp == 0) & (df.meta_flows == 1)]
    throughput_vs_loss(comparison, out)
    results_table(comparison, out)
    fairness(df[df.meta_cross_tcp > 0], out)


if __name__ == "__main__":
    main()
