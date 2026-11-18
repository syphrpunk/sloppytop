# Sloppytop — devlog

Dated checkpoint history. Appended by `handoff-create`. Newest entries on top.

---

## Diagnosis batch and cross-platform release checks — 2026-11-18

- Added and tested recorder health, history/report evidence, redacted exports, and TUI sample inspection. Verified the compiled workflow on macOS and Linux; Apple Silicon energy coverage remains open.


## Final TUI acceptance audit — 2026-11-18

- Rechecked the retained TUI acceptance criteria and reran the full local validation suite after resuming the goal.


## Revised TUI acceptance — 2026-11-18

- Removed the operator-waived fresh-launch gate, verified the retained budgets and fixed the discovery smoke to inspect rendered terminal cells.


## Second-Mac startup retest — 2026-11-18

- Repeated five launch pairs after a reported change to real-time protection; the cold-start miss persisted.


## Second-Mac startup trace — 2026-11-18

- Compared fresh and repeat scheduling traces on mbp2023 and documented the two security-daemon wakeups before the first target syscall.


## Second-Mac startup comparison — 2026-11-18

- Reproduced the fresh-file startup penalty on mbp2023 using five fresh/repeat pairs of the traced ARM64 artifact.


## Instruments first-launch trace — 2026-11-18

- Identified a 537 ms wait ending in an endpoint protection daemon wakeup in the fresh trace, absent on repeat.


## OpenTUI 0.9.2 upgrade — 2026-11-18

- Upgraded the pinned renderer and verified the ARM64 build, live sampling and unchanged visual baselines. The fresh-copy startup target remains unmet.


## macOS loader timing control — 2026-11-18

- Timed spawn, first dyld diagnostic and version output across five fresh/repeat pairs. The delay largely precedes the first loader message.


## TUI lazy loading — 2026-11-18

- Deferred optional TUI handlers and worker imports; validated compiled and visual behavior and recorded comparable fresh-copy launch measurements.


## macOS packaging startup controls — 2026-11-18

- Benchmarked disposable standalone and bundled payloads. The first-frame gate is still unmet, and no Developer ID signed/notarized candidate was available to test.


## Sustained TUI runs and remaining cold-start gate — 2026-11-18

- Verified longer live and synthetic soaks and direct PTY resize. The fresh-file macOS startup gate needs a runtime/distribution decision; no gate was waived.


## Full-session TUI trace and fresh-file startup controls — 2026-11-18

- Recorded full-session lag and RSS after the Unicode fix, and confirmed that APFS clones reproduce the macOS launch delay without entering the TUI.


## TUI Unicode alignment and styled baselines — 2026-11-18

- Fixed truncated values beside wide-character names and checked four reviewed styled frames. A deliberate color mutation failed verification.


## TUI completion audit and longer benchmark — 2026-11-18

- Recorded memory reclamation, repeated Escape latency tests, retained session-wide stall maxima, and reproduced fresh launch delay with a minimal Bun executable. Goal remains open.


## TUI sustained workloads and Linux standalone smoke — 2026-11-18

- Measured sustained live and 5,000-row fixture workloads, verified the Linux arm64 build and runtime, and corrected the PTY selected-row assertion for differential rendering.


## All-overlay PTY coverage and demand-driven rendering — 2026-11-18

- Covered every overlay at a short viewport, measured paused CPU after enabling demand-driven rendering, and reproduced fresh macOS startup delay without entering the TUI.


## Scrollable TUI history and discovery worker — 2026-11-18

- Added scrollable history and checked disk charts, Unicode search and discovery cancellation through the PTY harness. Moved discovery collection off the input thread.


## TUI metric parity and direct PTY resize — 2026-11-18

- Added hardware and cgroup views with visual checks. Measured direct kernel PTY resize and shortened the renderer debounce; cold startup and broader visual/performance acceptance remain open.


## TUI discovery interactions and collector isolation — 2026-11-18

- Added checked discovery scrolling frames, DNS/connection drill-downs, event-loop timing and a retained sampling worker. Startup and resize still need work.


## TUI performance baseline and first usability fixes — 2026-11-18

- Added live and synthetic PTY timings, improved constrained layouts and discovery count labels, and removed redundant frame work. Both TUI trackers remain open; live input and resize still miss the measured budgets.


## Guarded st install and TUI visual testing — 2026-11-18

- Installed the guarded `st` symlink; added installer collision tests and captured six TUI frames in tmux. Filed usability and performance follow-ups with reproduction evidence. Passed type-check, build, PTY smokes, and 281 tests with one Linux-only skip on the final run.


## macOS checkout build installed on PATH — 2026-11-18

- Passed 280 tests (one Linux-only skip), type-check, build, and both compiled TUI and discovery smokes. Installed a byte-identical copy at `/opt/homebrew/bin/sloppytop` and verified redacted discovery from outside the checkout.


## Network discovery slices 14–25 verified — 2026-11-18

- Added bounded provider results, passive inventory, a CLI/TUI overview, explicit snapshot comparison and redacted exports. Existing `net`/`listen` payloads are unchanged.
- Verified 280 tests on macOS (one Linux-only skip) and all 281 on Linux arm64, plus both type-checks and builds. Compiled macOS PTY passed narrow/wide, refresh, and denied/partial fixtures; the smoke also exercised storage, scrape and MCP exclusion. Linux tracing found no IPv4/IPv6 sockets for discovery and no discovery provider launches for `record` or `watch`.


