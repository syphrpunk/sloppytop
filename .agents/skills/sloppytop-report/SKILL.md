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
| `--top` | `number` | `10` | Top consumers to include |
| `--charts` | `boolean` | `true` | Include braille sparkline trend charts (oldest → newest hour) |

Comparison uses half-open windows and reports sample counts and occupied
hourly slots from each window's start. Deltas are current minus previous
sample averages, not time-weighted rates. Incomplete or unequal coverage
gets a warning; a window with no samples yields no delta.
