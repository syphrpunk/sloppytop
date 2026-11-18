#!/usr/bin/env python3
"""Capture OpenTUI through tmux's terminal emulator, using synthetic data only."""

import argparse
import difflib
import html
import os
from pathlib import Path
import re
import shlex
import shutil
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


def run(fixture, output):
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="st-visual-") as folder:
        command = f"exec env XDG_CONFIG_HOME={shlex.quote(folder)} {shlex.quote(str(fixture))}"
        base = ["tmux", "-S", f"{folder}/tmux.sock", "-f", "/dev/null"]

        def tmux(*args, check=True):
            return subprocess.run([*base, *args], check=check, text=True, capture_output=True, timeout=10).stdout

        def capture(label, expected, width, height, *, compare=False):
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                plain = tmux("capture-pane", "-p", "-t", "visual")
                if all(token in plain for token in expected):
                    ansi = tmux("capture-pane", "-peN", "-t", "visual")
                    (output / f"{label}.txt").write_text(plain)
                    (output / f"{label}.svg").write_text(svg(ansi, width, height))
                    converter = shutil.which("rsvg-convert")
                    if converter:
                        subprocess.run([converter, str(output / f"{label}.svg"), "-o", str(output / f"{label}.png")], check=True, timeout=10)
                    baseline = Path(__file__).with_name("tui-baselines") / f"{label}.txt"
                    if compare:
                        expected_frame = baseline.read_text(encoding="utf-8")
                        if plain != expected_frame:
                            diff = difflib.unified_diff(expected_frame.splitlines(True), plain.splitlines(True),
                                                        fromfile=str(baseline), tofile=str(output / f"{label}.txt"))
                            raise RuntimeError("terminal frame changed:\n" + "".join(diff))
                    return
                time.sleep(.06)
            raise RuntimeError(f"{label}: expected {expected!r}\n{plain}")

        try:
            tmux("new-session", "-d", "-s", "visual", "-x", "112", "-y", "30", command)
            capture("01-wide", ["PID", "fixture-worker"], 112, 30)
            tmux("resize-window", "-t", "visual", "-x", "56", "-y", "18")
            capture("02-narrow", ["sloppytop", "system", "PID", "Memory", "CPU%", "fixture-worker", "450M", "100.0"], 56, 18)
            tmux("send-keys", "-t", "visual", "D")
            capture("03-discovery-coverage", ["TCP listens: unknown", "UDP bound: unknown",
                                              "cached peers (partial)", "denied", "q close"], 56, 18)
            for _ in range(3):
                tmux("send-keys", "-t", "visual", "Right")
            capture("04-neighbors", ["ARP cache: partial", "fe80::1%eth0"], 56, 18)
            # SGR wheel down delivered to the screen's PTY, not tmux's copy mode.
            tmux("send-keys", "-t", "visual", "-l", "\x1b[<65;9;7M" * 24)
            capture("04b-neighbors-bottom", ["fe80::14%eth0", "q close"], 56, 18, compare=True)
            tmux("send-keys", "-t", "visual", "Up")
            capture("04c-neighbors-up", ["fe80::7%eth0", "q close"], 56, 18)
            tmux("send-keys", "-t", "visual", "r")
            capture("05-refreshed", ["refreshed", "fe80::1%eth0"], 56, 18)
            tmux("send-keys", "-t", "visual", "Right", "Right")
            capture("05b-connections", ["connections ·", "[::1]:8080 PID 200", "rx 0 B/s · tx —"], 56, 18)
            tmux("send-keys", "-t", "visual", "Right")
            capture("05c-dns", ["dns ·", "server 192.0.2.53", "search fixture.test"], 56, 18)
            tmux("send-keys", "-t", "visual", "-l", "\x1b[<0;2;18M\x1b[<0;2;18m")
            capture("06-return", ["sloppytop", "system", "PID", "fixture-worker", "q quit"], 56, 18)
            tmux("resize-window", "-t", "visual", "-x", "112", "-y", "30")
            capture("07-grow", ["sloppytop", "╭─ cpu", "PID", "fixture-worker"], 112, 30)
            tmux("send-keys", "-t", "visual", "h")
            capture("08-hardware", ["design capacity: 5000 mAh", "raw maximum: 4600 mAh", "0 cycles"], 112, 30)
            tmux("send-keys", "-t", "visual", "d")
            capture("09-disk-topology", ["live disk topology", "disk0s1  partition  parent disk0"], 112, 30)
            tmux("send-keys", "-t", "visual", "s")
            capture("09b-readings", ["fixture rail  0 V", "package power (experimental)", "eth0  rx 0 B/s  tx —"], 112, 30)
            tmux("send-keys", "-t", "visual", "q")
            capture("10-hardware-return", ["PID", "fixture-worker", "q quit"], 112, 30)
            tmux("send-keys", "-t", "visual", "i", "g")
            capture("11-cgroup", ["cgroup v2 (including descendants)", "CPU: unmeasured", "charged memory: 0 B"], 112, 30)
            tmux("send-keys", "-t", "visual", "q")
            capture("12-detail-return", ["PID", "fixture-worker", "q quit"], 112, 30)
            tmux("send-keys", "-t", "visual", "q")
            for _ in range(30):
                if not tmux("list-sessions", check=False):
                    break
                time.sleep(.05)
            else:
                raise RuntimeError("q did not exit from the main view")
        finally:
            tmux("kill-server", check=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    run(args.fixture.resolve(strict=True), args.output.resolve())
    print(f"Captured TUI frames in {args.output}")
