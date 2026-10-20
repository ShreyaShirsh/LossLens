#!/usr/bin/env bash
# Rebuild, then run sweep presets in the background (default: eval and fairness).
# Progress goes to results/eval.log; safe to close the terminal.
# Usage (inside WSL):  bash scripts/run-eval.sh ~/ns-3 [preset ...]
#   e.g.               bash scripts/run-eval.sh ~/ns-3 fairness
set -euo pipefail

NS3_DIR="${1:-$HOME/ns-3}"
shift || true
PRESETS="${*:-eval fairness}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$REPO_DIR/results/eval.log"

(cd "$NS3_DIR" && ./ns3 build)

nohup bash -c "
  cd '$REPO_DIR'
  for p in $PRESETS; do
    python3 -u sim/run_sweep.py --ns3 '$NS3_DIR' --preset \$p --jobs 12
  done
  echo 'EVAL FINISHED'
" > "$LOG" 2>&1 &

echo "Started presets: $PRESETS. Follow progress with:"
echo "  tail -f \"$LOG\""
