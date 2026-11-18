#!/usr/bin/env python3
"""Measure visible TUI responses through a private tmux server."""

import argparse
import hashlib
import json
import os
import platform
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from harness_process import PrivateTmux, checkpoint, harness_entry, pause
from tui_sla import IDLE, INPUTS, REPEATS, SOAK, check_host, summary


def process_usage(pid):
    if sys.platform == "linux":
        # procps TIME has only whole-second resolution, too coarse for idle CPU.
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()
        ticks = int(fields[11]) + int(fields[12])  # utime/stime (fields 14/15)
        return ticks / os.sysconf("SC_CLK_TCK"), int(fields[21]) * os.sysconf("SC_PAGE_SIZE") / 2**20
    cpu, rss = subprocess.check_output(["ps", "-o", "time=,rss=", "-p", pid], text=True, timeout=5).split()
    seconds = 0
    for part in cpu.split(":"):
        seconds = seconds * 60 + float(part)
    return seconds, int(rss) / 1024


def bench(binary, rows, trials, idle, starts, trace, soak, fixed=False):
    with tempfile.TemporaryDirectory(prefix="st-bench-") as folder:
        trace_path = Path(folder) / "trace.json"
        command = ["env", f"SLOPPYTOP_TUI_TRACE={trace_path if trace else ''}",
                   "ST_FIXTURE_DISCOVERY_DELAY=350", "ST_VISUAL_HISTORY=0",
                   f"HOME={folder}", f"XDG_CONFIG_HOME={folder}", f"ST_FIXTURE_ROWS={rows or 24}",
                   str(binary), *([] if rows else ["tui"])]

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
            lines = f.splitlines()
            return f.startswith("sloppytop") and len(lines) >= 2 and "PID " in lines[-2]

        def searching(f):
            # The empty editor is "/" after the mode, not the idle "/ search"
            # hint. Other actions can follow it in either toolbar layout.
            return main(f) and bool(re.search(r"\b(?:live|FROZEN)\s+/(?! search)(?:\s|$)", f.splitlines()[-1]))

        def start():
            nonlocal pid
            # Diagnostic startup includes the pane guard, not server creation.
            # Release startup/shrink measurements still use the direct PTY.
            started = time.monotonic()
            pid = tmux.start("bench", 112, 30, command)
            interactive = frame(lambda f: f.startswith("sloppytop") and "q quit" in f, started, "interactive")
            populated = frame(lambda f: main(f) and (not fixed or not rows or f"{rows}/{rows}" in f.splitlines()[-1]),
                              started, "process table")
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
            raise RuntimeError("benchmark pane did not shut down on Ctrl-C")

        with PrivateTmux(folder) as tmux:
            session_start = time.monotonic()
            start()
            live_memory = []
            soak_memory = []
            if soak:
                cpu_before, rss = process_usage(str(pid))
                began = time.monotonic()
                soak_memory.append([0, rss])
                for second in range(1, soak + 1):
                    pause(max(0, began + second - time.monotonic()))
                    cpu, rss = process_usage(str(pid))
                    soak_memory.append([time.monotonic() - began, rss])
                soak_cpu = round(100 * (cpu - cpu_before) / (time.monotonic() - began), 2)
            if fixed:
                # Read a sampling-only trace, without dilution by frozen idle.
                stop()
                padding_seconds = [began - session_start, time.monotonic() - (began + soak_memory[-1][0])]
                soak_trace = json.loads(trace_path.read_text())
                trace_path.unlink()
                start()
            for mode in ("live", "frozen"):
                mode_marker = "live" if mode == "live" else "FROZEN"

                def in_mode(f):
                    return main(f) and mode_marker in f.splitlines()[-1].split()

                for trial in range(trials):
                    # Vary phase relative to the 1 s refresh rather than hitting the
                    # same portion of the collector window on every trial.
                    time.sleep((trial % 7) * .037)
                    measure(f"{mode}_search_ms", lambda: keys("/"), lambda f: in_mode(f) and searching(f))
                    measure(f"{mode}_dismiss_ms", lambda: keys("Escape"),
                            lambda f: in_mode(f) and not searching(f))
                    selected = tmux("capture-pane", "-p", "-t", "bench").splitlines()[-2]
                    measure(f"{mode}_scroll_ms", lambda: keys("Down"),
                            lambda f: in_mode(f) and f.splitlines()[-2] != selected)
                    keys("Home")
                    if rows and not fixed:
                        tree_visible = lambda f: main(f) and "├─" in f
                        measure(f"{mode}_tree_on_ms", lambda: keys("T"), tree_visible)
                        measure(f"{mode}_tree_off_ms", lambda: keys("T"), lambda f: main(f) and not tree_visible(f))
                    if mode == "live" and not fixed:
                        live_memory.append(round(process_usage(str(pid))[1], 1))
                if mode == "live":
                    measure("freeze_ms", lambda: keys("Space"), lambda f: main(f) and "FROZEN" in f.splitlines()[-1])
            cpu_start, _ = process_usage(str(pid))
            idle_start = time.monotonic()
            pause(idle)
            cpu_end, rss = process_usage(str(pid))
            idle_seconds = time.monotonic() - idle_start
            cpu_pct = 100 * (cpu_end - cpu_start) / idle_seconds
            if fixed:
                stop()
                return {"inputs": {key: summary(values) for key, values in samples.items()
                                   if key.startswith(("live_", "frozen_"))},
                        "idle_seconds": idle_seconds, "paused_cpu_pct": cpu_pct, "paused_rss_mib": rss,
                        "soak_rss_mib": soak_memory, "soak_cpu_pct": soak_cpu,
                        "lag": soak_trace.get("loopLag"), "sample_count": soak_trace.get("sample", {}).get("count"),
                        "refresh_ms": 1000, "padding_seconds": padding_seconds}

            for trial in range(min(trials * 2, 20)):
                width, height = (56, 18) if trial % 2 == 0 else (112, 30)
                measure("resize_ms",
                        lambda: tmux("resize-window", "-t", "bench", "-x", str(width), "-y", str(height)),
                        lambda f: main(f) and len(f.splitlines()) == height and "FROZEN" in f)
            measure("resume_ms", lambda: keys("Space"), lambda f: "FROZEN" not in f and main(f))
            measure("discovery_load_ms", lambda: keys("D"), lambda f: "cached peers" in f)
            measure("discovery_dismiss_ms", lambda: keys("Escape"), main)
            measure("discovery_loading_ms", lambda: keys("D"), lambda f: "reading local tables" in f)
            measure("discovery_interrupt_search_ms", lambda: tmux("send-keys", "-t", "bench", "q", "/"),
                    searching)
            stop()
            phases = {"phases_ms": json.loads(trace_path.read_text())} if trace else {}
            for _ in range(starts - 1):
                start()
                stop()
            return {"paused_cpu_pct": round(cpu_pct, 2), "paused_rss_mib": round(rss, 1),
                    "live_rss_mib": live_memory, **phases,
                    **({"soak_cpu_pct": soak_cpu, "soak_rss_mib": soak_memory} if soak else {}),
                    **{key: summary(values) for key, values in samples.items()}}


