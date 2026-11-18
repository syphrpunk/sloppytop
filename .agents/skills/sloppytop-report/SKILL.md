---
name: sloppytop-report
description: "Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags, RSS leak flags, and configured process groups. Run `sloppytop report --help` for usage details."
requires_bin: sloppytop
command: sloppytop report
---

# sloppytop report

Aggregate report over the metrics store: hourly avg/peak series, top consumers, anomaly flags, RSS leak flags, and configured process groups

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hours` | `number` | `24` | Look-back window in hours |
| `--compare` | `boolean` | `false` | Compare the look-back window with the immediately preceding equal-length window |
| `--workloads` | `boolean` | `false` | Include per-sample CPU and RSS totals for configured workload groups |
| `--interfaces` | `boolean` | `false` | Include per-sample network interface RX/TX rates in bytes per second |
| `--diagnostic` | `boolean` | `false` | Emit a local, shareable report of recorder state, coverage, and finding counts |
| `--top` | `number` | `10` | Top consumers to include |
| `--charts` | `boolean` | `true` | Include braille sparkline trend charts (oldest → newest hour) |

Comparison uses half-open windows and reports sample counts and occupied
hourly slots from each window's start. Deltas are current minus previous
sample averages, not time-weighted rates. Incomplete or unequal coverage
gets a warning; a window with no samples yields no delta.

Anomaly evidence includes the observed value, comparison operator and threshold.
OOM counts are compared with the previous same-boot sample; the reported span
does not identify the exact event time. RSS growth is evidence of a trend in
stored process rows, not proof of a leak. Load-based I/O pressure is a proxy.

Workload history uses existing configured process group matching. `complete`
means every process in that sample was stored, not that every host process
was visible to the collector. An incomplete zero does not prove the workload
was absent. The report does not add collection or persistence of process
arguments or environment values.

Interface rates are observations for a single sample, not a time series keyed
by device identity. A reused name does not prove continuity. An absent rate
is unmeasured; zero is a measured rate.

Save a diagnostic artifact with `sloppytop report --diagnostic --format json >
diagnostics.json`. It deliberately omits identifiers, paths, process names,
command lines, environment, and network observations. It includes timestamps;
review those before sharing if the timing itself is sensitive.
