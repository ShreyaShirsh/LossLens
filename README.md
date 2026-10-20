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

## Results

At 1% random wireless loss on a 100 Mbps link, LossLens is **7× faster than CUBIC at
50 ms RTT and 24× faster at 150 ms**, and it never takes more than CUBIC's share of a
shared link.

![CUBIC vs LossLens on the same lossy link](results/plots/demo_0.01.png)

| 1% random loss, 100 Mbps link (Mbps) | CUBIC | LossLens (tree) | LossLens (oracle) | Westwood+ | BBR |
|---|---|---|---|---|---|
| Base RTT 50 ms | 3.0 | 21.8 | 31.9 | 37.6 | 70.2 |
| Base RTT 150 ms | 1.2 | 28.4 | 39.0 | 12.9 | 67.0 |

Mean of 3 runs of 30 s, with bursty background traffic using 30% of the link on average.

- **Oracle** (perfect loss classification) brings CUBIC back to its loss-free speed
  (34.6 / 42.3 Mbps); the trained decision tree recovers about 70% of that.
- **Safe:** under pure congestion LossLens behaves exactly like CUBIC.
- **BBR** is faster here but takes up to 3.5× its fair share from CUBIC users.
- **Limitation:** when other TCP flows keep the bottleneck queue full, the delay clues
  always look like congestion and LossLens falls back to plain CUBIC.

All figures: [`results/plots/`](results/plots/) ·
full table: [`results_table.csv`](results/plots/results_table.csv).

## Repository layout

```
common/   Shared C++: feature extractor, simulator ground truth
sim/      ns-3 scenario, drop labelling, experiment sweeps
ml/       Dataset loading, training, export of the tree to C++
tcp/      TcpLossAware congestion control + generated classifier
eval/     Plots and analysis of experiment results
data/     Feature CSVs written by the simulator (git-ignored)
results/  Experiment summaries and plots (git-ignored)
docs/     Setup guide and the file formats between components
report/   Report outline and documentation tasks
scripts/  Helper scripts
```

## Team

| Member | Role | Responsible for |
|---|---|---|
| **Member 1**: [@ShreyaShirsh](https://github.com/ShreyaShirsh) | Development | All code: simulation, ML, TCP, experiments, plots |
| **Member 2**: Avani Abhay Chaudhary | Documentation | Literature review, introduction, related work, simulation setup and classifier chapters |
| **Member 3**: Arpita Sinha | Documentation | Design chapter, results write-up, diagrams, slides, final formatting |

Documentation tasks are listed in [report/outline.md](report/outline.md).

## Plan

| Week | Development (Member 1) | Documentation (Members 2 + 3) |
|---|---|---|
| 1 | Setup, simulator builds and runs ✅ | Literature review; agree report template |
| 2 | Labelling checks, oracle mode, first dataset | Introduction + related work drafts; topology diagram |
| 3 | Full scenario sweep, classifier training | Simulation setup chapter (from sim/README + docs) |
| 4 | Export tree, integrate into TCP, tune fallback | Design chapter (architecture, TcpLossAware) |
| 5 | Run all comparisons + plots | Classifier chapter (features, training, threshold) |
| 6 | Fairness + safety runs, ablation | Results chapter from the plots; discussion |
| 7 | Bug fixes, final numbers, review report | Abstract, conclusion, slides |
| 8 | Live demo | Final formatting, references, rehearsal |

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

- File formats between the code components are in [docs/interfaces.md](docs/interfaces.md).
- Documentation members: read the folder READMEs and docs/ for technical details, and
  ask Member 1 before describing anything that isn't written down.
- Report numbers and figures come only from `results/` runs, never typed in by hand.

**Status:** development and evaluation complete (396 evaluation runs on ns-3.49); report in progress.
