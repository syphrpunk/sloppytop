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

HEAD: b513246 feat(history): compare recorded disk device trends

<!-- handoff:state-notes -->
Sloppytop is now TypeScript/Bun only. The OpenTUI screen shipped as `sloppytop tui` in v0.3.0; `./st tui` runs this checkout. The Go tree was removed in `6102a7e`. Start with `ts/src/index.ts` for the incur CLI, `ts/src/sample.ts` for shared probe-gated sampling, `ts/src/monitor/` for platform collectors, `ts/src/store/` for SQLite, OpenMetrics and the scheduler, and `ts/src/tui/` for rendering, state and store effects.

At orientation, `main` was two commits ahead of `origin/main` and already had uncommitted work: immediate sampling on `service install`, a Linux user-timer startup change, Linux hwmon critical limits/headroom and TUI history charts, plus an Apple Silicon v0.3.0 Homebrew cask. These changes belong to the existing worktree, not this checkpoint. The cask targets the published binary, while checkout tests exercise current source.

Verified the working tree on macOS arm64: `just test` (232 passing), `just ts-check`, `just build`, and `just ts-smoke`. Did not install the cask or exercise a live scheduler.

Memento is the task source of truth. Several open items overlap existing code: the OpenTUI screen already ships, and Apple Silicon energy and Linux stall-pressure collectors already exist. Inspect remaining acceptance criteria before picking up those items; no tracker status changed.
The GitHub repository is now `syphrpunk/sloppytop`, and this checkout’s `origin` points there. The local directory and legacy config paths retain their old names.

Vetted all 77 reference archives in `_repos/new`; see the [corpus review](docs/research/new-repo-corpus.md) for the inventory and shortlist. No reference code was imported.

[Deep dive 01](docs/research/slices/01-sampling-gaps.md) is complete and committed with the pending chart and Linux headroom work in `d6c3e63` (`nht-62c980`). Recorder and Homebrew cask edits are in `e42bb2b`. Verified 236 tests, type-check, compiled build, and TUI smoke on macOS arm64; the cask parsed in Homebrew and its digest matched the release asset. No live cask install or scheduler was run. Live rate validity is tracked separately (`nht-4e0e0e`).

[Deep dive 02](docs/research/slices/02-linux-memory-pressure-and-oom.md) is complete (`nht-9f5f15`): the optional Linux kernel count appears in system samples, history and OpenMetrics. Reports compare adjacent same-boot samples and keep kills separate from pressure. Verified read-only against live Linux procfs. Next research candidate: per-device disk history and topology.

[Deep dive 03](docs/research/slices/03-device-disk-history.md) is underway (`nht-ed576c`): CLI history compares recorded disk trends; TUI comparison and read-only evidence for durable identity and topology are next.
<!-- /handoff:state-notes -->

<!-- /handoff:state -->

<!-- handoff:recent -->

(no campaign ledger — .handoff/LEDGER.md absent)

<!-- /handoff:recent -->

<!-- handoff:next -->

**Queue: the configured task manager below (source of truth); the configured queue view, if any, is generated from it.**

Open tasks (Memento snapshot):

- `nht-9de7a2` (todo): Apple Silicon energy sample
- `nht-4e0e0e` (todo): Carry live network rate validity through collection and storage
- `nht-ed576c` (in-progress): Compare per-device disk trends in recorded history
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
