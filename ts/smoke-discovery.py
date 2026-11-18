#!/usr/bin/env python3
"""Exercise a compiled discovery page and verify the CLI/MCP privacy boundary."""

import fcntl
import json
import os
import pty
import re
import select
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time
import urllib.request


def screen(binary, env, width, fixture=False):
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 25, width, 0, 0))
        os.execve(binary, [binary, "tui"], env)
    ansi = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]")
    answered = step = 0
    buf = b""
    start = time.monotonic()
    try:
        while time.monotonic() - start < 20:
            if select.select([fd], [], [], 0.15)[0]:
                buf += os.read(fd, 8192)
            while answered < buf.count(b"[6n"):
                os.write(fd, f"\x1b[25;{width}R".encode())
                answered += 1
            plain = ansi.sub(b"", buf)
            if step == 0 and b"PID" in plain and time.monotonic() - start > 1.5:
                os.write(fd, b"D")
                step = 1
            coverage_drawn = b"denied" in plain and b"partial" in plain
            if step == 1 and b"cached peers" in plain and (not fixture or coverage_drawn):
                if fixture:
                    return
                os.write(fd, b"\x1b[C")
                step = 2
                buf = b""
                answered = 0
            elif step == 2 and (b"ip address:" in plain or b"ifconfig:" in plain):
                os.write(fd, b"r")
                step = 3
                buf = b""
                answered = 0
            elif step == 3 and b"refreshed" in plain:
                return
        flags = {token.decode(): token in plain for token in (b"denied", b"ARP cache", b"partial", b"cached peers")}
        raise AssertionError(f"{width} columns: discovery PTY did not finish step {step}; {flags}")
    finally:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(fd)


def mcp(binary, env):
    messages = [
        {"id": 1, "method": "initialize", "params": {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "smoke", "version": "1"},
        }},
        {"method": "notifications/initialized"},
        {"id": 2, "method": "tools/list", "params": {}},
        {"id": 3, "method": "tools/call", "params": {
            "name": "get_tool_details", "arguments": {"name": "discover"},
        }},
    ]
    child = subprocess.Popen([binary, "--mcp"], env=env, stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    try:
        for msg in messages:
            child.stdin.write(json.dumps({"jsonrpc": "2.0", **msg}).encode() + b"\n")
        child.stdin.flush()
        deadline = time.monotonic() + 8
        pending = b""
        checked = set()
        while time.monotonic() < deadline:
            if not select.select([child.stdout], [], [], 0.25)[0]:
                continue
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                response = json.loads(line)
                if response.get("id") == 2:
                    tools = response["result"]["tools"]
                    assert tools and all(tool["name"] != "discover" for tool in tools)
                    checked.add(2)
                if response.get("id") == 3:
                    result = response["result"]
                    assert result["isError"] and "Unknown tool: discover" in json.dumps(result)
                    checked.add(3)
                if checked == {2, 3}:
                    return
        raise AssertionError("MCP tool list did not respond")
    finally:
        child.kill()
        child.wait()


def output_boundaries(binary, env):
    def run(*args):
        return subprocess.check_output([binary, *args], env=env, text=True, timeout=20)

    # Snapshot paths and parse errors must not echo any private material.
    path = os.path.join(env["XDG_CONFIG_HOME"], "private-canary.example")
    with open(path, "w") as snapshot:
        snapshot.write('{"secret":"192.0.2.243"}')
    bad = subprocess.run([binary, "discover", "--before", path, "--after", path, "--format", "json"],
                         env=env, text=True, capture_output=True, timeout=20)
    assert bad.returncode and "DISCOVERY_INVALID" in bad.stdout
    assert "private-canary.example" not in bad.stdout + bad.stderr
    assert "192.0.2.243" not in bad.stdout + bad.stderr
    result = json.loads(run("discover", "--redact", "--format", "json"))
    assert result["redacted"] is True
    assert all(set(row) == {"status", "visible_rows"}
               for section in ("interfaces", "routes", "neighbors", "listeners")
               for row in result[section])
    with open(path, "w") as snapshot:
        snapshot.write(run("discover", "--format", "json"))
    diff = json.loads(run("discover", "--before", path, "--after", path, "--format", "json"))
    assert diff["sections"] and all(not s["added"] and not s["removed"] and not s["changed"] for s in diff["sections"])

    home = os.path.join(env["XDG_CONFIG_HOME"], "sloppytop")
    assert not os.path.exists(os.path.join(home, "probes.jsonl"))
    assert not os.path.exists(os.path.join(home, "sloppytop.db"))
    assert json.loads(run("record", "--format", "json"))["recorded"]
    for output in (run("watch", "--count", "1", "--interval-ms", "100", "--format", "jsonl"),
                   run("history", "--format", "json"),
                   run("history", "--openmetrics"),
                   run("log", "--limit", "100", "--format", "json")):
        for name in ("cached_by_interface", "default_routes", "owner_visibility", "observed_at"):
            assert name not in output

    with socket.socket() as slot:
        slot.bind(("127.0.0.1", 0))
        port = slot.getsockname()[1]
    with open(os.path.join(home, "config.json"), "w") as config:
        json.dump({"metrics": {"enabled": True, "host": "127.0.0.1", "port": port}}, config)
    child = subprocess.Popen([binary, "metrics", "serve"], env=env, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics", timeout=2) as response:
                    metrics = response.read().decode()
                assert "# EOF" in metrics and "sloppytop_cpu" in metrics
                assert all(field not in metrics for field in ("cached_by_interface", "default_routes", "owner_visibility", "observed_at"))
                break
            except urllib.error.URLError:
                time.sleep(0.1)
        else:
            raise AssertionError("isolated metrics did not bind")
    finally:
        child.kill()
        child.wait()


if __name__ == "__main__":
    binary = os.path.abspath(sys.argv[1])
    with tempfile.TemporaryDirectory(prefix="sloppytop-discovery-") as folder:
        env = {**os.environ, "XDG_CONFIG_HOME": folder, "TERM": "xterm-256color"}
        output_boundaries(binary, env)
        for width in (58, 112):
            screen(binary, env, width)
            if len(sys.argv) == 3:
                screen(os.path.abspath(sys.argv[2]), env, width, fixture=True)
        mcp(binary, env)
        print("discovery: CLI export/storage isolation, narrow/wide PTY, and MCP exclusion verified")
