# First live process table: nht-8863fa

The [controls audit](tui-controls-audit.md) observed two repeat populations
above 2 s. On the same Darwin host, worker tracing puts most of the time
between the first frame and the populated table **inside the collector**, not
in dispatch to/from the worker. The 500 ms rate window is intentional. Both
full refreshes and all probe, projection and log semantics remain in place.

## Diagnostic measurements only (non-exclusive)

Apple M3, macOS 26.5.1 arm64, Bun 1.4.4; compiled standalone binaries,
112×30 direct PTY, temporary config, shipped probes. Other work was running
on the host. Each series was serial: one first launch of a new executable
copy, then four repeats. Values below are ms, in launch order. Small samples
and changing host load preclude claiming a speedup of the observed magnitude
or passing the [repeat-launch SLA](tui-performance.md).

| Build | Fresh frame / populated | Repeat frame | Repeat populated | Repeat populated p95 / max¹ |
|---|---:|---|---|---:|
| Base `2ba9036` (existing TUI trace) | 4185 / 5640 | 176, 189, 246, 182 | 1886, 1780, 1791, 1606 | 1886 / 1886 |
| Base + startup trace only | 4458 / 5960 | 198, 252, 181, 175 | 2094, 2356, 2010, 1885 | 2356 / 2356 |
| Startup trace + batched sysctls | 5600 / 7025 | 239, 347, 155, 117 | 1827, 1728, 1499, 1322 | 1827 / 1827 |

¹ Nearest rank. Fresh launches are separate, not repeat failures or passes.

| First worker request, repeats only | Before batching (min–max) | After (min–max) |
|---|---:|---:|
| Full request, main thread | 1681–2112 | 1233–1595 |
| First full refresh | 657–985 | 459–600 |
| Window including timer wakeup | 501–507 | 501–502 |
| Second full refresh | 496–590 | 236–465 |
| Request outside measured worker phases | 24–31 | 16–34 |

The two refreshes include all platform collector work and rate calculations;
these are wall times and include any descheduling during collection. A local
all-probes command-count check found 13 `sysctl` invocations per refresh on
this two-cluster Mac. Reading named values together (one batch, then a batch
for the reported performance levels) reduces that to two on the normal
path. Both batches are re-read every refresh. They do not cache mutable
values, turn missing fields into zero, or read disabled swap/pressure keys.
If a batch fails or lacks a key, the individual reader and original failure
policy apply. Other providers, including `ps` and `ioreg`, are unchanged.

## Reproduce the attribution

```
just build
d=$(mktemp -d)
SLOPPYTOP_TUI_STARTUP_TRACE="$d/startup.json" python3 ts/smoke-tui.py ts/dist/sloppytop --timings
cat "$d/startup.json"
```

Choose a **new filename per launch**. A normal exit after the first unpaused
request succeeds writes a private, create-only JSON file; no samples, paths,
PIDs, probe values or terminal text are included. No startup report is
written for an interrupted/failed first request. This is separate from
`SLOPPYTOP_TUI_TRACE` (session-wide main-thread trace).

`requestMs` is measured from before lazy worker creation to delivery of the
reply at the sampler. Worker-local consecutive durations (`phasesMs`) cover
import, config, platform setup, the two refreshes, actual window (including
optional NVIDIA start), and conversion/projection/logging. `outsideWorkerMs`
is the request duration minus their sum: worker startup, message copies,
queues and main-thread resumption **combined**, not a pure scheduling delay.
Neither clock spans PTY launch or presentation; use the direct PTY timings
for the visible population. Tracing is off by default.

**Acceptance pending:** coordinator to compare serial, exclusive launches
of the unchanged base and integrated candidate on the same fixed host,
without tracing for the budget, using the same config and PTY. Separate
fresh from repeats and retain count, p95 and max. No Linux or release gate
is inferred from these Darwin diagnostics.