## Local network discovery batch planned — 2026-11-18

- Prepared twelve on-demand local discovery slices (14–25) with acceptance evidence for each. Planning only; no host checks or runtime changes.


## Powercap hardware validation deferred — 2026-11-18

- Deferred Slice 13 real hardware testing until later this week. Updated `nht-4aa2dd` and the validation checklist; no runtime or host changes.


## OptiPlex powercap access checked — 2026-11-18

- The OptiPlex exposes RAPL `package-0`, but `energy_uj` is root-only and unreadable to UID 1000. No host settings changed; Slice 13 validation remains open.


## Slices 09–12 verified; Slice 13 hardware validation remains — 2026-11-18

- Compared cgroup counters on Linux as UID 1000; verified CLI SQLite history and the compiled PTY on the same zero/gap fixture; checked interface rates and native disk topology on Linux and macOS.
- macOS passed 266 tests with one Linux-only skip; Linux arm64 passed all 267. Both type-checks and builds passed, along with macOS TUI smoke, compiled record, stored metrics and live HTTP scrape.
- Powercap conversion and failure-path fixtures passed. The opt-in driver-free Linux smoke omitted package data as expected. Real Linux package telemetry evidence is still needed (`nht-4aa2dd`).


## Next five slices proposed — 2026-11-18

- Prepared the sequence and verification criteria for slices 09–13 in `docs/research/slices/09-13-plan.md`. Planning only; NVIDIA validation is unchanged.


## NVIDIA hardware validation deferred — 2026-11-18

- Filed `nht-f456db` and recorded the Linux cloud GPU validation procedure in the Slice 07 notes. No cloud setup, tests, or runtime changes in this checkpoint.


## Network, hwmon, battery and workload slices verified — 2026-11-18

- Closed `nht-4e0e0e`; verified legacy network rows, zero vs. absent rates, HTTP metrics and recorded history. Verified hwmon fixtures and Linux omission, live macOS battery inventory and recorder isolation, and verified process-subtree summaries on Linux and macOS.
- Final checks: 256 passed on macOS (one Linux-only skip), 257 passed on Linux arm64. Type-check and compiled build passed on both, plus macOS TUI PTY smoke. Linux dependencies were installed with explicit target flags in a scratch copy to avoid using macOS native packages.
- Experimental NVIDIA helper failure paths and driver-free smoke passed; real NVIDIA device, driver, utilization and VRAM evidence is still required.


## Per-device disk history completed — 2026-11-18

- Added TUI disk history (`v` then `d`), verified the compiled CLI and interactive TUI against a temporary SQLite fixture, and documented read-only Linux/macOS topology findings. 245 tests passed, plus type-check, build, and TUI smoke.

## Per-device disk history started — 2026-11-18

- Reviewed iodyne and added comparable CLI history charts for recorded disk names (`b513246`). Verified 243 tests, type-check, build, TUI smoke, and compiled CLI output against a temporary SQLite fixture.

## Linux pressure and OOM slice completed — 2026-11-18

- Implemented the optional Linux kernel OOM count and same-boot report deltas (`dd12a5b`); closed `nht-9f5f15`.
- macOS: 241 tests passed, plus type-check, build and TUI smoke. Linux aarch64: 36 targeted tests passed, including the live procfs check as an unprivileged user. No OOM induced.

## Pending work committed; OOM deep dive started — 2026-11-18

- Committed the recorder and cask (`e42bb2b`) and recorded charts with Linux thermal headroom (`d6c3e63`). Re-ran 236 tests, type-check, build, and TUI smoke. Parsed the cask and checked its asset digest, without installing it.
- Started [slice 02](docs/research/slices/02-linux-memory-pressure-and-oom.md) and filed `nht-9f5f15` for the host kernel count.

## Sampling slice completed — 2026-11-18

- Fixed TUI history rate units and missing slots, closed `nht-62c980`, and filed live rate validity separately (`nht-4e0e0e`). All 236 tests, type-check, compiled build, and TUI smoke passed on macOS arm64.

## Sampling deep dive — 2026-11-18

- Compared GPUI Metrics Monitor, iodyne, and nanomon source. Reproduced the TUI history unit mismatch and dropped samples; documented the test cases and filed `nht-62c980`. No product code changed.

## Reference corpus vetting — 2026-11-18

- Two Luna and two Terra agents reviewed all 77 archives. Ranked the candidates in [the corpus review](docs/research/new-repo-corpus.md); no archive was extracted or run.

## Repository rename — 2026-11-18

- Renamed the GitHub repository to `syphrpunk/sloppytop`, updated this checkout’s `origin`, and updated installation links and release consumers.

## Session digest — 2026-11-18

- Reoriented on the TypeScript-only CLI and OpenTUI screen; refreshed the handoff and Memento queue snapshot without changing tracker state.
- Verified the existing working tree on macOS arm64: 232 tests, type-check, compiled build, and TUI smoke passed. Homebrew and live scheduler installs were not tested.

## Session digest — 2026-09-25

- (checkpoint — see HANDOFF.md state/next for details)


## Pinned tips

(Load-bearing recurring lessons. Edit by hand; never auto-rewritten by the skill.)

---

## Next (≤5)

(Live queue. Edit by hand or let `--create` refresh from your task manager's open list.)

---

## 2026-09-25  ·  init

- Scaffolded by `handoff-init`
- Task manager: memento
- Package manager: custom
- VCS: git
- Run `handoff-create` after your first chunk of work
