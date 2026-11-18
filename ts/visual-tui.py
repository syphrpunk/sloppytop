#!/usr/bin/env python3
"""Capture OpenTUI through tmux's terminal emulator, using synthetic data only."""

import argparse
import difflib
import hashlib
import html
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import time
import unicodedata


SGR = re.compile(r"\x1b\[([0-9;]*)m")
CELL_W, CELL_H = 9, 18
DEFAULT_FG, DEFAULT_BG = "#cdd6f4", "#1e1e2e"
PALETTE = ["#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
           "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff"]


def color(value):
    if value < 16:
        return PALETTE[value]
    if value >= 232:
        return "#%02x%02x%02x" % ((8 + (value - 232) * 10,) * 3)
    cube = [0, 95, 135, 175, 215, 255]
    n = value - 16
    return "#%02x%02x%02x" % (cube[n // 36], cube[n // 6 % 6], cube[n % 6])


def svg(ansi, width, height):
    w, h = width * CELL_W + 20, height * CELL_H + 20
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">',
           f'<rect width="100%" height="100%" fill="{DEFAULT_BG}"/>',
           '<g font-family="Menlo, DejaVu Sans Mono, monospace" font-size="14" xml:space="preserve">']
    fg, bg, bold, reverse = DEFAULT_FG, DEFAULT_BG, False, False
    for row, line in enumerate(ansi.split("\n")[:height]):
        x, y = 10, 10 + row * CELL_H
        for index, chunk in enumerate(SGR.split(line)):
            if index % 2:
                values = iter(int(part or 0) for part in chunk.split(";"))
                for code in values:
                    if code == 0:
                        fg, bg, bold, reverse = DEFAULT_FG, DEFAULT_BG, False, False
                    elif code in (1, 22):
                        bold = code == 1
                    elif code in (7, 27):
                        reverse = code == 7
                    elif code in (39, 49):
                        if code == 39:
                            fg = DEFAULT_FG
                        else:
                            bg = DEFAULT_BG
                    elif code in (38, 48):
                        mode = next(values, 0)
                        rgb = "#%02x%02x%02x" % tuple(next(values, 0) for _ in range(3)) if mode == 2 else color(next(values, 0))
                        if code == 38:
                            fg = rgb
                        else:
                            bg = rgb
                    elif 30 <= code <= 37 or 90 <= code <= 97:
                        fg = color(code - 30 if code < 90 else code - 82)
                    elif 40 <= code <= 47 or 100 <= code <= 107:
                        bg = color(code - 40 if code < 100 else code - 92)
                continue
            cells = sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in chunk)
            text, fill = (bg, fg) if reverse else (fg, bg)
            if cells and fill != DEFAULT_BG:
                out.append(f'<rect x="{x}" y="{y}" width="{cells * CELL_W}" height="{CELL_H}" fill="{fill}"/>')
            if chunk.strip():
                weight = "bold" if bold else "normal"
                out.append(f'<text x="{x}" y="{y + 14}" fill="{text}" font-weight="{weight}">{html.escape(chunk)}</text>')
            x += cells * CELL_W
    return "\n".join([*out, "</g></svg>"])


