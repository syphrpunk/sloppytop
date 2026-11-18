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

HEAD: e824b35 chore(handoff): refresh Sloppytop repo checkpoint

<!-- handoff:state-notes -->
Sloppytop is now TypeScript/Bun only. The OpenTUI screen shipped as `sloppytop tui` in v0.3.0; `./st tui` runs this checkout. The Go tree was removed in `6102a7e`. Start with `ts/src/index.ts` for the incur CLI, `ts/src/sample.ts` for shared probe-gated sampling, `ts/src/monitor/` for platform collectors, `ts/src/store/` for SQLite, OpenMetrics and the scheduler, and `ts/src/tui/` for rendering, state and store effects.

At orientation, `main` was two commits ahead of `origin/main` and already had uncommitted work: immediate sampling on `service install`, a Linux user-timer startup change, Linux hwmon critical limits/headroom and TUI history charts, plus an Apple Silicon v0.3.0 Homebrew cask. These changes belong to the existing worktree, not this checkpoint. The cask targets the published binary, while checkout tests exercise current source.

Verified the working tree on macOS arm64: `just test` (232 passing), `just ts-check`, `just build`, and `just ts-smoke`. Did not install the cask or exercise a live scheduler.

Memento is the task source of truth. Several open items overlap existing code: the OpenTUI screen already ships, and Apple Silicon energy and Linux stall-pressure collectors already exist. Inspect remaining acceptance criteria before picking up those items; no tracker status changed.
The GitHub repository is now `syphrpunk/sloppytop`, and this checkout’s `origin` points there. The local directory and legacy config paths retain their old names.
<!-- /handoff:state-notes -->

<!-- /handoff:state -->

<!-- handoff:recent -->

(no campaign ledger — .handoff/LEDGER.md absent)

<!-- /handoff:recent -->

<!-- handoff:next -->

**Queue: the configured task manager below (source of truth); the configured queue view, if any, is generated from it.**

Open tasks:
(task manager: memento)
{
  "count": 5,
  "items": [
    {
      "id": "nht-9de7a2",
      "uuid": "01a0d7da-f81b-7000-bb47-53203d449d63",
      "slug": "nht-9de7a2-apple-silicon-energy-sample",
      "title": "Apple Silicon energy sample",
      "status": "todo",
      "type": "feature",
      "parent": "nht-2613eb",
      "blockedBy": [],
      "blocking": [],
      "priority": "high",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-11-01T08:26:19.378Z",
      "path": ".memento/items/nht-9de7a2-apple-silicon-energy-sample.md"
    },
    {
      "id": "nht-cb0edf",
      "uuid": "01a0d7da-f744-7000-953d-f33b5e5bdcd9",
      "slug": "nht-cb0edf-expand-the-cli-past-process-table-parity",
      "title": "Expand the CLI past process-table parity",
      "status": "todo",
      "type": "milestone",
      "parent": null,
      "blockedBy": [],
      "blocking": [],
      "priority": "high",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-09-25T09:17:26.726Z",
      "path": ".memento/items/nht-cb0edf-expand-the-cli-past-process-table-parity.md"
    },
    {
      "id": "nht-2613eb",
      "uuid": "01a0d7da-f7b9-7000-89cb-1567be8c3ef1",
      "slug": "nht-2613eb-harvest-faculties-from-the-repos-monitor-corpus",
      "title": "Harvest faculties from the _repos monitor corpus",
      "status": "todo",
      "type": "epic",
      "parent": "nht-cb0edf",
      "blockedBy": [],
      "blocking": [],
      "priority": "high",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-09-25T09:17:26.842Z",
      "path": ".memento/items/nht-2613eb-harvest-faculties-from-the-repos-monitor-corpus.md"
    },
    {
      "id": "nht-b1794f",
      "uuid": "01a00e6e-2b7e-7000-b59f-dae09b769881",
      "slug": "nht-b1794f-opentui-tui-replacement",
      "title": "OpenTUI TUI replacement",
      "status": "todo",
      "type": "epic",
      "parent": null,
      "blockedBy": [],
      "blocking": [],
      "priority": "low",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-08-17T06:34:56.255Z",
      "path": ".memento/items/nht-b1794f-opentui-tui-replacement.md"
    },
    {
      "id": "nht-9bd745",
      "uuid": "01a0d7da-f8f6-7000-99b1-e2408001ca4d",
      "slug": "nht-9bd745-stall-pressure-thermal-headroom-and-battery",
      "title": "Stall pressure, thermal headroom, and battery",
      "status": "todo",
      "type": "feature",
      "parent": "nht-2613eb",
      "blockedBy": [],
      "blocking": [],
      "priority": "high",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-10-24T17:18:45.298Z",
      "path": ".memento/items/nht-9bd745-stall-pressure-thermal-headroom-and-battery.md"
    }
  ]
}

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