def smoke_output(command, env, timeout):
    # The nested harness has its own PTY to tear down; give it the same
    # cooperative shutdown on an outer timeout as on operator interruption.
    child = subprocess.Popen(command, env=env, stdout=subprocess.PIPE)
    try:
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            checkpoint()
            try:
                stdout, _ = child.communicate(timeout=.2)
            except subprocess.TimeoutExpired:
                continue
            if child.returncode:
                raise subprocess.CalledProcessError(child.returncode, command)
            return stdout
        raise subprocess.TimeoutExpired(command, timeout)
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=2)
        child.stdout.close()


def direct_repeats(binary, rows):
    command = [sys.executable, str(Path(__file__).with_name("smoke-tui.py")), str(binary), "--timings-json"]
    env = {**os.environ, "ST_FIXTURE_ROWS": str(rows or 24), "ST_VISUAL_HISTORY": "0", "SLOPPYTOP_TUI_TRACE": ""}
    runs = [json.loads(smoke_output(command, env=env, timeout=30)) for _ in range(REPEATS + 1)]
    # Only same-file repeat launches are in scope. Preserve the excluded launch.
    return {"warmup": runs[0], "direct_pty": {k: summary([run[k] for run in runs[1:]]) for k in runs[0]}}


def fixed_host(live, fixture, host):
    system = platform.system()
    if host != platform.node() or system not in ("Darwin", "Linux"):
        raise ValueError("run on the booked Darwin/Linux host (exact hostname required)")
    root = Path(__file__).resolve().parents[1]
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=root, timeout=10).strip():
        raise ValueError("build and run the release protocol from a clean candidate checkout")
    report = {"system": system, "host": host, "platform": platform.platform(),
              "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True, timeout=10).strip(),
              "tmux": subprocess.check_output(["tmux", "-V"], text=True, timeout=10).strip(),
              "bun": subprocess.check_output(["bun", "--version"], text=True, timeout=10).strip(), "workloads": {}}
    for rows, binary in [(None, live), (5000, fixture)]:
        row = report["workloads"][str(rows or "live")] = {}
        try:
            binary = binary.resolve(strict=True)
            digest = hashlib.sha256()
            with binary.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1 << 20), b""):
                    digest.update(chunk)
            row["sha256"] = digest.hexdigest()
            row.update(direct_repeats(binary, rows))
            row.update(bench(binary, rows, INPUTS, IDLE, 1, True, SOAK, fixed=True))
        except (OSError, RuntimeError, ValueError, KeyError, subprocess.SubprocessError) as err:
            # Keep completed evidence; never serialize tmux stdout or live rows.
            print(f"{rows or 'live'} collection stopped: {type(err).__name__}: {err}", file=sys.stderr)
            break
    result = check_host(report, system, host, report["revision"])
    print(json.dumps({**report, "assessment": result}, allow_nan=False), flush=True)
    return int(bool(result["problems"]))


if __name__ == "__main__":
    harness_entry()
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("live", type=Path)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--idle", type=float, default=5)
    parser.add_argument("--starts", type=int, default=8)
    parser.add_argument("--trace", action="store_true", help="include application phase timings")
    parser.add_argument("--soak", type=int, default=0, help="seconds of live CPU/RSS observation per workload")
    parser.add_argument("--workload", choices=("all", "live", "100", "1000", "5000"), default="all")
    parser.add_argument("--fixed-host", metavar="HOST", help="run the serial release protocol; emit one host JSON report")
    args = parser.parse_args()
    if args.fixed_host is not None:
        if any(arg.startswith(("--trials", "--idle", "--starts", "--trace", "--soak", "--workload")) for arg in sys.argv):
            parser.error("diagnostic tuning flags cannot change the fixed-host release protocol")
        sys.exit(fixed_host(args.live, args.fixture, args.fixed_host))
    if args.trials < 1 or args.idle <= 0 or args.starts < 1 or args.soak < 0:
        parser.error("trials, idle and starts must be positive; soak cannot be negative")
    for rows in (None, 100, 1_000, 5_000):
        if args.workload not in ("all", str(rows) if rows else "live"):
            continue
        binary = args.fixture if rows else args.live
        print(json.dumps({"mode": "fixture" if rows else "live", "rows": rows,
                          **bench(binary.resolve(strict=True), rows, args.trials, args.idle, args.starts,
                                  args.trace, args.soak)}), flush=True)