def run(fixture, output, review_only=False):
    output.mkdir(parents=True, exist_ok=True)
    style_baselines = {
        "01-wide": "1e99e3bfff23def73010d6cf7a965f8ae07394dda00a4a8a566b4ecb864695b7",
        "02-narrow": "b9384ebaae3724131e44abf007240fc674974aef6e958490f526912ef4939475",
        "04b-neighbors-bottom": "b6de05e3450d43b04b9d806ba463b518622174194dd83af0830e9ca351d621ab",
        "19-columns": "35207b7faf7de99beaee036f1dcb3fbca371a31a3b966e27a9d93622660e5084",
    }
    with tempfile.TemporaryDirectory(prefix="st-visual-") as folder:
        command = (f"exec env ST_VISUAL_HISTORY=1 ST_FIXTURE_DISCOVERY_DELAY=350 "
                   f"XDG_CONFIG_HOME={shlex.quote(folder)} {shlex.quote(str(fixture))}")
        base = ["tmux", "-S", f"{folder}/tmux.sock", "-f", "/dev/null"]

        def tmux(*args, check=True):
            return subprocess.run([*base, *args], check=check, text=True, capture_output=True, timeout=10).stdout

        def capture(label, expected, width, height, *, compare=False, timeout=8):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                plain = tmux("capture-pane", "-p", "-t", "visual")
                if all(token in plain for token in expected):
                    ansi = tmux("capture-pane", "-peN", "-t", "visual")
                    (output / f"{label}.txt").write_text(plain)
                    styled = svg(ansi, width, height)
                    (output / f"{label}.svg").write_text(styled, encoding="utf-8")
                    converter = shutil.which("rsvg-convert")
                    if converter:
                        subprocess.run([converter, str(output / f"{label}.svg"), "-o", str(output / f"{label}.png")], check=True, timeout=10)
                    baseline = Path(__file__).with_name("tui-baselines") / f"{label}.txt"
                    if compare and not review_only:
                        expected_frame = baseline.read_text(encoding="utf-8")
                        actual_frame = re.sub(r"(?m)(^│ disk  .+ · latest )\d+[sm]( ago) *│$",
                                              lambda m: (m[1] + "<age>" + m[2]).ljust(width - 1) + "│", plain)
                        if label.startswith("17"):
                            actual_frame = re.sub(r"(?m)^│ (\d{4}-\d\d-\d\dT[\d:.]+Z)( +)│$",
                                                  lambda m: "│ " + "<sample time>".ljust(len(m[1]) + len(m[2])) + "│",
                                                  actual_frame).rstrip() + "\n"
                        if actual_frame != expected_frame:
                            diff = difflib.unified_diff(expected_frame.splitlines(True), actual_frame.splitlines(True),
                                                        fromfile=str(baseline), tofile=str(output / f"{label}.txt"))
                            raise RuntimeError("terminal frame changed:\n" + "".join(diff))
                    if label in style_baselines and not review_only:
                        digest = hashlib.sha256(styled.encode()).hexdigest()
                        if digest != style_baselines[label]:
                            raise RuntimeError(f"{label}: styled frame changed ({digest}); review {output / (label + '.svg')}")
                    return
                time.sleep(.06)
            raise RuntimeError(f"{label}: expected {expected!r}\n{plain}")

        pid = None
        try:
            pid = int(tmux("new-session", "-d", "-s", "visual", "-x", "112", "-y", "30",
                           "-P", "-F", "#{pane_pid}", command))
            capture("01-wide", ["PID", "fixture-worker"], 112, 30, timeout=20)
            tmux("resize-window", "-t", "visual", "-x", "56", "-y", "18")
            capture("02-narrow", ["sloppytop", "system", "PID", "Memory", "CPU%", "fixture-worker", "450M", "100.0", "D discover",
                                  "界-fixture", "440M    97.0"], 56, 18)
            tmux("send-keys", "-t", "visual", "D")
            capture("02b-discovery-loading", ["reading local tables…", "q close"], 56, 18)
            tmux("send-keys", "-t", "visual", "q")
            capture("02c-discovery-dismissed", ["q quit", "fixture-worker"], 56, 18)
            tmux("send-keys", "-t", "visual", "D")
            capture("03-discovery-coverage", ["TCP listens: unknown", "UDP bound: unknown",
                                              "cached peers (partial)", "denied", "q close"], 56, 18)
            for index, tab in enumerate(("interfaces", "routes", "neighbors"), 2):
                tmux("send-keys", "-t", "visual", "Right")
                capture(f"03-{tab}", [f"{tab} {index}/7 ·", "q close"], 56, 18)
            capture("04-neighbors", ["ARP cache: partial", "fe80::1%eth0"], 56, 18)
            # SGR wheel down delivered to the screen's PTY, not tmux's copy mode.
            tmux("send-keys", "-t", "visual", "-l", "\x1b[<65;9;7M" * 24)
            capture("04b-neighbors-bottom", ["fe80::14%eth0", "q close"], 56, 18, compare=True)
            tmux("send-keys", "-t", "visual", "Up")
            capture("04c-neighbors-up", ["fe80::7%eth0", "q close"], 56, 18)
            tmux("send-keys", "-t", "visual", "r")
            capture("05-refreshed", ["refreshed", "fe80::1%eth0"], 56, 18)
            tmux("send-keys", "-t", "visual", "Right")
            capture("05a-listeners", ["listeners 5/7 ·", "q close"], 56, 18)
            tmux("send-keys", "-t", "visual", "Right")
            capture("05b-connections", ["connections 6/7 ·", "[::1]:8080 PID 200", "rx 0 B/s · tx —"], 56, 18)
            tmux("send-keys", "-t", "visual", "Right")
            capture("05c-dns", ["dns 7/7 ·", "server 192.0.2.53", "search fixture.test"], 56, 18)
            tmux("send-keys", "-t", "visual", "c")
            capture("05d-snapshot-form", ["compare saved discovery snapshots", "> before", "after", "Tab field"], 56, 18)
            tmux("send-keys", "-t", "visual", "Escape")
            capture("05e-snapshot-back", ["dns 7/7 ·", "server 192.0.2.53"], 56, 18)
            tmux("send-keys", "-t", "visual", "e")
            capture("05f-discovery-export", ["export redacted discovery overview", "new file only; never overwrites"], 56, 18)
            tmux("send-keys", "-t", "visual", "Escape")
            capture("05g-export-back", ["dns 7/7 ·", "server 192.0.2.53"], 56, 18)
            tmux("send-keys", "-t", "visual", "-l", "\x1b[<0;2;18M\x1b[<0;2;18m")
            capture("06-return", ["sloppytop", "system", "PID", "fixture-worker", "q quit"], 56, 18)
            tmux("resize-window", "-t", "visual", "-x", "112", "-y", "30")
            capture("07-grow", ["sloppytop", "╭─ cpu", "PID", "fixture-worker"], 112, 30)
            tmux("send-keys", "-t", "visual", "/")
            tmux("send-keys", "-t", "visual", "-l", "界")
            tmux("send-keys", "-t", "visual", "Enter")
            capture("07b-unicode-search", ["界-fixture", "1/24", "/界"], 112, 30)
            tmux("send-keys", "-t", "visual", "/", "BSpace", "Enter")
            capture("07c-search-cleared", ["fixture-worker", "24/24"], 112, 30)
            tmux("send-keys", "-t", "visual", "h")
            capture("08-hardware", ["design capacity: 5000 mAh", "raw maximum: 4600 mAh", "0 cycles"], 112, 30)
            tmux("send-keys", "-t", "visual", "d")
            capture("09-disk-topology", ["live disk topology", "disk0s1  partition  parent disk0"], 112, 30)
            tmux("send-keys", "-t", "visual", "s")
            capture("09b-readings", ["fixture rail  0 V", "package power (experimental)", "eth0  rx 0 B/s  tx —"], 112, 30)
            tmux("resize-window", "-t", "visual", "-x", "56", "-y", "18")
            capture("09c-nvidia", ["NVIDIA devices (experimental)", "utilization 0.0%", "VRAM used 0.0 B", "VRAM total 8.0 GB"], 56, 18, compare=True)
            tmux("resize-window", "-t", "visual", "-x", "112", "-y", "30")
            tmux("send-keys", "-t", "visual", "q")
            capture("10-hardware-return", ["PID", "fixture-worker", "q quit"], 112, 30)
            tmux("send-keys", "-t", "visual", "Home", "i", "g")
            capture("11-cgroup", ["cgroup v2 (including descendants)", "CPU: unmeasured", "charged memory: 0 B"], 112, 30)
            tmux("send-keys", "-t", "visual", "t")
            capture("11b-subtree-wide", ["subtree PID 200", "membership may be incomplete", "measured 1/2 visible"], 112, 30)
            tmux("resize-window", "-t", "visual", "-x", "56", "-y", "12")
            capture("11c-subtree-narrow", ["CPU 0.0% of one core", "summed RSS 0.0 B", "measured 2/2 visible"], 56, 12, compare=True)
            tmux("resize-window", "-t", "visual", "-x", "112", "-y", "30")
            tmux("send-keys", "-t", "visual", "t")
            capture("11d-subtree-return", ["cgroup v2 (including descendants)"], 112, 30)
            tmux("send-keys", "-t", "visual", "q")
            capture("12-detail-return", ["PID", "fixture-worker", "q quit"], 112, 30)
            tmux("resize-window", "-t", "visual", "-x", "56", "-y", "12")
            tmux("send-keys", "-t", "visual", "v")
            capture("13-history", ["unobserved time", "d disks", "↑/↓ scroll"], 56, 12)
            tmux("send-keys", "-t", "visual", "-l", "\x1b[<65;9;7M" * 12)
            capture("14-history-scroll", ["recent", "unobserved time", "q close"], 56, 12)
            tmux("send-keys", "-t", "visual", "d")
            capture("15-disk-history", ["read B/s", "fixture-disk", "d overview", "⠂"], 56, 12, compare=True)
            tmux("send-keys", "-t", "visual", "Right")
            capture("16-disk-metric", ["write B/s", "fixture-disk", "d overview"], 56, 12)
            tmux("send-keys", "-t", "visual", "d")
            capture("17-history-overview", ["d disks", "unobserved time"], 56, 12)
            tmux("send-keys", "-t", "visual", "i")
            capture("17a-history-inspect-narrow", ["history sample 1/", "io_pressure", "recorded interfaces"], 56, 12, compare=True)
            tmux("send-keys", "-t", "visual", "Down")
            capture("17aa-history-inspect-scroll", ["history sample 1/", "fixture-eth", "rx 0 B/s", "tx —"], 56, 12, compare=True)
            tmux("resize-window", "-t", "visual", "-x", "112", "-y", "30")
            capture("17b-history-inspect-wide", ["history sample 1/", "anomaly evidence", "recorded interfaces", "fixture-eth",
                                                "recorded top processes", "200  100.0%  450M  fixture-worker", "─" * 90], 112, 30, compare=True)
            tmux("send-keys", "-t", "visual", "Left")
            capture("17c-history-inspect-previous", ["history sample 2/", "preceding gap", "cause unknown", "no process rows stored"], 112, 30)
            tmux("resize-window", "-t", "visual", "-x", "56", "-y", "12")
            tmux("send-keys", "-t", "visual", "q")
            capture("18-history-return", ["PID", "fixture-worker", "q quit"], 56, 12)
            tmux("send-keys", "-t", "visual", "Home")
            for key, label, markers in [
                ("?", "help", ["local network discovery"]),
                ("k", "kill-cancel", ["kill 200 fixture-worker?", "n cancel"]),
                ("c", "columns", ["[x] pid"]),
                ("t", "theme", ["Charm"]),
                ("m", "settings", ["metrics", "stopped", "recorder  idle", "failed (exit 7)", "sample age  0 s"]),
                ("n", "connections", ["127.0.0.1:8080"]),
                ("l", "listeners", ["8080", "fixture-worker"]),
                ("b", "probe-log", ["probe proc", "probe listen"]),
                ("w", "report", ["cpu 32.0 avg"]),
                ("a", "record-refused", ["PROBE_DISABLED"]),
            ]:
                tmux("send-keys", "-t", "visual", key)
                capture(f"19-{label}", ["q close", *markers], 56, 12, compare=label in ("columns", "settings"))
                if key == "c":
                    tmux("send-keys", "-t", "visual", "-l", "\x1b[<65;9;7M" * 20)
                    capture("19-columns-bottom", ["> [ ] cgroup", "Space toggle"], 56, 12)
                if key == "w":
                    tmux("send-keys", "-t", "visual", "c")
                    capture("19-report-compare", ["24h window comparison", "coverage  insufficient"], 56, 12)
                    tmux("resize-window", "-t", "visual", "-x", "112", "-y", "30")
                    tmux("send-keys", "-t", "visual", "w")
                    capture("19-report-workloads", ["fixture group (1 matched)", "incomplete  1/24 stored", "CPU 100.0%"], 112, 30)
                    tmux("send-keys", "-t", "visual", "l")
                    capture("19-report-rss", ["RSS growth evidence", "no RSS growth flags"], 112, 30)
                    tmux("send-keys", "-t", "visual", "e")
                    capture("19-report-export", ["export redacted diagnostics", "> destination", "new file only"], 112, 30)
                    tmux("send-keys", "-t", "visual", "Escape")
                    capture("19-report-export-back", ["RSS growth evidence"], 112, 30)
                    tmux("resize-window", "-t", "visual", "-x", "56", "-y", "12")
                tmux("send-keys", "-t", "visual", "q")
                capture(f"20-{label}-return", ["PID", "fixture-worker", "q quit"], 56, 12)
            tmux("send-keys", "-t", "visual", "q")
            for _ in range(30):
                if not tmux("list-sessions", check=False):
                    break
                time.sleep(.05)
            else:
                raise RuntimeError("q did not exit from the main view")
        finally:
            try:
                # A native renderer that hangs on startup can survive tmux's HUP.
                if pid is not None and tmux("display-message", "-p", "-t", "visual", "#{pane_pid}",
                                            check=False).strip() == str(pid):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            finally:
                tmux("kill-server", check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--review-only", action="store_true", help="capture and check scene markers without comparing old baselines")
    args = parser.parse_args()
    run(args.fixture.resolve(strict=True), args.output.resolve(), args.review_only)
    print(f"Captured TUI frames in {args.output}")
