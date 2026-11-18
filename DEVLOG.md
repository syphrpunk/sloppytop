# Sloppytop — devlog

Dated checkpoint history. Appended by `handoff-create`. Newest entries on top.

---

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
