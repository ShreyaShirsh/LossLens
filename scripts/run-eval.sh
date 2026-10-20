#!/usr/bin/env bash
# Rebuild, then run the final comparison (eval preset) and the fairness preset.
# Progress goes to results/eval.log; safe to close the terminal.
# Usage (inside WSL):  bash scripts/run-eval.sh ~/ns-3
set -euo pipefail

NS3_DIR="${1:-$HOME/ns-3}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$REPO_DIR/results/eval.log"

(cd "$NS3_DIR" && ./ns3 build)

nohup bash -c "
  cd '$REPO_DIR'
  python3 -u sim/run_sweep.py --ns3 '$NS3_DIR' --preset eval --jobs 12
  python3 -u sim/run_sweep.py --ns3 '$NS3_DIR' --preset fairness --jobs 12
  echo 'EVAL FINISHED'
" > "$LOG" 2>&1 &

echo "Started in the background. Follow progress with:"
echo "  tail -f \"$LOG\""
