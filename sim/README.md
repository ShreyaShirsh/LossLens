# sim/: simulation and network

| File | What it does |
|---|---|
| `loss-diff-sim.cc` | ns-3 scenario: topology, cross traffic, drop labelling, CSV output |
| `run_sweep.py` | Runs many scenarios in parallel (`quick`, `dataset`, `eval`, `fairness` presets) |
| `../common/ground-truth.*` | Records why each packet was dropped |

## How the labelling works

1. Every data segment of a monitored flow dropped by the **bottleneck queue** is
   recorded as `CONGESTION`, and every one dropped by the **wireless error model** as `RANDOM`
   (keyed by flow and TCP sequence number).
2. When the sender detects a loss (enters fast recovery or times out), the drops still
   pending for that flow give the label. Any queue drop → congestion.
3. When the recovery ends, drops below the recovery point are cleared, because they
   belonged to that event.

## Checklist

**Week 1**
- [ ] WSL2 + ns-3 installed (docs/setup.md); team agreed on one ns-3 release
- [ ] `loss-diff-sim` builds and the smoke test runs
- [ ] Topology checked: run `--loss=0 --crossLoad=0 --flows=1` and confirm goodput is close to `--bw`

**Week 2**
- [ ] Labelling sanity checks:
  - `--loss=0 --crossLoad=0.6` → all labels should be 1
  - `--loss=0.02 --crossLoad=0 --buffer=4` → mostly 0
  - Fraction of `label = -1` rows below ~5%. If it is higher, find where else packets are dropped
- [ ] Check the feature values look sensible
- [ ] Generate a first small dataset (`run_sweep.py --preset dataset --sample 50`)

**Week 3**
- [ ] Time one run at 500 Mbps / 20 s, then size the grid in `run_sweep.py`
- [ ] Generate the full dataset into `data/`

**Weeks 4–6**
- [ ] Run the `eval` and `fairness` presets once the tree is integrated
- [ ] Optional: replace the point-to-point "wireless" hop with real ns-3 Wi-Fi for extra realism

## Known limitations

- Builds and runs on ns-3.49 (team release).
- At 1 Gbps the simulation is slow (millions of packets). Start at 50–100 Mbps.
- With `--tcp=TcpBbr`, pacing is enabled for all sockets, including the CUBIC cross traffic.
