#!/usr/bin/env python3
"""Exercise a compiled discovery page and verify the CLI/MCP privacy boundary."""

import json
import os
import select
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from harness_process import PrivateTmux, checkpoint, harness_entry, run_owned, owned_process


def screen(binary, env, width, fixture=False):
    # Differential redraws can split visible labels across cursor writes.
    # Assert against decoded terminal cells, not concatenated PTY bytes.
    with tempfile.TemporaryDirectory(prefix="st-discovery-pty-") as folder:
        terminal_env = {key: value for key, value in env.items() if key not in ("TERM", "TMUX", "TMUX_PANE")}

        def wait_for(label, predicate):
            until = time.monotonic() + 20
            while time.monotonic() < until:
                frame = tmux("capture-pane", "-p", "-t", "smoke")
                if predicate(frame):
                    return
                time.sleep(0.05)
            raise AssertionError(f"{width} columns: discovery PTY did not show {label}")

        with PrivateTmux(folder, terminal_env) as tmux:
            tmux.start("smoke", width, 25, [binary, "tui"])
            wait_for("main screen", lambda frame: all(marker in frame for marker in ("PID", "q quit", "D discover")))
            tmux("send-keys", "-t", "smoke", "D")
            wait_for("overview", lambda f: ("cached peers" in f and
                     (not fixture or ("denied" in f and "partial" in f))))
            tmux("send-keys", "-t", "smoke", "Right")
            wait_for("interfaces", lambda f: "interfaces 2/7 ·" in f)
            tmux("send-keys", "-t", "smoke", "r")
            wait_for("refreshed interfaces", lambda f: "interfaces 2/7 ·" in f and "refreshed" in f)
            for index, tab in enumerate(("routes", "neighbors", "listeners", "connections", "dns"), 3):
                tmux("send-keys", "-t", "smoke", "Right")
                wait_for(tab, lambda f: f"{tab} {index}/7" in f and "reading local tables" not in f)
            tmux("send-keys", "-t", "smoke", "q")
            wait_for("return to main", lambda frame: "q quit" in frame)


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
    with owned_process([binary, "--mcp"], env=env, stdin=subprocess.PIPE,
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0) as child:
        for msg in messages:
            child.stdin.write(json.dumps({"jsonrpc": "2.0", **msg}).encode() + b"\n")
        child.stdin.flush()
        deadline = time.monotonic() + 8
        pending = b""
        checked = set()
        while time.monotonic() < deadline:
            checkpoint()
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


def output_boundaries(binary, env):
    def run(*args):
        return run_owned([binary, *args], env=env, text=True, timeout=20).stdout

    # Snapshot paths and parse errors must not echo any private material.
    path = os.path.join(env["XDG_CONFIG_HOME"], "private-canary.example")
    with open(path, "w") as snapshot:
        snapshot.write('{"secret":"192.0.2.243"}')
    bad = run_owned([binary, "discover", "--before", path, "--after", path, "--format", "json"],
                 env=env, text=True, check=False, timeout=20)
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
    for document in (run("watch", "--count", "1", "--interval-ms", "100", "--format", "jsonl"),
                     run("history", "--format", "json"),
                     run("history", "--openmetrics"),
                     run("log", "--limit", "100", "--format", "json")):
        for name in ("cached_by_interface", "default_routes", "owner_visibility", "observed_at"):
            assert name not in document

    with socket.socket() as slot:
        slot.bind(("127.0.0.1", 0))
        port = slot.getsockname()[1]
    with open(os.path.join(home, "config.json"), "w") as config:
        json.dump({"metrics": {"enabled": True, "host": "127.0.0.1", "port": port}}, config)
    with owned_process([binary, "metrics", "serve"], env=env, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL):
        for _ in range(30):
            checkpoint()
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


if __name__ == "__main__":
    harness_entry()
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
