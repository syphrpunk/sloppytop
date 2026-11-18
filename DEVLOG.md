# Sloppytop — devlog

Dated checkpoint history. Appended by `handoff-create`. Newest entries on top.

---

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
