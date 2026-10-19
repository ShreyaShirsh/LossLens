"""Column names shared with the simulator (see docs/interfaces.md).

FEATURE_COLUMNS must match LossFeatures::CsvHeader() in common/loss-features.cc
and the field names of the LossFeatures struct, because export_tree.py
writes C++ like `f.srtt_ratio <= 1.25`.
"""

FEATURE_COLUMNS = [
    "srtt_ratio",
    "rtt_gradient",
    "rtt_var",
    "ack_jitter",
    "cwnd_bdp_ratio",
    "time_since_loss",
    "loss_rate",
]

LABEL_COLUMN = "label"          # 1 = congestion, 0 = random, -1 = unknown (dropped)
GROUP_COLUMN = "meta_run_tag"   # split train/test by run, never inside one run
CONGESTION = 1
