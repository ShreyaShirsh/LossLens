# LossLens
### Learning-Based Loss Differentiation for Adaptive TCP Congestion Control in High-Speed Wireless Networks

*Course project topic: Adaptive Congestion Control for High-Speed Networks*

TCP treats every packet loss as a sign of congestion and cuts its sending window.
On wireless links many losses are caused by interference instead, so TCP slows
down even when the network has spare capacity.

This project trains a lightweight classifier that runs inside the TCP sender
(in ns-3). At every loss event it decides whether the loss was caused by
**congestion** (reduce the window, like CUBIC) or was **random** (keep the window).

```
[sender] ──access── [router] ══ bottleneck queue ══ [AP] ~~ lossy wireless hop ~~ [receiver]
   │                    ↑ congestion drops                ↑ random drops
   │               + cross traffic
   └─ TcpLossAware (extends TcpCubic)
        loss detected → compute features → classifier → cut cwnd only if "congestion"
```

The simulator knows exactly why each packet was dropped (queue overflow or
wireless error), which gives us labelled training data for free.

## Repository layout

```
common/   Shared C++: feature extractor, simulator ground truth     (Members 1 + 3)
sim/      ns-3 scenario, drop labelling, experiment sweeps           (Member 1)
ml/       Dataset loading, training, export of the tree to C++       (Member 2)
tcp/      TcpLossAware congestion control + generated classifier     (Member 3)
eval/     Plots and analysis of experiment results                   (Member 3)
data/     Feature CSVs written by the simulator (git-ignored)
results/  Experiment summaries and plots (git-ignored)
docs/     Setup guide and the interfaces between members
report/   Report outline
scripts/  Helper scripts
```

## Team

| Member | Role | Owns |
|---|---|---|
| **Member 1** | Simulation and network | `sim/`, `common/ground-truth.*`, running all experiments |
| **Member 2** | Data and ML | `ml/` (features list, training, tree export) |
| **Member 3** | TCP and evaluation | `tcp/`, `eval/`, `common/loss-features.*` |

Each folder has a README with that member's task checklist.

## Plan

| Week | Member 1 (Simulation) | Member 2 (ML) | Member 3 (TCP + eval) |
|---|---|---|---|
| 1 | Setup, topology builds and runs | Literature review, feature list | Study ns-3 TCP internals, run baselines |
| 2 | Drop labelling verified, first dataset to M2 | Training pipeline on first dataset | Oracle mode of `TcpLossAware` working |
| 3 | Full scenario sweep → dataset | Train tree / forest / MLP, tune congestion recall | Measure oracle gain over CUBIC |
| 4 | Reusable experiment runner | Export tree to C++ | Integrate tree, tune safety fallback |
| 5 | Run all comparisons | Classifier analysis | Plotting scripts |
| 6 | Fairness + pure-congestion runs | Ablation study | Results analysis, bug fixes |
| 7 | Report: setup + method | Report: related work + classifier | Report: TCP design + results |
| 8 | Live demo | Slides | Final integration |

## Quick start

1. Install WSL2, ns-3 and the Python packages: see [docs/setup.md](docs/setup.md).
2. Link the sources into ns-3 and build (inside WSL):
   ```bash
   bash scripts/link-into-ns3.sh ~/ns-3
   cd ~/ns-3 && ./ns3 build
   ./ns3 run "loss-diff-sim --duration=5 --outDir=/mnt/d/PROJECTS/CN\ PROJECT/results"
   ```
3. Generate training data: `python3 sim/run_sweep.py --ns3 ~/ns-3 --preset dataset --sample 300`
4. Train and export: `python ml/train.py`, then `python ml/export_tree.py`
5. Rebuild ns-3, run `--preset eval`, then `python eval/plot_results.py`

## Working rules

- The contracts between members are in [docs/interfaces.md](docs/interfaces.md).
  Change them only when all three agree.
- One branch per task (`m1/topology`, `m2/train`, `m3/oracle`, ...), merged by pull request.
- Short weekly sync to check the hand-offs.

**Status:** skeleton. In week 1 everyone's first job is to get the smoke test
(step 2) to build and run.
