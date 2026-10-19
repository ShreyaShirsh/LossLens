"""Train loss classifiers on the simulator's feature logs.

    python ml/train.py                      # uses data/features_*.csv
    python ml/train.py --max-depth 4 --target-recall 0.97

Saves the decision tree to ml/models/tree.joblib for export_tree.py.
"""
import argparse
import glob
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, recall_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

from features import CONGESTION, FEATURE_COLUMNS, GROUP_COLUMN, LABEL_COLUMN

ML_DIR = Path(__file__).resolve().parent
REPO = ML_DIR.parent


def load(pattern: str, include_rto: bool) -> pd.DataFrame:
    files = sorted(glob.glob(pattern))
    if not files:
        raise SystemExit(f"No files match {pattern}. Generate data first "
                         "(sim/run_sweep.py --preset dataset).")
    df = pd.concat((pd.read_csv(f) for f in files), ignore_index=True)
    total = len(df)
    df = df[df[LABEL_COLUMN] >= 0]
    if not include_rto:
        df = df[df["is_rto"] == 0]  # timeouts are always treated as congestion anyway
    print(f"{len(files)} files, {total} loss events, {len(df)} usable "
          f"({(df[LABEL_COLUMN] == CONGESTION).mean():.1%} congestion)")
    return df


def threshold_for_recall(y_true, p_congestion, target: float) -> float:
    """Highest threshold on P(congestion) that keeps congestion recall >= target.

    Calling a congestion loss "random" is the dangerous mistake (the flow keeps
    pushing into a full queue), so we trade some random-loss accuracy for it.
    """
    for t in np.linspace(0.95, 0.05, 91):
        if recall_score(y_true, p_congestion >= t, pos_label=CONGESTION) >= target:
            return float(t)
    return 0.05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(REPO / "data" / "features_*.csv"))
    ap.add_argument("--max-depth", type=int, default=6)
    ap.add_argument("--target-recall", type=float, default=0.95)
    ap.add_argument("--include-rto", action="store_true")
    args = ap.parse_args()

    df = load(args.data, args.include_rto)
    if df[LABEL_COLUMN].nunique() < 2:
        raise SystemExit("Need both congestion and random losses in the data.")

    split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=0)
    train_idx, test_idx = next(split.split(df, groups=df[GROUP_COLUMN]))
    train, test = df.iloc[train_idx], df.iloc[test_idx]
    X_train, y_train = train[FEATURE_COLUMNS], train[LABEL_COLUMN]
    X_test, y_test = test[FEATURE_COLUMNS], test[LABEL_COLUMN]

    models = {
        "tree": DecisionTreeClassifier(max_depth=args.max_depth, min_samples_leaf=20,
                                       class_weight="balanced", random_state=0),
        "forest": RandomForestClassifier(n_estimators=200, min_samples_leaf=5,
                                         class_weight="balanced", n_jobs=-1, random_state=0),
        "mlp": make_pipeline(StandardScaler(),
                             MLPClassifier(hidden_layer_sizes=(32, 16), max_iter=500,
                                           random_state=0)),
    }

    results = {}
    for name, model in models.items():
        model.fit(X_train, y_train)
        cong_col = list(model.classes_).index(CONGESTION)
        # Threshold is tuned on training data, then checked on the held-out runs.
        t = threshold_for_recall(y_train, model.predict_proba(X_train)[:, cong_col],
                                 args.target_recall)
        y_pred = (model.predict_proba(X_test)[:, cong_col] >= t).astype(int)
        results[name] = (model, t)
        print(f"\n=== {name} (threshold {t:.2f}) ===")
        print(confusion_matrix(y_test, y_pred, labels=[CONGESTION, 0]))
        print(classification_report(y_test, y_pred, labels=[CONGESTION, 0],
                                    target_names=["congestion", "random"], digits=3))

    tree, t = results["tree"]
    print("Tree feature importance:")
    for feat, imp in sorted(zip(FEATURE_COLUMNS, tree.feature_importances_), key=lambda x: -x[1]):
        print(f"  {feat:16s} {imp:.3f}")

    out = ML_DIR / "models" / "tree.joblib"
    out.parent.mkdir(exist_ok=True)
    joblib.dump({"model": tree, "threshold": t, "features": FEATURE_COLUMNS}, out)
    print(f"\nSaved {out}. Next: python ml/export_tree.py")


if __name__ == "__main__":
    main()
