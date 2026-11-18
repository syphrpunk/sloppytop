#!/usr/bin/env python3
"""Start the compiled TUI on a PTY, wait for a live process row, then quit.

Uses a temporary XDG_CONFIG_HOME so the user's config is left alone.
The screen buffer is not printed. A short failure message is printed when the
process exits before it draws.
"""

import fcntl
import os
import pty
import re
import select
import struct
import sys
import tempfile
import termios
import time

LIVE_ROW = re.compile(rb"PID \d+")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: smoke-tui.py <sloppytop-binary>", file=sys.stderr)
        return 2
    binary = os.path.abspath(sys.argv[1])
    if not os.path.isfile(binary) or not os.access(binary, os.X_OK):
        print(f"missing binary: {binary}", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix="sloppytop-smoke-") as config:
        return smoke(binary, config)


def smoke(binary: str, config: str) -> int:
    os.environ["XDG_CONFIG_HOME"] = config
    os.environ["TERM"] = "xterm-256color"
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        os.execv(binary, [binary, "tui"])

    captured = bytearray()
    sent_q = False
    answered = 0
    start = time.monotonic()
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
                    os.write(fd, b"\x1b[24;80R")
                except OSError:
                    break
                answered += 1
            if not sent_q and LIVE_ROW.search(captured):
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
        return finish(exit_status, captured, sent_q)
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
