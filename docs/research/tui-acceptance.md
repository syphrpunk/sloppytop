# TUI acceptance status

The TUI goal and both Memento items (`nht-005268`, `nht-ead7a9`) remain open.
The [backlog](tui-follow-up.md) describes the original issues; the
[performance notes](tui-performance.md) preserve the original budgets,
method and before/after numbers.

| Requirement | Evidence and remaining checks |
|---|---|
| Narrow and wide layouts; transient resize | `frame.test.ts` verifies process column priority and the wide process-row budget. `just tui-visual` captures wide, narrow and grow frames; direct PTY shrink took 19–34 ms on macOS and 23 ms on Linux. The tmux measurement still includes an unresolved delay. |
| Discovery counts and inventory | `frame.test.ts` tests measured zero vs partial/missing coverage and refresh freshness. Visual scenarios `03`–`05c` exercise the overview, IPv6, owner PIDs, zero vs missing rate, and DNS. The worker and delayed fixture exercise dismissal while data is loading. |
| Overlay focus, interactions and history | Visual scenarios `04b`, `04c`, `06`, and `13`–`20` exercise wheel/keyboard bounds, close targeting, scrolling history and every overlay's dismissal. The column picker follows the selection in a 12-row pane. |
| On-demand metric coverage | Visual scenarios `08`–`11` and `pages.test.ts` cover battery capacity, disk topology, electrical and interface readings, and cgroup totals. Tests distinguish missing readings and preserve zero, and verify cgroup details are not logged. |
| Visual regression | `just tui-visual` generates text/SVG and optional PNG in `ts/dist/tui-visual/`. Exact text baselines cover neighbor scrolling, disk history and the narrow column picker; reviewed SVG hashes cover wide/narrow process tables, neighbor scrolling and the picker. A deliberate text mutation produced a unified diff; a background-color mutation failed the style check. Unicode cell-width tests and the narrow fixture protect CPU values beside wide-character names. |
| Usable performance | Latest live and 5,000-row soaks met interaction, loop lag and idle budgets and demonstrated memory reclamation. Twelve direct PTY repeats measured 25 ms shrink p95. Earlier misses are retained. Fresh macOS cold launch remains above the 500 ms first-frame target and can exceed 2 s to populate; a minimal compiled Bun control and APFS clones reproduced the delay. Do not treat repeat-launch startup as a cold-start pass. |
| Build and verification | Latest local run: 289 pass and one Linux-only skip; type-check, build, live smoke and visual checks passed. Linux arm64 previously passed type-check, standalone build, all 288 then-current tests and the live smoke as UID 1000. Review the current diff and rerun applicable gates before closure. |

The authorized packaging investigation tested two bundled alternatives
and a standalone bytecode build; none met the fresh-file targets. See
the [comparative timings](tui-performance.md#macos-packaging-investigation).
The next distinct control is a Developer ID signed/notarized candidate;
the local keychain has no usable signing identity. No OS protections,
release packaging, or targets were changed to obtain a pass.

A five-pair loader timing control after lazy loading placed the fresh-file
delay before the first dyld diagnostic (1.12–1.29 s fresh versus 3–6 ms on
repeat). The remaining gate is not a measured TUI initialization problem.
