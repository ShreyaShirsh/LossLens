"""LossLens presentation app: a local web server (Python standard library only).

    python app/server.py            # opens http://127.0.0.1:8765 in your browser
    python app/server.py --no-browser --port 8800

Serves the UI from app/static, the baked results from app/data, and runs live
simulations through WSL (POST /api/run, GET /api/job?id=...).
"""
import argparse
import json
import mimetypes
import shutil
import socket
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import simrunner  # noqa: E402

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA = ROOT / "data"
WORK = simrunner.REPO / "results" / "app_runs" / "live"

# name -> (min, max, default); everything the UI can send to the simulator
LIMITS = {"bw": (10, 500), "rtt": (10, 300), "loss": (0, 0.1), "cross": (0, 0.7),
          "buffer": (0.25, 4), "seed": (1, 2**31 - 1), "duration": (5, 30)}

STATE = {"binary": None, "checked": False}
JOBS = {}


def check_wsl():
    STATE["binary"] = simrunner.find_binary()
    STATE["checked"] = True


def parse_params(body: dict) -> dict:
    params = {}
    for key, (lo, hi) in LIMITS.items():
        value = float(body[key])
        if not lo <= value <= hi:
            raise ValueError(f"{key} must be between {lo} and {hi}")
        params[key] = int(value) if key in ("seed", "duration") else round(value, 4)
    params["oracle"] = bool(body.get("oracle", False))
    return params


class Handler(BaseHTTPRequestHandler):
    server_version = "LossLens"

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def _send(self, code, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _file(self, path: Path):
        if not path.is_file():
            self._send(404, {"error": "not found"})
            return
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self._send(200, path.read_bytes(), ctype)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/health":
            self._send(200, {"wsl": bool(STATE["binary"]), "checked": STATE["checked"],
                             "binary": STATE["binary"] or ""})
        elif url.path == "/api/job":
            job = JOBS.get(parse_qs(url.query).get("id", [""])[0])
            self._send(200 if job else 404, job.snapshot() if job else {"error": "unknown job"})
        elif url.path.startswith("/data/"):
            self._file(DATA / Path(url.path[6:]).name)
        else:
            rel = "index.html" if url.path in ("/", "") else url.path.lstrip("/")
            target = (STATIC / rel).resolve()
            if STATIC.resolve() not in target.parents and target != STATIC.resolve():
                self._send(403, {"error": "forbidden"})
                return
            self._file(target)

    def do_POST(self):
        if urlparse(self.path).path != "/api/run":
            self._send(404, {"error": "not found"})
            return
        if not STATE["binary"]:
            self._send(503, {"error": "The simulator is not available (WSL/ns-3 not found). "
                                      "Use a pre-run network instead."})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            params = parse_params(json.loads(self.rfile.read(length) or b"{}"))
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._send(400, {"error": f"bad parameters: {exc}"})
            return
        job_id = uuid.uuid4().hex[:10]
        JOBS[job_id] = simrunner.Job(job_id, STATE["binary"], params, WORK)
        self._send(200, {"id": job_id})


def free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit("No free port found")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    if not (DATA / "results.json").exists():
        raise SystemExit("app/data/results.json is missing: run  python app/build_data.py")
    shutil.rmtree(WORK.parent, ignore_errors=True)  # old live runs
    threading.Thread(target=check_wsl, daemon=True).start()

    port = free_port(args.port)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"LossLens is running at {url}   (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


if __name__ == "__main__":
    main()
