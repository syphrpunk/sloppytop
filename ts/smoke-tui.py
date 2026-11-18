#!/usr/bin/env python3
"""Start the compiled TUI on a PTY, wait for a live process row, then quit.

Uses a temporary XDG_CONFIG_HOME so the user's config is left alone.
The screen buffer is not printed. A short failure message is printed when the
process exits before it draws.
"""

import fcntl
import argparse
import os
import pty
import re
import select
import struct
import sys
import tempfile
import termios
import time

# Differential rendering can leave the footer's PID and its value in separate
# writes. The selected row itself starts with a marker and a numeric PID.
LIVE_ROW = re.compile(rb"> +\d+\b")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary")
    parser.add_argument("--timings", action="store_true", help="report startup and direct PTY shrink latency")
    args = parser.parse_args()
    binary = os.path.abspath(args.binary)
    if not os.path.isfile(binary) or not os.access(binary, os.X_OK):
        print(f"missing binary: {binary}", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="sloppytop-smoke-") as config:
        return smoke(binary, config, args.timings)


def smoke(binary: str, config: str, timings: bool) -> int:
    os.environ["XDG_CONFIG_HOME"] = config
    os.environ["TERM"] = "xterm-256color"
    height, width = (30, 112) if timings else (24, 80)
    start = time.monotonic()
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        os.execv(binary, [binary, "tui"])

    captured = bytearray()
    sent_q = False
    answered = 0
    first_frame = populated = resize_started = resized = None
    resize_offset = 0
    exit_status = None
    try:
        while time.monotonic() - start < 20:
            ready, _, _ = select.select([fd], [], [], 0.2)
            if ready:
                try:
                    chunk = os.read(fd, 8192)
                except OSError:
                    chunk = b""
                if chunk:
                    captured.extend(chunk)
                elif sent_q:
                    break
            pending = captured.count(b"[6n")
            while answered < pending:
                try:
                    os.write(fd, f"\x1b[{height};{width}R".encode())
                except OSError:
                    break
                answered += 1
            if first_frame is None and b"sloppytop" in captured and b"q quit" in captured:
                first_frame = time.monotonic()
            if not sent_q and LIVE_ROW.search(captured):
                if timings and resize_started is None:
                    populated = time.monotonic()
                    height, width = 18, 56
                    resize_offset = len(captured)
                    resize_started = time.monotonic()
                    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
                if timings and resize_started is not None and resized is None:
                    # The compact redraw includes the system band and selected row.
                    frame = captured[resize_offset:]
                    if b"system" in frame and LIVE_ROW.search(frame):
                        resized = time.monotonic()
                if not timings or resized is not None:
                    try:
                        os.write(fd, b"q")
                        sent_q = True
                    except OSError:
                        break
            waited, raw = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                exit_status = raw
                break
        if exit_status is None:
            try:
                os.write(fd, b"\x03")
            except OSError:
                pass
            time.sleep(1)
            waited, raw = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                exit_status = raw
            else:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
                print("tui smoke: process did not exit", file=sys.stderr)
                return 1
        status = finish(exit_status, captured, sent_q)
        if timings and status == 0:
            if None in (first_frame, populated, resize_started, resized):
                print("tui smoke: incomplete timings", file=sys.stderr)
                return 1
            print(f"direct PTY: first {(first_frame-start)*1000:.1f} ms, "
                  f"populated {(populated-start)*1000:.1f} ms, shrink {(resized-resize_started)*1000:.1f} ms")
        return status
    finally:
        try:
            os.close(fd)
        except OSError:
            pass


def finish(status: int, captured: bytearray, sent_q: bool) -> int:
    code = os.waitstatus_to_exitcode(status)
    drew = bool(LIVE_ROW.search(captured)) and b"sloppytop" in captured
    if code == 0 and sent_q and drew:
        print(f"tui smoke ok: drew {len(captured)} bytes and quit")
        return 0
    print(
        f"tui smoke failed: exit {code}, drew {len(captured)} bytes, quit_sent {sent_q}, frame {drew}",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
