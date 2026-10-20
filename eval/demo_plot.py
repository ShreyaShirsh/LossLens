"""Plot the latest demo run (scripts/demo.sh): before (CUBIC) vs after (LossLens).

    python eval/demo_plot.py                          # -> results/demo/demo.png
    python eval/demo_plot.py --out results/plots/demo_0.01.png

Reads the run that scripts/demo.sh left in results/demo/.
"""
import argparse
import glob
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
DEMO = REPO / "results" / "demo"
SEGMENT = 1448  # bytes


def load(classifier: str):
    matches = glob.glob(str(DEMO / f"summary_TcpLossAware-{classifier}_*.csv"))
    if len(matches) != 1:
        raise SystemExit(f"Expected one {classifier} run in {DEMO}; run scripts/demo.sh first")
    summary = pd.read_csv(matches[0]).iloc[0]
    ts = pd.read_csv(matches[0].replace("summary_", "ts_"))
    # Sending rate implied by the window: cwnd per round trip.
    ts["rate_mbps"] = ts.cwnd_bytes * 8 / (ts.rtt_ms / 1000) / 1e6
    return ts[ts.rtt_ms > 0], summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEMO / "demo.png")
    args = ap.parse_args()

    runs = {"Before: normal TCP (CUBIC)": ("cubic", "#4c72b0"),
            "After: LossLens": ("tree", "#c44e52")}
    fig, (top, bottom) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
    for name, (classifier, color) in runs.items():
        ts, s = load(classifier)
        label = f"{name}: {s.goodput_mbps:.1f} Mbps average"
        top.plot(ts.time, ts.rate_mbps.clip(upper=1.5 * s.meta_bw_mbps), color=color, label=label)
        bottom.plot(ts.time, ts.cwnd_bytes / SEGMENT, color=color)
    bw = s.meta_bw_mbps
    top.axhline(bw, color="k", ls="--", lw=0.8)
    top.text(0.6, bw * 1.02, f"link capacity {bw:g} Mbps", fontsize=8)
    top.set_ylabel("Sending rate (Mbps)")
    top.legend(loc="lower right", bbox_to_anchor=(1, 0.12))
    bottom.set_ylabel("Window (packets)")
    bottom.set_xlabel("Time (s)")
    fig.suptitle(f"Same network, before vs after LossLens: {bw:g} Mbps, {s.meta_rtt_ms:g} ms RTT, "
                 f"{s.meta_rand_loss * 100:g}% wireless loss, "
                 f"{s.meta_cross_load * 100:g}% background traffic")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.out, dpi=150, bbox_inches="tight")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
