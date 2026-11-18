# TUI acceptance status

The repository acceptance checks below cover the usability and performance
items (`nht-005268`, `nht-ead7a9`) under the revised scope.
The [backlog](tui-follow-up.md) describes the original issues; the
[performance notes](tui-performance.md) preserve the original budgets,
method and before/after numbers.

The operator removed only the macOS fresh-file startup gate and its
signing/packaging investigation. Its failed measurements are retained;
repeat-launch startup and the rest of the TUI acceptance checks remain.

| Requirement | Verified evidence |
|---|---|
| Narrow and wide layouts; transient resize | `frame.test.ts` verifies process column priority and the wide process-row budget. `just tui-visual` captures wide, narrow and grow frames; direct PTY shrink took 19–34 ms on macOS and 23 ms on Linux. Use direct PTY timings for the resize budget; tmux cell captures check layout but include multiplexer delay. |
| Discovery counts and inventory | `frame.test.ts` tests measured zero vs partial/missing coverage and refresh freshness. Visual scenarios `03`–`05c` exercise the overview, IPv6, owner PIDs, zero vs missing rate, and DNS. The worker and delayed fixture exercise dismissal while data is loading. |
| Overlay focus, interactions and history | Visual scenarios `04b`, `04c`, `06`, and `13`–`20` exercise wheel/keyboard bounds, close targeting, scrolling history and every overlay's dismissal. The column picker follows the selection in a 12-row pane. |
| On-demand metric coverage | Visual scenarios `08`–`11` and `pages.test.ts` cover battery capacity, disk topology, electrical and interface readings, and cgroup totals. Tests distinguish missing readings and preserve zero, and verify cgroup details are not logged. |
| Visual regression | `just tui-visual` generates text/SVG and optional PNG in `ts/dist/tui-visual/`. Exact text baselines cover neighbor scrolling, disk history and the narrow column picker; reviewed SVG hashes cover wide/narrow process tables, neighbor scrolling and the picker. A deliberate text mutation produced a unified diff; a background-color mutation failed the style check. Unicode cell-width tests and the narrow fixture protect CPU values beside wide-character names. |
| Usable performance | With OpenTUI 0.9.2, twelve repeat launches measured 223 ms p95 to first frame, 1,297 ms to populate and 24 ms to shrink. Interaction p95 stayed below 100 ms across live and 100/1,000/5,000-row workloads; max loop lag was below 46 ms in the four-workload run. A separate 80-second 5,000-row soak peaked at 84.5 MiB and dropped to 77.5 MiB. While paused it used 0.2% CPU and 116 MiB RSS. Earlier misses are retained. |
| Build and verification | macOS: 289 pass and one Linux-only skip; type-check, standalone build, live smoke, visual checks, and compiled discovery/storage/MCP smoke passed. The discovery smoke now checks terminal cells rather than raw incremental writes. Linux arm64 previously passed type-check, standalone build, all 288 then-current tests and the live smoke as UID 1000; that run predates OpenTUI 0.9.2. |
| Tracking and handoff | Both Memento items are complete. The work and final audit are committed locally; handoff lock verification passed. No global installation, release publication, or push was part of completion. |

The authorized packaging investigation tested two bundled alternatives
and a standalone bytecode build; none met the fresh-file targets. See
the [comparative timings](tui-performance.md#macos-packaging-investigation).
No Developer ID signed/notarized candidate was tested. That investigation
is no longer required for this goal. The earlier fresh-file results are
not recorded as passing.

A five-pair loader timing control after lazy loading placed the fresh-file
delay before the first dyld diagnostic (1.12–1.29 s fresh versus 3–6 ms on
repeat). This isolated the first-launch delay from TUI initialization.

[The second Mac](tui-performance.md#second-mac-mbp2023) also missed both
fresh-file targets. Its System Trace recorded pre-start waits ending in
Malwarebytes and `syspolicyd` wakeups. The repeat trace did not show those
wakeups. A trusted signed/notarized candidate has not been tested.
