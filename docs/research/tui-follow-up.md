# TUI follow-up

Usability and visual regressions: `nht-005268`. Dedicated performance session:
`nht-ead7a9`. This is a backlog, not a claim that the issues are fixed.

## Issues observed this session

| Priority | Issue and evidence | Follow-up |
|---|---|---|
| P0 | **Live UI feels slow.** User reported poor responsiveness. On this Mac, three installed `system` calls took 0.58–0.76 s with the sample window set to zero and 1.04–1.07 s at 500 ms. That includes CLI startup and is **not** a TUI frame or input-latency measurement. | Profile live sampling, input and painting separately before changing cadence or screen fidelity. |
| P1 | **A shrink can briefly leave the old frame cropped.** The first 112×30 → 56×18 tmux capture showed the old host panel and process rows with the app title and CPU/memory strip offscreen; a later capture settled. | Measure resize-to-correct-frame, including repeated shrink/grow and real terminal differences. Test the settled layout and keep timing evidence for the transient. |
| P1 | **Narrow tables sacrifice the useful numbers.** The settled 56×18 frame keeps Command, Threads and User while CPU% and Memory disappear; command text is clipped anyway. At 112×30 the wide system strip takes about half the frame even with the right-hand area partly unused. | Prioritize PID/name/selected sort metric and real process rows; make secondary columns and system panels progressively compact. |
| P1 | **Partial network coverage is easy to misread as zero.** The discovery fixture shows `0 TCP listens / 0 UDP bound` even when no listener provider was observed. Provider detail says denied/partial, but the prominent count does not distinguish a measured zero from no visibility. | Summarize completeness per count; label unknown versus partial counts before listing provider details. |
| P1 | **Overlay controls and scrolling are inconsistent.** Discovery frames show global `q quit` while `q` dismisses the overlay. Source review: a click in most overlays closes them, discovery mouse-wheel scrolling is ignored, and the reducer can grow the discovery offset past its last page while the renderer clamps it. This can require extra Up presses to move back. | Give overlays consistent focus, close keys, bounded keyboard/mouse scrolling and an accurate footer. Add reducer and terminal coverage. |
| P2 | **Discovery drill-down and labels are incomplete.** TUI tabs omit DNS and connection inventory; address/port formatting does not bracket IPv6, and listener rows show owner visibility but not the reported PIDs. | Add the missing on-demand tabs, bracket numeric IPv6 endpoints, and make owner visibility and measured rate gaps explicit. |
| P2 | **New CLI measurements lack TUI parity.** Source review found no on-demand battery design/raw mAh, disk topology, cgroup workload summary, or Linux electrical/powercap readings in the corresponding screen views. Interface discovery shows rates, but the main strip is host-only. | Decide where each belongs; avoid making the main strip taller or turning on-demand collectors into tick work. Keep experimental readings labeled. |
| P2 | **Regression coverage stops at isolated paths.** Existing PTY smokes verify startup and discovery navigation, but not transient redraws, sustained input, full history/disk navigation, Unicode width, mouse hit targets, dense lists, or all overlays. Fresh captures exposed the narrow-column omission even though the smoke was green. | Grow deterministic interaction scenarios and keep both terminal cells and images for each reproduction. |

## Reproducible visual testing

In the hardware overlay, `d` opens live disk topology and `s` shows the last
sample's electrical, experimental package-power and network-interface readings.
The inventory displays raw battery mAh when available. In process detail,
`g` requests Linux cgroup v2 totals for the selected PID; undefined CPU or
charged memory stays unmeasured, and the cgroup path is not shown or logged.
In history (`v`), use up/down or the mouse wheel to reach offscreen charts
without losing the coverage legend. Press `d` for disk charts, left/right
to change the metric, `d` to return to the overview, and `q` to close.

Run `just tui-visual` with Bun, Python 3 and `tmux`. It compiles the actual
OpenTUI runner with a deterministic synthetic sample, opens an isolated
tmux server/config, drives keys and resize, and checks the resulting terminal
cells. It captures wide, resized narrow, denied/partial discovery, scoped
neighbors, refresh, and return to the main table. It sends `q` and checks
that the tmux session exits. It never captures the real process list.

- Output: `ts/dist/tui-visual/{01-wide,02-narrow,03-discovery-coverage,04-neighbors,05-refreshed,06-return}.{txt,svg}`.
  `rsvg-convert` also generates PNGs. SVG/PNG are reconstructed from the
  terminal emulator's styled cells, not OS screenshots.
- For each TUI change, capture before and after into separate directories
  (`just tui-visual /tmp/st-before`, `just tui-visual /tmp/st-after`).
  Diff the text and **open the affected images**, checking clipping, balance,
  key hints, selection, status/freshness and overlay return. Check a real
  terminal too for emulator-specific issues.
- Checked frames under `ts/tui-baselines/` compare visible terminal text
  after normalizing the fixture's relative disk sample age. A mismatch prints a unified diff and leaves the actual frame and
  image in the output directory. Review both before updating a baseline.
  The discovery bottom frame exercises mouse overscroll and pinned controls;
  the next frame checks that one Up moves immediately.
- Keep `just test`, `just ts-check`, `just build`, `just ts-smoke`, and the
  [compiled discovery check](slices/18-25-discovery-workflow.md#acceptance-evidence).
  The visual captures complement these; a settle check is not latency proof.
- During parallel smoke/build work, the existing NVIDIA helper timing test
  failed once and passed on the isolated rerun. Keep that test flake separate
  from an observed TUI regression.

## Dedicated performance session

Capture cold start (first usable frame), input-to-visible-update p50/p95,
event-loop lag, resize recovery, sample duration, and idle CPU/RSS. Compare
live, paused, and deterministic data at 100, 1,000 and 5,000 rows. Exercise
scroll/search, process-tree toggling and discovery refresh at 56×18 and
112×30. Record machine, viewport, probes and effective cadence for comparisons.

Instrument phases separately: platform collection and individual native
commands; waiting for the counter interval; probe logging; row
filter/sort/tree/selection; frame construction, styling and terminal
rendering. Source-backed suspects, not diagnosed causes:

- Each live tick uses the general sampler, which makes two full collections
  over the record sample window and appends probe logs. macOS calls several
  native tools synchronously. Discovery also runs bounded but synchronous
  native calls on the event loop.
- Paint computes `visibleRows` for selection and then again in `compose`,
  and styles a full frame. Ticks repaint even while paused, and slow samples
  can leave a zero-delay interval before the next sample.

Prove the hot path, fix it one change at a time, and publish before/after
numbers. Do not treat a lower refresh rate or disabled probes as a fix.
