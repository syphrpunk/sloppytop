#!/usr/bin/env python3
"""Measure visible TUI responses through a private tmux server."""

import argparse
import json
import math
import os
from pathlib import Path
import shlex
import signal
import subprocess
import tempfile
import time


def summary(values):
    ordered = sorted(values)
    percentile = lambda q: round(ordered[math.ceil(len(ordered) * q) - 1], 1)
    return {"n": len(values), "p50": percentile(.50), "p95": percentile(.95), "max": percentile(1)}


def process_usage(pid):
    cpu, rss = subprocess.check_output(["ps", "-o", "time=,rss=", "-p", pid], text=True).split()
    seconds = 0
    for part in cpu.split(":"):
        seconds = seconds * 60 + float(part)
    return seconds, int(rss) / 1024


def bench(binary, rows, trials, idle, starts, trace):
    with tempfile.TemporaryDirectory(prefix="st-bench-") as folder:
        trace_path = Path(folder) / "trace.json"
        command = shlex.join(["env", f"SLOPPYTOP_TUI_TRACE={trace_path if trace else ''}",
                              f"XDG_CONFIG_HOME={folder}", f"ST_FIXTURE_ROWS={rows or 24}",
                              str(binary), *([] if rows else ["tui"])])
        base = ["tmux", "-S", f"{folder}/tmux.sock", "-f", "/dev/null"]

        def tmux(*args, check=True):
            return subprocess.run([*base, *args], capture_output=True, text=True,
                                  check=check, timeout=10).stdout

        def frame(predicate, started, label):
            deadline = started + 15
            while time.monotonic() < deadline:
                if predicate(tmux("capture-pane", "-p", "-t", "bench")):
                    return (time.monotonic() - started) * 1000
                time.sleep(.005)
            # Do not include a live frame (which can contain process commands).
            raise RuntimeError(f"timed out waiting for {label}")

        def keys(name):
            tmux("send-keys", "-t", "bench", name)

        samples = {}
        pid = None

        def measure(label, action, predicate):
            started = time.monotonic()
            action()
            samples.setdefault(label, []).append(frame(predicate, started, label))

        def main(f):
            return "PID" in f and "PID " in f.splitlines()[-2] and f.startswith("sloppytop")

        def start():
            nonlocal pid
            started = time.monotonic()
            pid = int(tmux("new-session", "-d", "-s", "bench", "-x", "112", "-y", "30",
                           "-P", "-F", "#{pane_pid}", f"exec {command}"))
            interactive = frame(lambda f: f.startswith("sloppytop") and "q quit" in f, started, "interactive")
            populated = frame(main, started, "process table")
            samples.setdefault("startup_interactive_ms", []).append(interactive)
            samples.setdefault("startup_populated_ms", []).append(populated)

        def stop():
            nonlocal pid
            if pid is None:
                return
            tmux("send-keys", "-t", "bench", "C-c", check=False)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if not tmux("list-panes", "-t", "bench", "-F", "#{pane_pid}", check=False):
                    pid = None
                    return
                time.sleep(.025)
            # HUP alone can leave a detached native renderer consuming CPU.
            if tmux("display-message", "-p", "-t", "bench", "#{pane_pid}", check=False).strip() == str(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            pid = None
            tmux("kill-server", check=False)
            raise RuntimeError("benchmark pane did not shut down on Ctrl-C")

        try:
            start()
            live_memory = []
            for mode in ("live", "frozen"):
                for trial in range(trials):
                    # Vary phase relative to the 1 s refresh rather than hitting the
                    # same portion of the collector window on every trial.
                    time.sleep((trial % 7) * .037)
                    measure(f"{mode}_search_ms", lambda: keys("/"),
                            lambda f: main(f) and "/" in f.splitlines()[-1].split("q quit")[0].split()[-1:])
                    measure(f"{mode}_dismiss_ms", lambda: keys("Escape"),
                            lambda f: main(f) and not f.splitlines()[-1].split("q quit")[0].rstrip().endswith("/"))
                    selected = tmux("capture-pane", "-p", "-t", "bench").splitlines()[-2]
                    measure(f"{mode}_scroll_ms", lambda: keys("Down"),
                            lambda f: main(f) and f.splitlines()[-2] != selected)
                    keys("Home")
                    if mode == "live":
                        live_memory.append(round(process_usage(str(pid))[1], 1))
                if mode == "live":
                    measure("freeze_ms", lambda: keys("Space"), lambda f: "FROZEN" in f)
            cpu_start, _ = process_usage(str(pid))
            idle_start = time.monotonic()
            time.sleep(idle)
            cpu_end, rss = process_usage(str(pid))
            cpu_pct = 100 * (cpu_end - cpu_start) / (time.monotonic() - idle_start)
            for trial in range(min(trials * 2, 20)):
                width, height = (56, 18) if trial % 2 == 0 else (112, 30)
                measure("resize_ms",
                        lambda: tmux("resize-window", "-t", "bench", "-x", str(width), "-y", str(height)),
                        lambda f: main(f) and len(f.splitlines()) == height and "FROZEN" in f)
            measure("resume_ms", lambda: keys("Space"), lambda f: "FROZEN" not in f and main(f))
            measure("discovery_load_ms", lambda: keys("D"), lambda f: "cached peers" in f)
            measure("discovery_dismiss_ms", lambda: keys("Escape"), main)
            stop()
            phases = {"phases_ms": json.loads(trace_path.read_text())} if trace else {}
            for _ in range(starts - 1):
                start()
                stop()
            return {"paused_cpu_pct": round(cpu_pct, 2), "paused_rss_mib": round(rss, 1),
                    "live_rss_mib": live_memory, **phases, **{key: summary(values) for key, values in samples.items()}}
        finally:
            try:
                stop()
            finally:
                tmux("kill-server", check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("live", type=Path)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--idle", type=float, default=5)
    parser.add_argument("--starts", type=int, default=8)
    parser.add_argument("--trace", action="store_true", help="include application phase timings")
    args = parser.parse_args()
    if args.trials < 1 or args.idle <= 0 or args.starts < 1:
        parser.error("trials, idle and starts must be positive")
    for rows in (None, 100, 1_000, 5_000):
        binary = args.fixture if rows else args.live
        print(json.dumps({"mode": "fixture" if rows else "live", "rows": rows,
                          **bench(binary.resolve(strict=True), rows, args.trials, args.idle, args.starts, args.trace)}), flush=True)
