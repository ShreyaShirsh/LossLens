# ml/: data and ML

| File | What it does |
|---|---|
| `features.py` | Feature and label column names (must match the C++ side) |
| `train.py` | Loads `data/features_*.csv`, trains tree / random forest / MLP, tunes the threshold for congestion recall, saves the tree |
| `export_tree.py` | Turns the saved tree into `tcp/generated-tree.cc` (plain C++ if/else) |

```bash
pip install -r ml/requirements.txt
python ml/train.py
python ml/export_tree.py      # then rebuild ns-3
```

## Design choices to keep in mind

- **Split by run, not by row.** Rows from the same simulation run are highly correlated;
  `train.py` uses `GroupShuffleSplit` on `meta_run_tag` so test runs are unseen.
- **Congestion recall matters most.** Calling a congestion loss "random" makes the flow
  keep pushing into a full queue. The threshold is tuned so congestion recall ≥ 0.95.
- **Never use `meta_*` columns as features.** The sender can't observe them.

## Checklist

- [ ] Week 1: (literature review moved to the documentation team)
- [ ] Week 2: run `train.py` on Member 1's first small dataset; review the feature list together
- [ ] Week 3: full training; compare tree / forest / MLP; per-scenario accuracy (group by `meta_*`)
- [ ] Week 4: pick the final depth (≤ 6), export it
- [ ] Weeks 5–6: confusion matrix, feature importance, ablation (drop one feature at a time, vary depth)
