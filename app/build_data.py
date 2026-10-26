"""Bake the project's results into app/data/*.json so the UI works without the raw data.

    python app/build_data.py

Reads results/summary_*.csv (evaluation), data/features_*.csv (training data) and
ml/models/tree.joblib, retrains the forest and MLP for the model comparison, and writes
app/data/results.json and app/data/model.json.
"""
import glob
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

REPO = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "data"
sys.path.insert(0, str(REPO / "ml"))
from features import FEATURE_COLUMNS as FEATURES  # noqa: E402

NAMES = {"TcpNewReno": "NewReno", "TcpCubic": "CUBIC", "TcpWestwoodPlus": "Westwood+",
         "TcpVeno": "Veno", "TcpBbr": "BBR"}


def algo_name(row) -> str:
    if row.meta_tcp == "TcpLossAware":
        return "LossLens" if row.meta_classifier == "tree" else "LossLens (oracle)"
    return NAMES[row.meta_tcp]


def r(x, n=3):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def evaluation_results() -> dict:
    df = pd.concat((pd.read_csv(f) for f in glob.glob(str(REPO / "results" / "summary_*.csv"))),
                   ignore_index=True)
    df["meta_classifier"] = df["meta_classifier"].fillna("")
    df["algo"] = df.apply(algo_name, axis=1)

    speed = df[(df.meta_cross_tcp == 0) & (df.meta_flows == 1)]
    g = (speed.groupby(["algo", "meta_rtt_ms", "meta_rand_loss"])
         .agg(mean=("goodput_mbps", "mean"), std=("goodput_mbps", "std"),
              rtt=("mean_rtt_ms", "mean"), n=("goodput_mbps", "size")).reset_index())
    speed_rows = [dict(algo=x.algo, rtt=r(x.meta_rtt_ms, 0), loss=r(x.meta_rand_loss, 4),
                       mean=r(x["mean"], 2), std=r(x["std"] if x["n"] > 1 else 0, 2),
                       delay=r(x.rtt, 1), n=int(x.n)) for _, x in g.iterrows()]

    fair = df[df.meta_cross_tcp > 0].copy()
    n = fair.meta_cross_tcp
    fair["share"] = fair.goodput_mbps / ((fair.goodput_mbps + n * fair.cross_tcp_mbps) / (n + 1))
    f = (fair.groupby(["algo", "meta_rand_loss", "meta_cross_tcp", "meta_buffer_bdp"])
         .agg(share=("share", "mean"), std=("share", "std"), goodput=("goodput_mbps", "mean"),
              cross=("cross_tcp_mbps", "mean")).reset_index())
    fair_rows = [dict(algo=x.algo, loss=r(x.meta_rand_loss, 4), competitors=int(x.meta_cross_tcp),
                      buffer=r(x.meta_buffer_bdp, 2), share=r(x.share, 3), std=r(x["std"], 3),
                      goodput=r(x.goodput, 2), cross=r(x.cross, 2)) for _, x in f.iterrows()]
    return {"speed": speed_rows, "fairness": fair_rows, "runs": int(len(df))}


def loc_counts() -> dict:
    out = {}
    for label, exts, dirs in [("C++", {".cc", ".h"}, ["common", "sim", "tcp"]),
                              ("Python", {".py"}, ["ml", "sim", "eval", "app"]),
                              ("Scripts", {".sh"}, ["scripts"])]:
        total = 0
        for d in dirs:
            for p in (REPO / d).rglob("*"):
                if p.suffix in exts and p.name != "generated-tree.cc" and "__pycache__" not in str(p):
                    total += sum(1 for _ in open(p, encoding="utf-8", errors="ignore"))
        out[label] = total
    return out


def tree_json(model, thr: float) -> dict:
    t = model.tree_
    cong = list(model.classes_).index(1)

    def node(i):
        counts = t.value[i][0]
        p = float(counts[cong] / counts.sum())
        if t.children_left[i] == -1:
            return {"leaf": True, "p": round(p, 3), "n": int(t.n_node_samples[i]),
                    "verdict": "congestion" if p >= thr else "random"}
        return {"leaf": False, "f": FEATURES[t.feature[i]], "t": round(float(t.threshold[i]), 5),
                "n": int(t.n_node_samples[i]), "p": round(p, 3),
                "l": node(t.children_left[i]), "r": node(t.children_right[i])}
    return node(0)


def threshold_for_recall(y, p, target):
    for th in np.linspace(0.95, 0.05, 91):
        if ((p >= th) & (y == 1)).sum() / max((y == 1).sum(), 1) >= target:
            return float(th)
    return 0.05


