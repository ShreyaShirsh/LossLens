#!/usr/bin/env bash
# Symlink the C++ sources of common/, sim/ and tcp/ into <ns-3>/scratch/loss-diff/.
# ns-3 compiles every .cc file in a scratch subfolder into one program, named
# after the file that contains the entry point (sim/loss-diff-sim.cc).
#
# Usage (inside WSL):  bash scripts/link-into-ns3.sh ~/ns-3
# Re-run it whenever a .cc/.h file is added or removed.
set -euo pipefail

NS3_DIR="${1:?usage: $0 <path-to-ns-3>}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$NS3_DIR/scratch/loss-diff"

[ -x "$NS3_DIR/ns3" ] || { echo "No ns3 script in $NS3_DIR" >&2; exit 1; }

mkdir -p "$TARGET"
find "$TARGET" -maxdepth 1 -type l -delete

for dir in common sim tcp; do
    for f in "$REPO_DIR/$dir"/*.h "$REPO_DIR/$dir"/*.cc; do
        [ -e "$f" ] || continue
        ln -s "$f" "$TARGET/$(basename "$f")"
    done
done

echo "Linked into $TARGET:"
ls -1 "$TARGET"
echo
echo "Next: cd $NS3_DIR && ./ns3 build"
