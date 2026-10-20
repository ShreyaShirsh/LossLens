#!/usr/bin/env bash
# Live demo: before/after LossLens on a randomly generated network.
#
# Each run invents a new network (link speed, distance, wireless loss, background
# traffic, buffer size and the random pattern of losses), then runs normal TCP
# (CUBIC, "before") and LossLens ("after") on exactly that network.
#
# Usage (inside WSL):
#   bash scripts/demo.sh ~/ns-3              # new random network every time
#   bash scripts/demo.sh ~/ns-3 fixed        # the README scenario (100 Mbps, 50 ms, 1% loss)
#   bash scripts/demo.sh ~/ns-3 replay BW RTT LOSS CROSS BUFFER SEED   # repeat a printed run
set -euo pipefail

NS3_DIR="${1:-$HOME/ns-3}"
MODE="${2:-random}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_DIR/results/demo"

pick() { local options=("$@"); echo "${options[RANDOM % ${#options[@]}]}"; }

case "$MODE" in
    random)
        BW=$(pick 50 100 200)
        RTT=$(pick 20 50 100 150)
        LOSS=$(pick 0.005 0.01 0.02 0.03)
        CROSS=$(pick 0 0.1 0.2 0.3)
        BUFFER=$(pick 0.5 1 2)
        SEED=$((RANDOM * 32768 + RANDOM + 1))
        ;;
    fixed)
        BW=100 RTT=50 LOSS=0.01 CROSS=0 BUFFER=1 SEED=1
        ;;
    replay)
        [ $# -eq 8 ] || { echo "replay needs: BW RTT LOSS CROSS BUFFER SEED" >&2; exit 1; }
        BW=$3 RTT=$4 LOSS=$5 CROSS=$6 BUFFER=$7 SEED=$8
        ;;
    *)
        echo "Unknown mode '$MODE' (use random, fixed or replay)" >&2
        exit 1
        ;;
esac

mkdir -p "$OUT"
rm -f "$OUT"/*
cd "$NS3_DIR"
BIN="$(ls -t build/scratch/loss-diff/*loss-diff-sim* | head -1)"
ARGS=("--bw=$BW" "--rtt=$RTT" "--loss=$LOSS" "--crossLoad=$CROSS" "--buffer=$BUFFER"
      "--seed=$SEED" --duration=20 --traceTs=1 "--outDir=$OUT")

pct() { awk -v x="$1" 'BEGIN{printf "%g", x * 100}'; }
echo "=================================================================="
echo " Random network for this run"
echo "   Link speed          : $BW Mbps"
echo "   Round-trip distance : $RTT ms"
echo "   Wireless loss       : $(pct "$LOSS")% of packets, random pattern #$SEED"
echo "   Background traffic  : $(pct "$CROSS")% of the link, in bursts"
echo "   Router buffer       : ${BUFFER}x bandwidth-delay product"
echo "=================================================================="
echo
echo "BEFORE: normal TCP (CUBIC) on this network... (20 simulated seconds)"
"$BIN" --classifier=cubic "${ARGS[@]}" > "$OUT/cubic.txt"
cubic=$(grep -oP 'flow 0: \K[0-9.]+' "$OUT/cubic.txt")
echo "   -> $(printf '%.1f' "$cubic") Mbps"
echo
echo "AFTER: LossLens on the same network..."
"$BIN" --classifier=tree "${ARGS[@]}" > "$OUT/losslens.txt"
lens=$(grep -oP 'flow 0: \K[0-9.]+' "$OUT/losslens.txt")
echo "   -> $(printf '%.1f' "$lens") Mbps"
echo
awk -v a="$lens" -v b="$cubic" -v bw="$BW" 'BEGIN{
    printf "RESULT: LossLens is %.1fx faster (%.0f%% of the %d Mbps link vs %.0f%%)\n",
           a / (b > 0 ? b : 1e-9), 100 * a / bw, bw, 100 * b / bw }'
echo
echo "Replay this exact run:  bash scripts/demo.sh ~/ns-3 replay $BW $RTT $LOSS $CROSS $BUFFER $SEED"

# Draw the before/after graph and open it in Windows' image viewer.
if python3 -c "import pandas, matplotlib" 2>/dev/null; then
    python3 "$REPO_DIR/eval/demo_plot.py" > /dev/null
    echo "Graph: results/demo/demo.png"
    explorer.exe "$(wslpath -w "$OUT/demo.png")" 2>/dev/null || true
else
    echo "Graph: install the plotting libraries once with"
    echo "  sudo apt install -y python3-pandas python3-matplotlib"
fi
