"""Pre-run a set of networks (via WSL) and store them as app/data/demos.json.

    python app/make_demo_cache.py

The web app can replay these instantly, and falls back to them if WSL is unavailable.
"""
import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import simrunner  # noqa: E402

OUT = Path(__file__).resolve().parent / "data" / "demos.json"
WORK = simrunner.REPO / "results" / "app_runs" / "cache"

SCENARIOS = [
    ("Home Wi-Fi, 1% interference", dict(bw=100, rtt=50, loss=0.01, cross=0, buffer=1, seed=1)),
    ("Cafe Wi-Fi with other users", dict(bw=200, rtt=50, loss=0.005, cross=0.3, buffer=1, seed=711022679)),
    ("Long-distance link, 0.5% loss", dict(bw=50, rtt=100, loss=0.005, cross=0, buffer=1, seed=289309776)),
    ("Mobile network, 2% loss", dict(bw=100, rtt=150, loss=0.02, cross=0.1, buffer=1, seed=4242)),
    ("Busy campus link", dict(bw=200, rtt=100, loss=0.01, cross=0.2, buffer=2, seed=97531)),
    ("Very noisy radio, 3% loss", dict(bw=50, rtt=20, loss=0.03, cross=0, buffer=1, seed=2468)),
    ("Heavy traffic jam, no wireless loss", dict(bw=100, rtt=50, loss=0, cross=0.6, buffer=0.5, seed=1)),
    ("Shallow buffer plus noise", dict(bw=100, rtt=50, loss=0.02, cross=0.3, buffer=0.5, seed=31337)),
]


def run(item):
    title, p = item
    p = dict(p, duration=20)
    d = WORK / f"{abs(hash(title)) % 10**8}"
    shutil.rmtree(d, ignore_errors=True)
    binary = simrunner.find_binary()
    procs = simrunner.start(binary, p, d)
    for cls, proc in procs.items():
        proc.wait()
        if proc.returncode:
            raise SystemExit(f"{title}: {cls} failed: {proc.stderr.read()[-400:]}")
    res = {c: simrunner.load_result(d, c, p["bw"]) for c in simrunner.CLASSIFIERS}
    print(f"  {title:42s} CUBIC {res['cubic']['goodput']:6.1f}  LossLens {res['tree']['goodput']:6.1f}"
          f"  oracle {res['oracle']['goodput']:6.1f} Mbps", flush=True)
    return {"title": title, "params": p, "result": res}


def main():
    t0 = time.time()
    binary = simrunner.find_binary()
    if not binary:
        raise SystemExit("Simulator not found in WSL (is Ubuntu installed and ns-3 built?)")
    print("Running", len(SCENARIOS), "scenarios x 3 classifiers on", binary)
    with ThreadPoolExecutor(max_workers=4) as pool:
        demos = list(pool.map(run, SCENARIOS))
    OUT.write_text(json.dumps(demos, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB) in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
