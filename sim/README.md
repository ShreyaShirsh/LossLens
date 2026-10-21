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

## Known limitations

- Builds and runs on ns-3.49 (team release).
- At 1 Gbps the simulation is slow (millions of packets). Start at 50–100 Mbps.
- With `--tcp=TcpBbr`, pacing is enabled for all sockets, including the CUBIC cross traffic.
- The "wireless" hop is a point-to-point link with a random error model, not a full ns-3
  Wi-Fi model; replacing it with Wi-Fi is possible future work.
