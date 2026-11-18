"""Offline gate for the fixed-host protocol in docs/research/tui-performance.md."""

import argparse
import json
import math
from pathlib import Path
import re
from statistics import median
import sys


REPEATS = 12
INPUTS = 20
IDLE = 10  # seconds
SOAK = 180  # seconds, including 60 s of warm-up


def summary(values):
    ordered = sorted(values)
    return {"n": len(values), "p50": ordered[math.ceil(len(values) * .50) - 1],
            "p95": ordered[math.ceil(len(values) * .95) - 1], "max": ordered[-1]}


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def distribution(row, n, p95_limit, max_limit=None):
    if (not isinstance(row, dict) or type(row.get("n")) is not int or row["n"] != n
            or not all(number(row.get(k)) for k in ("p50", "p95", "max"))
            or not row["p50"] <= row["p95"] <= row["max"]
            or (math.ceil(n * .95) == n and row["p95"] != row["max"])):
        raise ValueError(f"missing/invalid distribution (need n={n}, p50, p95, max)")
    if row["p95"] > p95_limit or (max_limit is not None and row["max"] > max_limit):
        raise ValueError(f"over budget: p95={row['p95']} (limit {p95_limit}), max={row['max']} (limit {max_limit})")


def check_soak(series):
    # Require a real observation in every scheduled second; a sleep/resume
    # followed by a burst of reads is not an uninterrupted 1 Hz soak.
    if not isinstance(series, list) or len(series) != SOAK + 1:
        raise ValueError(f"need {SOAK+1} RSS observations")
    for sec, pair in enumerate(series):
        if (not isinstance(pair, list) or len(pair) != 2 or not all(number(x) for x in pair)
                or not sec <= pair[0] < sec + 1 or pair[1] <= 0):
            raise ValueError(f"invalid/missing RSS observation at second {sec}")
    steady = [rss for _, rss in series[61:]]
    return {"post_warmup_rss_mib": summary(steady),
            "window_medians_mib": [median(steady[i:i+40]) for i in (0, 40, 80)]}


def check_lag(lag):
    if (not isinstance(lag, dict) or type(lag.get("count")) is not int or lag["count"] <= 0
            or type(lag.get("retained")) is not int or lag["retained"] != min(3600, lag["count"])
            or not all(number(lag.get(k)) for k in ("p95", "max")) or lag["p95"] > lag["max"]):
        raise ValueError("missing/invalid trace counts, p95 or maximum")
    if lag["max"] > 150 or lag["p95"] > 50:
        raise ValueError(f"over budget: tail p95={lag['p95']}, full max={lag['max']}")
    # A 20 ms timer with this maximum stall must cover the soak interval.
    if (lag["count"] + 1) * (20 + lag["max"] + .005) < SOAK * 1000:
        raise ValueError("too few trace observations to cover the soak")
    if lag["retained"] < lag["count"] and lag["max"] > 50:
        raise ValueError("inconclusive: retained p95 cannot establish full-soak p95")


def check_host(report, system, host, revision):
    problems = []
    result = {"problems": problems, "soaks": {}}
    if (not isinstance(report, dict) or report.get("system") != system or report.get("host") != host
            or not host.strip() or report.get("revision") != revision or not re.fullmatch(r"[0-9a-f]{40}", revision)
            or not all(isinstance(report.get(k), str) and report[k].strip() for k in ("platform", "bun", "tmux"))
            or not isinstance(report.get("workloads"), dict)):
        problems.append("wrong or missing host, platform, tool versions, candidate revision or workloads")
        return result

    for workload in ("live", "5000"):
        row = report["workloads"].get(workload)
        if not isinstance(row, dict):
            problems.append(f"{workload}: missing workload")
            continue

        def problem(metric, reason):
            problems.append(f"{workload}.{metric}: {reason}")

        if not isinstance(row.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
            problem("sha256", "missing artifact digest")
        count, padding = row.get("sample_count"), row.get("padding_seconds")
        if (row.get("refresh_ms") != 1000 or type(count) is not int or count < 0
                or not isinstance(padding, list) or len(padding) != 2 or not all(number(t) for t in padding)):
            problem("sample_count", "inconclusive: missing successful-sample evidence at the default cadence")
        else:
            # The trace counts successful completions over the whole running session.
            # Bound out completions during launch/teardown: at most one already in
            # flight plus starts at 1 Hz (allow 1 ms for timer truncation).
            outside = sum(1 + math.ceil(t / .999) for t in padding if t > 0)
            if count - outside < SOAK // 2:
                problem("sample_count", f"inconclusive: only {max(0, count-outside)} assured successes in the soak; need 90")
        direct = [("interactive_ms", 500, None), ("populated_ms", 2000, None), ("shrink_ms", 150, 300)]
        inputs = [(f"{mode}_{action}_ms", 100, 250) for mode in ("live", "frozen")
                  for action in ("search", "scroll", "dismiss")]
        if not isinstance(row.get("warmup"), dict) or not all(number(row["warmup"].get(k)) for k, _, _ in direct):
            problem("warmup", "missing excluded launch")
        for source, n, metrics in [("direct_pty", REPEATS, direct), ("inputs", INPUTS, inputs)]:
            for key, p95, maximum in metrics:
                try:
                    group = row.get(source)
                    distribution(group.get(key) if isinstance(group, dict) else None, n, p95, maximum)
                except ValueError as err:
                    problem(f"{source}.{key}", err)
        for key, cap in (("paused_cpu_pct", 2), ("paused_rss_mib", 160)):
            value = row.get(key)
            if not number(value) or (key == "paused_rss_mib" and not value):
                problem(key, "missing/invalid reading")
            elif workload == "5000" and value > cap:
                problem(key, f"{value} exceeds {cap}")
        if not number(row.get("idle_seconds")) or row["idle_seconds"] < IDLE:
            problem("idle_seconds", "short or missing paused observation")
        if not number(row.get("soak_cpu_pct")):
            problem("soak_cpu_pct", "missing/invalid reading")
        try:
            check_lag(row.get("lag"))
        except ValueError as err:
            problem("lag", err)
        try:
            soak = check_soak(row.get("soak_rss_mib"))
            result["soaks"][workload] = soak
            if workload == "5000" and soak["post_warmup_rss_mib"]["max"] > 200:
                problem("soak_rss_mib", "post-warm-up RSS exceeds 200 MiB")
            a, b, c = soak["window_medians_mib"]
            if a < b < c:
                problem("soak_rss_mib", "inconclusive: three rising window medians; longer soak required")
        except ValueError as err:
            problem("soak_rss_mib", err)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="full candidate Git SHA")
    parser.add_argument("--macos-host", required=True)
    parser.add_argument("--linux-host", required=True)
    parser.add_argument("macos_report", type=Path)
    parser.add_argument("linux_report", type=Path)
    args = parser.parse_args()
    failures = False
    for system, host, path in [("Darwin", args.macos_host, args.macos_report), ("Linux", args.linux_host, args.linux_report)]:
        try:
            result = check_host(json.loads(path.read_text()), system, host, args.revision)
        except (ValueError, OSError) as err:
            result = {"problems": [str(err)]}
        print(json.dumps({"system": system, "host": host, **result}))
        failures |= bool(result["problems"])
    return int(failures)


if __name__ == "__main__":
    sys.exit(main())
