# eval/ (Member 3)

`plot_results.py` reads `results/summary_*.csv` and `results/ts_*.csv` and writes plots to
`results/plots/`. Column formats are in `docs/interfaces.md`.

```bash
python eval/plot_results.py --bw 100 --rtt 50        # throughput vs random loss
python eval/plot_results.py --ts results/ts_<run_tag>.csv
```
