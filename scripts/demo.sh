#!/usr/bin/env bash
# Live demo: normal TCP (CUBIC) vs LossLens on the same 100 Mbps link with 1% random
# wireless loss, run side by side. Results go to results/demo/.
# Usage (inside WSL):  bash scripts/demo.sh ~/ns-3 [loss] [seed]   e.g. 0.02 7
# The same loss and seed always give the same result (deterministic simulation);
# a different seed gives a different pattern of random losses.
set -euo pipefail

NS3_DIR="${1:-$HOME/ns-3}"
LOSS="${2:-0.01}"
SEED="${3:-1}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_DIR/results/demo"
mkdir -p "$OUT"

cd "$NS3_DIR"
BIN="$(ls -t build/scratch/loss-diff/*loss-diff-sim* | head -1)"
ARGS=(--bw=100 --rtt=50 "--loss=$LOSS" "--seed=$SEED" --crossLoad=0 --duration=20 --traceTs=1 "--outDir=$OUT")

echo "Simulating 20 s on a 100 Mbps link with ${LOSS} random wireless loss (seed ${SEED})..."
"$BIN" --classifier=cubic "${ARGS[@]}" > "$OUT/cubic.txt" &
"$BIN" --classifier=tree "${ARGS[@]}" > "$OUT/losslens.txt" &
wait

cubic=$(grep -oP 'flow 0: \K[0-9.]+' "$OUT/cubic.txt")
lens=$(grep -oP 'flow 0: \K[0-9.]+' "$OUT/losslens.txt")
echo
echo "  Normal TCP (CUBIC) : $(printf '%6.1f' "$cubic") Mbps"
echo "  LossLens           : $(printf '%6.1f' "$lens") Mbps"
echo "  LossLens is $(awk -v a="$lens" -v b="$cubic" 'BEGIN{printf "%.0f", a/b}')x faster"
echo
echo "Plot (from Windows, in the project folder):  python eval/demo_plot.py --loss $LOSS --seed $SEED"
