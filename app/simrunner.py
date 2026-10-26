"""Run LossLens simulations through WSL and load their results (stdlib + csv only).

Used by the web app (server.py) and by make_demo_cache.py.
"""
import csv
import shlex
import subprocess
import threading
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NS3_DIR = "~/ns-3"
CLASSIFIERS = ("cubic", "tree", "oracle")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def wsl_path(path: Path) -> str:
    """D:\\a\\b -> /mnt/d/a/b"""
    p = Path(path).resolve()
    drive = p.drive.rstrip(":").lower()
    return "/mnt/" + drive + "/" + "/".join(p.parts[1:])


def wsl(command: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(["wsl.exe", "-e", "bash", "-lc", command], capture_output=True,
                          text=True, creationflags=NO_WINDOW, **kwargs)


def find_binary() -> str:
    """Path of the newest simulator binary inside WSL, or '' if WSL/ns-3 is unavailable."""
    try:
        out = wsl(f"ls -t {NS3_DIR}/build/scratch/loss-diff/*loss-diff-sim* 2>/dev/null | head -1",
                  timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return out.stdout.strip().replace("\x00", "")


def start(binary: str, params: dict, out_dir: Path, classifiers=CLASSIFIERS):
    """Start one simulation per classifier, in parallel. Returns {classifier: Popen}."""
    procs = {}
    for cls in classifiers:
        d = out_dir / cls
        d.mkdir(parents=True, exist_ok=True)
        args = (f"--classifier={cls} --bw={params['bw']} --rtt={params['rtt']} "
                f"--loss={params['loss']} --crossLoad={params['cross']} --buffer={params['buffer']} "
                f"--seed={params['seed']} --duration={params['duration']} --traceTs=1 "
                f"--outDir={shlex.quote(wsl_path(d))}")
        cmd = f"cd {NS3_DIR} && {binary} {args}"
        procs[cls] = subprocess.Popen(["wsl.exe", "-e", "bash", "-lc", cmd],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                      creationflags=NO_WINDOW)
    return procs


def _read_csv(path: Path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def load_result(out_dir: Path, cls: str, bw: float, step: int = 5) -> dict:
    """Summary + downsampled time series + loss events of one finished run."""
    d = out_dir / cls
    summary_file = next(d.glob("summary_*.csv"))
    s = _read_csv(summary_file)[0]
    ts_rows = _read_csv(next(d.glob("ts_*.csv")))
    series = []
    for i, r in enumerate(ts_rows):
        if i % step:
            continue
        rtt = float(r["rtt_ms"])
        if rtt <= 0:
            continue
        cwnd = float(r["cwnd_bytes"])
        rate = min(cwnd * 8 / (rtt / 1000) / 1e6, 1.5 * bw)
        series.append([round(float(r["time"]), 2), round(rate, 2), round(cwnd / 1448, 1),
                       round(rtt, 1)])
    events = []
    feat = next(d.glob("features_*.csv"), None)
    if feat:
        for r in _read_csv(feat):
            events.append([round(float(r["time"]), 2), int(r["label"]), int(r["predicted"])])
    return {
        "classifier": cls,
        "goodput": round(float(s["goodput_mbps"]), 2),
        "rtt_mean": round(float(s["mean_rtt_ms"]), 1),
        "loss_events": int(s["loss_events"]),
        "cong_drops": int(s["cong_drops"]),
        "rand_drops": int(s["rand_drops"]),
        "series": series,
        "events": events,
    }


class Job:
    """A background simulation job (three parallel runs) with status for polling."""

    def __init__(self, job_id: str, binary: str, params: dict, work_dir: Path):
        self.id = job_id
        self.params = params
        self.dir = work_dir / job_id
        self.status = "running"
        self.error = ""
        self.done = {}
        self.result = None
        self._binary = binary
        self.classifiers = CLASSIFIERS if params.get("oracle") else ("cubic", "tree")
        self._lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            procs = start(self._binary, self.params, self.dir, self.classifiers)
            pending = dict(procs)
            while pending:
                for cls, p in list(pending.items()):
                    try:
                        p.wait(timeout=0.3)
                    except subprocess.TimeoutExpired:
                        continue
                    if p.returncode != 0:
                        raise RuntimeError(f"{cls} simulation failed: {p.stderr.read()[-300:]}")
                    with self._lock:
                        self.done[cls] = True
                    del pending[cls]
            bw = float(self.params["bw"])
            self.result = {c: load_result(self.dir, c, bw) for c in self.classifiers}
            self.status = "done"
        except Exception as exc:  # report to the UI instead of dying silently
            self.error = str(exc)
            self.status = "error"

    def snapshot(self) -> dict:
        with self._lock:
            return {"id": self.id, "status": self.status, "error": self.error,
                    "done": list(self.done), "params": self.params, "result": self.result}
