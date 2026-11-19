# TUI audit: find a process, explain a spike, trust the recorder

For delivered changes, test results and the release decision, see the
[audit closeout](tui-audit-closeout.md). The priorities below are the original plan.

**Decision:** keep `@opentui/core` pinned to 0.9.2 (verified against the
[npm latest tag](https://registry.npmjs.org/@opentui%2fcore/latest) at audit).
The process table benefits more from stable selection, useful drill-downs
and responsive input than from continuous animation. Keep the existing
TextRenderable/requestRender path; prototype a focused picker with OpenTUI's
test renderer before migrating any hot path.

| User question | Available now | Next improvement |
|---|---|---|
| Which workload is busy? | Sort/filter/pin, choose columns, `T` tree, inspect a PID or its subtree. Deep prefixes now fold before they consume the name. | Left/right collapse/expand by process identity. Preserve focus on refresh; when collapsing the selected child, select its parent. Surface hidden-child counts. |
| What changed? | `v` inspects recorded samples; `w` compares windows. Missing readings are distinct from measured zero. | Link from the selected history point to its evidence instead of adding another always-visible panel. |
| Is recording working? | `a` writes once; `m` shows last scheduler outcome and latest successful insert. Probe switches affect collection globally, not just storage. Required switches now say so. | Give recording its own Settings section; show effective destination, actual cadence or “unknown”, required/optional fields and last error together. |
| How do I schedule or stop it? | `sloppytop service install --interval-secs 3600` / `service uninstall` on supported schedulers. Install records immediately. `sloppytop config` reports resolved storage paths, including legacy paths. | Confirm enable/disable and cadence changes before applying. Re-read scheduler state afterward. Treat destination changes as a separate operation; preview permissions and existing history, never silently move a DB. |

## Test and delivery order

1. **Every PR:** unit-test reducer effects and cell composition; run the
   synthetic tmux fixture and compare narrow/wide terminal text and styles.
   CI now runs that comparison and retains synthetic captures on failure.
   Never archive a live process pane. Timing output from a shared runner
   is diagnostic, not a release SLA.
2. **Before adding screens:** run repeat-launch PTY tests serially on fixed
   macOS/Linux hosts. Compare against the [existing budgets](tui-performance.md)
   for first frame, populated table, input, resize, lag, idle CPU and RSS.
   Exercise the live collector and 5,000-row fixture, frozen and running;
   retain sample count, p95 and max. Gate releases on a long soak and
   measured thresholds, not baseline image approval.
3. **Then ship recorder controls and tree folding separately.** Test cancel,
   invalid cadence, unsupported scheduler, failed write, disabled required
   probe and legacy DB before enabling scheduler mutation in the screen.
   For a compact viewport show one status line and the selected action;
   put per-probe switches behind disclosure. Test keyboard-only navigation,
   resize during editing, and return to the same selection.

## Local measurement (Darwin arm64, Bun 1.4.4, tmux 3.5a)

Five serial direct PTY starts after compilation: first launch 5,251 ms to
frame / 6,677 ms to population (fresh binary, reported separately). Four
repeats: frame 103–213 ms, population 1,301–2,286 ms, shrink 21–22 ms.
**Two repeat populations exceeded the 2 s budget.** Trace first sample
latency before changing the renderer.

`just tui-bench --workload 5000 --starts 2 --trials 6 --idle 3 --trace`:
the benchmark initially timed out because it expected the search editor at
the end of the toolbar. After repairing the visible-state check, live
search/dismiss/scroll p95 were 21/37/20 ms; frozen 48/74/58 ms.
Paused CPU/RSS were 0.66% / 112 MiB. tmux resize p95 was 304 ms despite
resize composition p95 of 1.22 ms; do not substitute that measurement for
direct PTY resize. Six trials are a diagnostic, not sustained SLA evidence.
