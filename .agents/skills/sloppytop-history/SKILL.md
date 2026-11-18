---
name: sloppytop-history
description: Query recorded metrics from the SQLite store. Run `sloppytop history --help` for usage details.
requires_bin: sloppytop
command: sloppytop history
---

# sloppytop history

Query recorded metrics from the SQLite store

Network fields are bytes per second. An unmeasured direction is omitted,
while a measured zero is shown. Historical rates and zeros recorded before
rate validation are unchanged.

`--charts` compares up to four recorded disk device names by peak combined throughput. Read and write share a scale per unit; missing samples are gaps, and latency is an interval average, not a percentile. Raw samples still include all recorded devices.

In `sloppytop tui`, press `v` then `d` for the same disk comparison. Use left/right to change metrics and `d` to return to the history overview.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--hours` | `number` | `24` | Look-back window in hours |
| `--limit` | `number` | `200` | Max samples returned |
| `--processes` | `boolean` | `false` | Include stored top processes for each sample |
| `--charts` | `boolean` | `false` | Include braille sparkline trend charts (oldest → newest) |
| `--openmetrics` | `boolean` | `false` | Print the latest sample as OpenMetrics text. Default format prints it raw; json wraps the string |
