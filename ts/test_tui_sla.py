"""Synthetic measurements only. Never launch Bun, a monitor or tmux here."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tui_sla import check_host, summary


REV = "1" * 40


def report(system="Darwin"):
    def workload():
        return {"sha256": "a" * 64, "warmup": {"interactive_ms": 9000, "populated_ms": 9100, "shrink_ms": 600},
                "direct_pty": {k: summary([cap] * 12) for k, cap in
                               (("interactive_ms", 500), ("populated_ms", 2000), ("shrink_ms", 150))},
                "inputs": {f"{mode}_{key}_ms": summary([100] * 19 + [250])
                           for mode in ("live", "frozen") for key in ("scroll", "search", "dismiss")},
                "lag": {"count": 8600, "retained": 3600, "p95": 14, "max": 50}, "sample_count": 180,
                "refresh_ms": 1000, "padding_seconds": [.2, .05],
                "soak_cpu_pct": 0, "paused_cpu_pct": 2, "paused_rss_mib": 160, "idle_seconds": 10,
                "soak_rss_mib": [[i, 201 if i < 61 else 200] for i in range(181)]}
    return {"revision": REV, "host": system + "-booked", "system": system, "platform": "synthetic",
            "tmux": "test", "bun": "test", "workloads": {"live": workload(), "5000": workload()}}


class TuiSlaTest(unittest.TestCase):
    def setUp(self):
        self.report = report()
        self.row = self.report["workloads"]["5000"]

    def problems(self):
        return "\n".join(check_host(self.report, "Darwin", "Darwin-booked", REV)["problems"])

    def test_boundaries_and_workload_scope(self):
        live = self.report["workloads"]["live"]
        live.update(paused_rss_mib=190, paused_cpu_pct=3, soak_rss_mib=[[i, 300] for i in range(181)])
        self.assertEqual(self.problems(), "")
        self.assertEqual(self.row["inputs"]["live_scroll_ms"], {"n": 20, "p50": 100, "p95": 100, "max": 250})

    def test_p95_and_single_worst_input_fail_independently(self):
        for key in self.row["inputs"]:
            for values in ([100.001] * 20, [1] * 19 + [250.001]):
                with self.subTest(key=key, values=values):
                    self.row["inputs"][key] = summary(values)
                    self.assertIn(f"inputs.{key}: over budget", self.problems())

    def test_direct_collector_excludes_only_the_warmup(self):
        spec = importlib.util.spec_from_file_location("bench", Path(__file__).with_name("bench-tui.py"))
        bench = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bench)
        keys = self.row["warmup"].keys()
        fake = [json.dumps(dict.fromkeys(keys, ms)) for ms in [5001, *range(1, 13)]]
        with patch.object(bench.subprocess, "check_output", side_effect=fake) as smoke:
            result = bench.direct_repeats("/unused/fixture", 5000)
        self.assertEqual(smoke.call_count, 13)
        self.assertEqual(smoke.call_args.kwargs["env"]["ST_FIXTURE_ROWS"], "5000")
        self.assertIn("--timings-json", smoke.call_args.args[0])
        self.assertEqual(result["warmup"]["interactive_ms"], 5001)
        self.assertEqual(result["direct_pty"]["interactive_ms"], {"n": 12, "p50": 6, "p95": 12, "max": 12})

    def test_direct_only_no_tmux_or_composition_substitution(self):
        for key in self.row["direct_pty"]:
            metric = self.row["direct_pty"][key]
            metric["max"] = metric["p95"] = metric["max"] + .001
            self.assertIn(f"direct_pty.{key}: over budget", self.problems())
        self.row.update(resize_ms=summary([2]*12), resizeCompose=summary([1]*12))
        del self.row["direct_pty"]["shrink_ms"]
        self.assertIn("direct_pty.shrink_ms: missing", self.problems())

    def test_unverified_full_lag_or_hidden_early_violation(self):
        for maximum, reason in [(51, "inconclusive"), (151, "over budget")]:
            self.row["lag"]["max"] = maximum
            self.assertIn("lag: " + reason, self.problems())
        self.row["lag"].update(count=3500, retained=3500, p95=50, max=150)
        self.assertEqual(self.problems(), "")
        self.row["lag"]["p95"] = 50.01
        self.assertIn("lag: over budget", self.problems())

    def test_soak_and_idle_limits(self):
        self.row.update(paused_cpu_pct=2.01, paused_rss_mib=161)
        self.row["soak_rss_mib"][61][1] = 200.01
        for metric in ("paused_cpu_pct", "paused_rss_mib", "soak_rss_mib"):
            self.assertIn(metric, self.problems())

    def test_rising_medians_below_cap_not_pass(self):
        self.row["soak_rss_mib"] = [[i, 40 + i/2] for i in range(181)]
        result = check_host(self.report, "Darwin", "Darwin-booked", REV)
        self.assertEqual(result["soaks"]["5000"]["window_medians_mib"], [80.25, 100.25, 120.25])
        self.assertIn("inconclusive", self.problems())

    def test_sparse_sampling_is_inconclusive(self):
        # Four possible launch/teardown completions are not credited to the soak.
        self.row["sample_count"] = 93
        self.assertIn("only 89 assured successes", self.problems())
        self.row["sample_count"] = 94
        self.assertEqual(self.problems(), "")
        del self.row["sample_count"]
        self.assertIn("missing successful-sample evidence", self.problems())

    def test_missing_invalid_or_short_evidence(self):
        for key in self.row.copy():
            with self.subTest(key=key):
                saved = self.row.pop(key)
                self.assertTrue(self.problems())
                self.row[key] = saved
        for key, value in [("soak_rss_mib", self.row["soak_rss_mib"][:-1]), ("idle_seconds", 9.9),
                           ("soak_cpu_pct", False), ("paused_cpu_pct", float("nan")), ("sample_count", 1)]:
            with self.subTest(key=key):
                old = self.row[key]
                self.row[key] = value
                self.assertTrue(self.problems())
                self.row[key] = old
        self.row["soak_rss_mib"][90][0] += 2
        self.row["lag"].update(count=10, retained=10)
        self.row["inputs"]["frozen_search_ms"]["n"] = 19
        errors = self.problems()
        for key in ("observation at second 90", "lag: too few", "frozen_search_ms: missing"):
            self.assertIn(key, errors)

    def test_offline_command_requires_both_named_hosts_same_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            mac, linux = (Path(directory) / name for name in ("mac.json", "linux.json"))
            command = [sys.executable, str(Path(__file__).with_name("tui_sla.py")), "--revision", REV,
                       "--macos-host", "Darwin-booked", "--linux-host", "Linux-booked", str(mac), str(linux)]
            mac.write_text(json.dumps(self.report))
            def run():
                return subprocess.run(command, capture_output=True, text=True).returncode
            self.assertEqual(run(), 1)  # Linux missing
            linux.write_text("{} truncated")
            self.assertEqual(run(), 1)
            for overrides in [{"revision": "0"*40}, {"host": "shared"}, {"workloads": {}}, {"system": "Darwin"}]:
                linux.write_text(json.dumps({**report("Linux"), **overrides, "assessment": {"problems": []}}))
                self.assertEqual(run(), 1)
            linux.write_text(json.dumps(report("Linux")))
            self.assertEqual(run(), 0)
            self.row["inputs"]["live_search_ms"] = summary([10] * 19 + [251])
            mac.write_text(json.dumps(self.report))
            failure = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(failure.returncode, 1)
            self.assertIn("5000.inputs.live_search_ms: over budget", failure.stdout)


if __name__ == "__main__":
    unittest.main()
