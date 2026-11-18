# Sloppytop — handoff

> **Read this first.** Single entry point for resuming work. Run the
> `handoff-continue` skill for the structured summary. Then read the files
> listed in `.handoff/config.yaml` under `project.readingOrder`.

---

## Required reading order

Read the files listed in `.handoff/config.yaml` under `project.readingOrder`.

---

## State of play

| Phase | Status | Notes |
|---|---|---|
| TypeScript CLI and OpenTUI | Shipped | v0.3.0; obsolete Go tree removed after release |

---

<!-- handoff:state -->

HEAD: 8312b79 feat(tui): display on-demand local network discovery

<!-- handoff:state-notes -->
Sloppytop is now TypeScript/Bun only. The OpenTUI screen shipped as `sloppytop tui` in v0.3.0; `./st tui` runs this checkout. The Go tree was removed in `6102a7e`. Start with `ts/src/index.ts` for the incur CLI, `ts/src/sample.ts` for shared probe-gated sampling, `ts/src/monitor/` for platform collectors, `ts/src/store/` for SQLite, OpenMetrics and the scheduler, and `ts/src/tui/` for rendering, state and store effects.

At orientation, `main` was two commits ahead of `origin/main` and already had uncommitted work: immediate sampling on `service install`, a Linux user-timer startup change, Linux hwmon critical limits/headroom and TUI history charts, plus an Apple Silicon v0.3.0 Homebrew cask. These changes belong to the existing worktree, not this checkpoint. The cask targets the published binary, while checkout tests exercise current source.

Verified the working tree on macOS arm64: `just test` (232 passing), `just ts-check`, `just build`, and `just ts-smoke`. Did not install the cask or exercise a live scheduler.

Memento is the task source of truth. Several open items overlap existing code: the OpenTUI screen already ships, and Apple Silicon energy and Linux stall-pressure collectors already exist. Inspect remaining acceptance criteria before picking up those items; no tracker status changed.
The GitHub repository is now `syphrpunk/sloppytop`, and this checkout’s `origin` points there. The local directory and legacy config paths retain their old names.

Vetted all 77 reference archives in `_repos/new`; see the [corpus review](docs/research/new-repo-corpus.md) for the inventory and shortlist. No reference code was imported.

[Deep dive 01](docs/research/slices/01-sampling-gaps.md) is complete and committed with the pending chart and Linux headroom work in `d6c3e63` (`nht-62c980`). Recorder and Homebrew cask edits are in `e42bb2b`. Verified 236 tests, type-check, compiled build, and TUI smoke on macOS arm64; the cask parsed in Homebrew and its digest matched the release asset. No live cask install or scheduler was run. Live rate validity is tracked separately (`nht-4e0e0e`).

[Deep dive 02](docs/research/slices/02-linux-memory-pressure-and-oom.md) is complete (`nht-9f5f15`): the optional Linux kernel count appears in system samples, history and OpenMetrics. Reports compare adjacent same-boot samples and keep kills separate from pressure. Verified read-only against live Linux procfs. Next research candidate: per-device disk history and topology.

[Deep dive 03](docs/research/slices/03-device-disk-history.md) is complete (`nht-ed576c`): CLI and TUI compare recorded disks on shared scales. Read-only Linux and macOS checks support keeping the graphs grouped by recorded name, without implying durable hardware identity or adding topology to the sampling path.

[Slices 04](docs/research/slices/04-live-network-rates.md), [05](docs/research/slices/05-linux-hwmon-electrical.md), [06](docs/research/slices/06-macos-battery-capacity.md), and [08](docs/research/slices/08-workload-resource-use.md) are implemented and verified locally: host network rate validity (`nht-4e0e0e` closed), Linux hwmon electrical readings, macOS raw battery capacity on demand, and visible process-subtree summaries. All changes are committed locally; nothing was pushed.

[Slice 07](docs/research/slices/07-nvidia-telemetry.md) has a bounded experimental Linux probe. Fixtures and the driver-free Linux smoke passed. Real hardware validation is intentionally deferred to a Linux cloud GPU and tracked as `nht-f456db`. The slice document contains the commands and evidence checklist. The five-slice goal remains blocked on that evidence.

[Slice 09](docs/research/slices/09-linux-cgroup-totals.md) adds Linux cgroup totals (`8cb2991`); [10](docs/research/slices/10-history-coverage.md) adds CLI/TUI history coverage (`d84921b`); [11](docs/research/slices/11-interface-throughput.md) adds live interface rates (`84075f8`); [12](docs/research/slices/12-disk-topology.md) adds on-demand disk topology (`3b90ee8`). All four have local verification and individual evidence notes.

[Slice 13](docs/research/slices/13-linux-powercap.md) adds experimental package watts (`093616b`). The Linux arm64 guest exposed no powercap. The OptiPlex exposes `package-0`, but its energy counter is root-only. Real hardware validation is deferred until later this week (`nht-4aa2dd`), separately from the NVIDIA follow-up. The goal remains blocked until the checklist is verified on a host with counters readable without elevation.

[Slices 14–25](docs/research/slices/14-25-network-discovery-plan.md) are implemented and verified. `discover` and TUI `D` read local tables on demand; raw exports are explicit and `--redact` emits only counts and coverage. See the [provider matrix and audit](docs/research/slices/18-25-discovery-workflow.md). Linux arm64 and macOS were validated. Discovery is not exposed via MCP or collected by the recorder or scraper. NVIDIA and powercap follow-ups are unchanged.
<!-- /handoff:state-notes -->

<!-- /handoff:state -->

<!-- handoff:recent -->

(no campaign ledger — .handoff/LEDGER.md absent)

<!-- /handoff:recent -->

<!-- handoff:next -->

**Deferred until later this week:** Use the [Slice 13 powercap checklist](docs/research/slices/13-linux-powercap.md#real-hardware-verification) on an authorized Linux host with counters readable by the test account. Track evidence in `nht-4aa2dd`.

**Separate, deferred:** NVIDIA cloud validation remains in `nht-f456db`.

**Discovery batch verified:** See the [discovery workflow, provider matrix, and acceptance evidence](docs/research/slices/18-25-discovery-workflow.md).

**Queue: Memento is the source of truth.**

- `nht-4aa2dd` (todo): Validate Linux powercap package telemetry on real hardware
- `nht-f456db` (todo): Validate experimental NVIDIA telemetry on a real cloud GPU
- `nht-9de7a2` (todo): Apple Silicon energy sample
- `nht-cb0edf` (todo): Expand the CLI past process-table parity
- `nht-2613eb` (todo): Harvest faculties from the _repos monitor corpus
- `nht-b1794f` (todo): OpenTUI TUI replacement
- `nht-9bd745` (todo): Stall pressure, thermal headroom, and battery

<!-- /handoff:next -->

---

## Gotchas

(Add lessons here as they emerge. Carried forward on every `--create --full`.)

---

## Glossary

(Project-specific terms agents should know. Carried forward on every `--create --full`.)

---

## Where to look

| Looking for... | File |
|---|---|
| Architecture decisions | `docs/adr/` |
| Phase/roadmap | `null` |
| Dated checkpoint history | `DEVLOG.md` |
| User-facing changes | `CHANGELOG.md` |
| Handoff config | `.handoff/config.yaml` |
| Archived checkpoints | `.handoff/archive/` |

---

*This file is partly skill-managed. Sections inside `<!-- handoff:* -->` markers are rewritten by `handoff-create`. Everything else is yours to edit freely; the skill preserves your edits across cheap checkpoints and consults them on full checkpoints.*
