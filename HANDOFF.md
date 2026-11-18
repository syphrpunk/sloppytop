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

HEAD: 5982100 test(tui): recognize selected rows in Linux PTY output

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

Built the `2eb036f` checkout on macOS arm64 and installed the verified binary at `/opt/homebrew/bin/sloppytop`. The CLI reports `0.3.0`; this is the checkout build with discovery, not a release download. No recorder service or persistent metrics listener was configured.

The checkout installer now adds `st` only when the destination, PATH, and login shell agree it is free; `/opt/homebrew/bin/st` is installed and points to `sloppytop`. `just tui-visual` captures styled terminal frames with synthetic data. The [TUI backlog](docs/research/tui-follow-up.md) tracks usability (`nht-005268`) and a separate performance investigation (`nht-ead7a9`).

The TUI goal remains active. Discovery now has bounded keyboard/wheel scrolling, an explicit close target, a checked terminal-frame baseline, and on-demand connection and DNS tabs. Live sampling uses an embedded Bun worker; a same-host benchmark measured 48 ms search p95 and 45 ms worst loop lag, but startup and resize still miss budget. See the [performance evidence](docs/research/tui-performance.md). Latest macOS checks: 285 tests passed, one Linux-only skip, type-check, build, styled captures and a compiled smoke that requires a live process row.
Added battery capacity, live disk topology, sampled electrical/power/interface readings, and on-demand cgroup totals to TUI overlays. Reviewed the generated frames for each. Direct PTY shrink improved from 102–103 ms to 33–34 ms; the first launch after rebuilding still missed the startup budgets. Full suite on macOS after the metric work: 287 pass, one Linux-only skip. The resize change separately passed type-check, build, compiled smoke and visual checks.
History now scrolls with its legend pinned; visual checks drive stored SQLite data, disk metrics, Unicode search and discovery cancellation. Discovery itself uses a separate collector worker; the benchmark measured 40 ms from closing the visible loading screen to search. macOS validation: 287 passed, one Linux-only skip, type-check, build, live compiled smoke, visual checks. Cold startup, sustained performance acceptance and broader overlay visual coverage remain open.
The PTY harness now opens and dismisses every overlay, checks a narrow picker baseline, and verifies the selected column stays visible after mouse scrolling. Demand-driven rendering measured 0.2% paused CPU live and 0.8% at 5,000 rows. The fresh-build startup delay reproduced on `--version`, outside the renderer and collector. Cold startup and sustained cross-platform acceptance remain open. Latest local checks: 287 passed, one Linux-only skip, type-check, build, live compiled smoke and visual checks.
Sustained benchmarks now measure RSS/CPU and tree toggles. Linux arm64 passed type-check, standalone build, all 288 tests, and compiled PTY smoke as UID 1000. On macOS the 5,000-row soak stayed below the memory budget, but Escape dismissal narrowly missed p95; the live memory run has not established a plateau. Cold macOS startup remains open.
<!-- /handoff:state-notes -->

<!-- /handoff:state -->

<!-- handoff:recent -->

(no campaign ledger — .handoff/LEDGER.md absent)

<!-- /handoff:recent -->

<!-- handoff:next -->

**TUI goal active:** Continue [visual usability work](docs/research/tui-follow-up.md) (`nht-005268`) and [performance profiling](docs/research/tui-performance.md) (`nht-ead7a9`). Linux arm64 has passed standalone validation; investigate fresh Mach-O launch latency, live memory plateau and Escape tails. Check remaining rendered baselines and map goal gates to evidence.

**Deferred:** Linux powercap (`nht-4aa2dd`) and NVIDIA (`nht-f456db`) still require their separately documented hardware verification.

**Discovery batch verified:** See the [discovery workflow and evidence](docs/research/slices/18-25-discovery-workflow.md).

**Queue:** Memento is the source of truth. Other open items include Apple Silicon energy (`nht-9de7a2`), CLI parity (`nht-cb0edf`), corpus research (`nht-2613eb`), OpenTUI (`nht-b1794f`), and pressure/thermal/battery (`nht-9bd745`).

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
