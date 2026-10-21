# eval/: evaluation plots

| Script | What it does |
|---|---|
| `plot_results.py` | Reads `results/summary_*.csv` and writes `throughput_vs_loss.png`, `fairness.png` and `results_table.csv` to `results/plots/` |
| `demo_plot.py` | Draws the before/after graph of the latest `scripts/demo.sh` run to `results/demo/demo.png` |

```bash
python eval/plot_results.py                                  # all figures + table
python eval/plot_results.py --ts results/ts_<run_tag>.csv    # cwnd/RTT over time for one run
python eval/demo_plot.py                                     # latest demo run
```

Column formats are in `docs/interfaces.md`.
