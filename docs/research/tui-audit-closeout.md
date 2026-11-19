# TUI audit closeout — 2026-11-18

**Audit complete; release performance not certified.** The controls and test
harness are installed locally and verified. The fixed-host gate ran on both
booked machines and rejected incomplete evidence as intended. This closeout
is not approval to tag or publish.

| Area | Outcome | Memento items |
|---|---|---|
| Renderer and latency | Kept OpenTUI 0.9.2. The isolated picker added no user benefit; it did not enter production. Batched Darwin collector reads without shortening the sampling window. | `nht-573367`, `nht-1a1d21`, `nht-8863fa` |
| Process navigation | Tree mode folds families, shows hidden counts and keeps focus on refresh. Its PID order is explicit. Screen refresh and freeze are separate from recording cadence. Env and files toggle independently; the TUI shows environment names only. | `nht-7bd44a`, `nht-8fe62d`, `nht-213ec7` |
| Recorder | Settings distinguishes scheduler outcome from last successful insert. Schedule edits require confirmation. Recording-only field choices leave live probes alone. Changing destination previews both histories and changes future writes without moving either DB. | `nht-7afd94`, `nht-63dc92`, `nht-8697aa`, `nht-4a44a1` |
| History | Enter opens evidence for the selected sample; Esc returns to it. Findings are matched by sample ID, not timestamp alone. | `nht-18068d` |
| Verification | Synthetic terminal comparisons run in CI. Interrupted smoke, visual and benchmark runs clean up owned processes. The fixed-host gate checks for missing evidence as well as budget misses. | `nht-080f08`, `nht-bee39c` |

Final integration checks: 351 Bun tests passed (one Linux-only skip on macOS),
23 Python tests passed, and type-check, build and visual comparisons passed.
The diagnosis smoke exercised both `./st tui` and the installed `st tui` with
disposable databases, including destination cancel, confirm and restore.

## Release decision and remaining evidence

Candidate `735521a83a39809d786da91291c6df1c808125a6` was built natively on
`MBARemote.local` and `optiplex`. The Mac passed every check. The only issue
reported for Linux was live full-soak event-loop lag: the retained 3,600 of
8,942 observations had a p95 of 0.34 ms. The full-run maximum of 92.94 ms was
under the 150 ms limit, but neither number proves a full-run p95 ≤50 ms.
This is **inconclusive**, not a measured threshold violation or a waiver.

The audit epic `nht-f4dce9` closes with all 13 children complete.
**Release follow-up `nht-a618d6` remains open:** count threshold exceedances
over the entire soak, test a violation outside the retained window, then
obtain a passing two-host replay on the same new candidate before tagging.
Preserve the original private reports at
`~/.local/state/sloppytop-sla/735521a/20261118/`. See the
[gate and replay instructions](tui-performance.md), [original audit](tui-controls-audit.md)
and [user controls](../../README.md).
