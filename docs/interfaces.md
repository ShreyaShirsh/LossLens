# Interfaces between members

These are the hand-offs between the three parts of the project. Change them only
when all three members agree, and update the code on both sides in the same pull request.

## 1. Feature dataset (Member 1 → Member 2)

**File:** `data/features_<run_tag>.csv`, written by `sim/loss-diff-sim.cc` when
`--tcp=TcpLossAware --logFeatures=1`. One row per **loss event** (each time TCP
would cut its window: fast retransmit or timeout).

| Column | Meaning |
|---|---|
| `meta_*` | Scenario settings (run tag, TCP variant, bandwidth, RTT, random loss rate, buffer, flows, cross traffic, seed). **Not features**: the sender can't observe them. Use them only for grouping and per-scenario analysis. |
| `time` | Simulation time of the event (s) |
| `flow_id` | Monitored flow index |
| `event_id` | Event counter within the flow |
| `is_rto` | 1 if the event was a retransmission timeout (always treated as congestion) |
| *7 feature columns* | See section 2 |
| `n_cong_drops`, `n_rand_drops` | Ground-truth drops pending when the loss was detected |
| `label` | **1** = congestion (any queue drop), **0** = random (only wireless drops), **-1** = unknown (no recorded drop, e.g. spurious retransmission). Drop -1 rows before training |
| `predicted` | Decision the sender made (always 1 in `cubic` mode) |

## 2. Features (shared code: `common/loss-features.cc`)

The same C++ code computes the features for logging and inside TCP at run time.

| Column | Definition |
|---|---|
| `srtt_ratio` | smoothed RTT / minimum RTT seen |
| `rtt_gradient` | least-squares slope of the last 16 RTT samples vs time (s/s) |
| `rtt_var` | std / mean of the last 16 RTT samples |
| `ack_jitter` | std / mean of the last 16 gaps between ACKs that acknowledge new data |
| `cwnd_bdp_ratio` | cwnd / (delivery rate over the last ~1 sRTT × min RTT) |
| `time_since_loss` | time since the previous loss event, in smoothed RTTs (capped at 1000) |
| `loss_rate` | EWMA (gain 1/8) of 1 / (segments acked between loss events) |

To add or change a feature: edit `common/loss-features.*`, `ml/features.py` and this
table, then regenerate the dataset.

## 3. Classifier (Member 2 → Member 3)

```cpp
// tcp/loss-classifier.h
bool IsCongestionLossTree(const LossFeatures& f);   // true = congestion
```

Implemented in `tcp/generated-tree.cc`, which **`ml/export_tree.py` generates**. Don't
edit it by hand. Until a model exists, the placeholder returns `true` (plain CUBIC).

## 4. Experiment outputs (Member 1 → Member 3)

**Run tag:** `<tcp>[-<classifier>]_bw<Mbps>_rtt<ms>_loss<rate>_buf<xBDP>_f<flows>_x<crossLoad>_t<crossTcp>_s<seed>`,
for example `TcpLossAware-tree_bw100_rtt50_loss0.01_buf1_f1_x0.3_t0_s1`.

`results/summary_<run_tag>.csv`: one row per monitored flow.

| Column | Meaning |
|---|---|
| `meta_*` | As above |
| `flow_id` | Flow index |
| `goodput_mbps` | Bytes received by the sink / active time |
| `mean_rtt_ms`, `p95_rtt_ms` | From the sender's smoothed-RTT trace |
| `loss_events` | Times the flow entered recovery or timeout |
| `cong_drops`, `rand_drops` | Ground-truth drop counts |
| `jain` | Jain's fairness index across the monitored flows (same on every row) |

`results/ts_<run_tag>.csv` (with `--traceTs=1`): `time,flow_id,cwnd_bytes,rtt_ms` every 10 ms.

## 5. Simulator flags

| Flag | Default | Meaning |
|---|---|---|
| `--tcp` | `TcpLossAware` | Any ns-3 TCP variant: `TcpCubic`, `TcpNewReno`, `TcpWestwoodPlus`, `TcpVeno`, `TcpBbr`, ... |
| `--classifier` | `cubic` | TcpLossAware mode: `cubic` / `oracle` / `tree` |
| `--bw` | 100 | Bottleneck rate (Mbps) |
| `--rtt` | 50 | Base RTT (ms) |
| `--loss` | 0.01 | Random packet loss rate on the wireless hop |
| `--buffer` | 1.0 | Bottleneck buffer (× BDP) |
| `--flows` | 1 | Monitored flows |
| `--crossLoad` | 0.3 | Average bursty UDP load (fraction of bottleneck) |
| `--crossTcp` | 0 | Competing CUBIC flows |
| `--duration` | 20 | Seconds |
| `--seed` | 1 | RNG run number |
| `--outDir` | `results` | Output folder |
| `--logFeatures` | 1 | Write the feature CSV (TcpLossAware only) |
| `--traceTs` | 0 | Write the cwnd/RTT time series |

## 6. Build rule

ns-3 compiles all `.cc` files in `scratch/loss-diff/` into one program. It finds the
entry point by searching the files for the word `main`, so **only
`sim/loss-diff-sim.cc` may contain that word** (not even in comments, and watch out for
words like "remain").
