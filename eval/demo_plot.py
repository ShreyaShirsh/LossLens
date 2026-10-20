"""Demo figure: CUBIC vs LossLens on the same lossy link (output of scripts/demo.sh).

    python eval/demo_plot.py              # default 1% loss
    python eval/demo_plot.py --loss 0.02

Writes results/plots/demo_<loss>.png.
"""
import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
DEMO = REPO / "results" / "demo"
SEGMENT = 1448  # bytes


def load(classifier: str, loss: str):
    tag = f"TcpLossAware-{classifier}_bw100_rtt50_loss{loss}_buf1_f1_x0_t0_s1"
    ts = pd.read_csv(DEMO / f"ts_{tag}.csv")
    goodput = pd.read_csv(DEMO / f"summary_{tag}.csv").goodput_mbps.iloc[0]
    # Sending rate implied by the window: cwnd per round trip.
    ts["rate_mbps"] = ts.cwnd_bytes * 8 / (ts.rtt_ms / 1000) / 1e6
    return ts[ts.rtt_ms > 0], goodput


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--loss", default="0.01", help="loss rate used in scripts/demo.sh")
    args = ap.parse_args()

    runs = {"Normal TCP (CUBIC)": ("cubic", "#4c72b0"), "LossLens": ("tree", "#c44e52")}
    fig, (top, bottom) = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
    for name, (classifier, color) in runs.items():
        ts, goodput = load(classifier, args.loss)
        label = f"{name}: {goodput:.1f} Mbps average"
        top.plot(ts.time, ts.rate_mbps.clip(upper=150), color=color, label=label)
        bottom.plot(ts.time, ts.cwnd_bytes / SEGMENT, color=color)
    top.axhline(100, color="k", ls="--", lw=0.8)
    top.text(0.6, 102, "link capacity 100 Mbps", fontsize=8)
    top.set_ylabel("Sending rate (Mbps)")
    top.legend(loc="lower right", bbox_to_anchor=(1, 0.12))
    bottom.set_ylabel("Window (packets)")
    bottom.set_xlabel("Time (s)")
    loss_pct = float(args.loss) * 100
    fig.suptitle(f"Same link, {loss_pct:g}% random wireless loss: "
                 "CUBIC slows down at every loss, LossLens keeps going")
    out = REPO / "results" / "plots" / f"demo_{args.loss}.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