def model_data() -> dict:
    files = [f for f in glob.glob(str(REPO / "data" / "features_*.csv"))
             if Path(f.replace("features_", "summary_")).exists()]
    df = pd.concat((pd.read_csv(f) for f in files), ignore_index=True)
    total_events = len(df)
    df = df[(df.label >= 0) & (df.is_rto == 0)]

    sp = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=0)
    rest_i, test_i = next(sp.split(df, groups=df.meta_run_tag))
    rest, test = df.iloc[rest_i], df.iloc[test_i]
    tr_i, va_i = next(sp.split(rest, groups=rest.meta_run_tag))
    train, val = rest.iloc[tr_i], rest.iloc[va_i]

    saved = joblib.load(REPO / "ml" / "models" / "tree.joblib")
    tree, thr = saved["model"], saved["threshold"]
    cong = list(tree.classes_).index(1)
    p_test = tree.predict_proba(test[FEATURES])[:, cong]
    pred = (p_test >= thr).astype(int)
    y = test.label.values
    tp, fn = int(((pred == 1) & (y == 1)).sum()), int(((pred == 0) & (y == 1)).sum())
    fp, tn = int(((pred == 1) & (y == 0)).sum()), int(((pred == 0) & (y == 0)).sum())

    models = {
        "Decision tree": DecisionTreeClassifier(max_depth=6, min_samples_leaf=20,
                                                class_weight="balanced", random_state=0),
        "Random forest": RandomForestClassifier(n_estimators=200, min_samples_leaf=5,
                                                class_weight="balanced", n_jobs=-1, random_state=0),
        "Neural network": make_pipeline(StandardScaler(), MLPClassifier(
            hidden_layer_sizes=(32, 16), max_iter=500, random_state=0)),
    }
    comparison = []
    for name, m in models.items():
        m.fit(train[FEATURES], train.label)
        col = list(m.classes_).index(1)
        th = threshold_for_recall(val.label.values, m.predict_proba(val[FEATURES])[:, col], 0.90)
        pr = (m.predict_proba(test[FEATURES])[:, col] >= th).astype(int)
        comparison.append({"model": name,
                           "caught": r(((pr == 1) & (y == 1)).sum() / (y == 1).sum(), 4),
                           "ignored": r(((pr == 0) & (y == 0)).sum() / (y == 0).sum(), 4),
                           "accuracy": r((pr == y).mean(), 4)})

    # Per-feature distributions by class, for the "clues" cards.
    clues = {}
    for f in FEATURES:
        lo, hi = np.percentile(df[f], [1, 99])
        if hi <= lo:
            hi = lo + 1e-6
        edges = np.linspace(lo, hi, 31)
        hist = {}
        for lab, key in [(1, "congestion"), (0, "random")]:
            vals = df.loc[df.label == lab, f].clip(lo, hi)
            h, _ = np.histogram(vals, bins=edges)
            hist[key] = [r(x, 4) for x in h / max(h.sum(), 1)]
        clues[f] = {"lo": r(lo, 5), "hi": r(hi, 5), "hist": hist,
                    "median_congestion": r(df.loc[df.label == 1, f].median(), 4),
                    "median_random": r(df.loc[df.label == 0, f].median(), 4)}

    rng = np.random.default_rng(0)
    sample = df.sample(1600, random_state=0)
    scatter = [[r(a, 3), r(b, 3), int(c)] for a, b, c in zip(
        sample.srtt_ratio.clip(*np.percentile(df.srtt_ratio, [1, 99])),
        sample.cwnd_bdp_ratio.clip(*np.percentile(df.cwnd_bdp_ratio, [1, 99])), sample.label)]

    # Real example events to preload into the "try the detective" sliders.
    examples = {}
    for lab, key in [(1, "congestion"), (0, "random")]:
        pool = test[(test.label == lab) & (np.abs(p_test - (0.97 if lab else 0.03)) < 0.2)]
        rows = (pool if len(pool) else test[test.label == lab]).sample(6, random_state=1)
        examples[key] = [{f: r(row[f], 5) for f in FEATURES} for _, row in rows.iterrows()]

    by_loss = (df.groupby(["meta_rand_loss", "label"]).size().unstack(fill_value=0)
               .reset_index().to_dict("records"))
    return {
        "dataset": {"runs": len(files), "events": int(total_events), "usable": int(len(df)),
                    "congestion": int((df.label == 1).sum()), "random": int((df.label == 0).sum()),
                    "unknown": 0, "by_loss": [{"loss": r(x["meta_rand_loss"], 4),
                                               "random": int(x.get(0, 0)),
                                               "congestion": int(x.get(1, 0))} for x in by_loss]},
        "split": {"train": int(train.meta_run_tag.nunique()), "val": int(val.meta_run_tag.nunique()),
                  "test": int(test.meta_run_tag.nunique()), "test_events": int(len(test))},
        "threshold": r(thr, 3),
        "confusion": {"tp": tp, "fn": fn, "fp": fp, "tn": tn,
                      "caught": r(tp / (tp + fn), 4), "ignored": r(tn / (tn + fp), 4),
                      "accuracy": r((tp + tn) / len(y), 4)},
        "comparison": comparison,
        "importance": sorted(({"feature": f, "value": r(v, 4)}
                              for f, v in zip(FEATURES, tree.feature_importances_)),
                             key=lambda d: -d["value"]),
        "clues": clues,
        "scatter": scatter,
        "examples": examples,
        "tree": tree_json(tree, thr),
        "depth": int(tree.get_depth()), "leaves": int(tree.get_n_leaves()),
    }


def main():
    OUT.mkdir(exist_ok=True)
    results = evaluation_results()
    results["loc"] = loc_counts()
    (OUT / "results.json").write_text(json.dumps(results, separators=(",", ":")), encoding="utf-8")
    model = model_data()
    (OUT / "model.json").write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    print(f"results.json: {results['runs']} runs; model.json: {model['dataset']['usable']} events, "
          f"tree depth {model['depth']}, {model['leaves']} leaves")
    print("confusion:", model["confusion"])
    for m in model["comparison"]:
        print(" ", m)
    print("loc:", results["loc"])


if __name__ == "__main__":
    main()
