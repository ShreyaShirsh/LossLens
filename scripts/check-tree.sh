#!/usr/bin/env bash
# Run the five tree-mode checks in parallel and write results to the repo's results/.
# Usage (inside WSL):  bash scripts/check-tree.sh ~/ns-3
set -euo pipefail

NS3_DIR="${1:-$HOME/ns-3}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO_DIR/results"

cd "$NS3_DIR"
./ns3 build
BIN="$(ls -t build/scratch/loss-diff/*loss-diff-sim* | head -1)"
echo "Using $BIN"

COMMON=(--duration=20 "--outDir=$OUT")
"$BIN" --classifier=tree --loss=0.01 --crossLoad=0 --traceTs=1 "${COMMON[@]}" &
"$BIN" --classifier=tree --loss=0.01 --crossLoad=0.3 --traceTs=1 "${COMMON[@]}" &
"$BIN" --classifier=tree --loss=0 --crossLoad=0.6 --buffer=0.5 "${COMMON[@]}" &
"$BIN" --classifier=cubic --loss=0 --crossLoad=0 --crossTcp=1 "${COMMON[@]}" &
"$BIN" --classifier=tree --loss=0 --crossLoad=0 --crossTcp=1 "${COMMON[@]}" &
wait
echo "ALL DONE"
