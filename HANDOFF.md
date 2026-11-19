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

HEAD: 6ec3284 Allow resized frames to finish repainting before asserting exact baselines

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
The [acceptance checklist](docs/research/tui-acceptance.md) maps delivered changes and open gates. A 105-second macOS run showed RSS reclamation (132 → 107 MiB), and the 5,000-row Escape repeat passed but did not erase the previous miss. The trace preserves worst stalls across percentile-buffer wraparound. A minimal standalone Bun launch reproduced the fresh-build startup delay. Latest macOS validation: 288 pass, one Linux-only skip, type-check, build, visual and compiled PTY smoke.
Visual review caught a wide-character name clipping the adjacent CPU cell. Fixed terminal-cell alignment and grapheme-safe truncation; added reviewed SVG hashes for the main layouts, discovery scrolling and picker. An intentional background-color mutation failed the style check. Latest macOS validation: 289 passed, one Linux-only skip, type-check, build, compiled smoke and visual checks. Fresh macOS launch remains above budget.
After the Unicode fix, an 80-second live soak measured 16.9 ms maximum loop lag across the full session and search/Escape/scroll p95 of 27/45/19 ms. Live RSS rose from 93 to 145 MiB during the observation; paused RSS was 106 MiB. First launches of verified APFS clones still took 2.32–2.51 s even for `--version`, confirming the delay does not require a rebuild or TUI initialization.
The 180-second live and 90-second 5,000-row soaks each showed memory reclamation and met the measured interaction, event-loop and paused budgets. Twelve repeat-launch direct PTY shrinks measured 25 ms p95. The fresh-file macOS startup gate still fails outside the TUI; continuing toward that gate requires a supported runtime/distribution candidate or an explicit target change. Latest macOS checks: 289 pass, one Linux-only skip, type-check, build, visual and compiled PTY smoke.
Authorized macOS packaging trials improved cold startup but did not meet the first-frame target. Three fresh standalone copies reached 2,773 ms p95; two preinstalled-Bun bundle prototypes reached 809 and 1,094 ms p95. The standalone bytecode build rejected OpenTUI's top-level await. No valid signing identity is available for the remaining signed/notarized control. No release or OS settings changed; see the comparative timings in the TUI performance notes.
The TUI now lazy-loads optional page and store handlers; each worker imports only its requested backend. All macOS checks passed (289 tests, one Linux-only skip, type-check, build, live smoke and visual checks). Interleaved fresh-copy runs showed no clear cold-start gain. The existing cold-start gate is still unmet.
After lazy loading, five fresh/repeat launch pairs attributed the bulk of the first-launch penalty to the time before the first dyld diagnostic (1.12–1.29 s fresh versus 3–6 ms on repeat). Version output followed about 50 ms later in both cases. The host component responsible is not identified; the cold-start gate remains unmet.
OpenTUI 0.9.2 is pinned in the manifest and Bun lockfile. On Apple Silicon, type-check, standalone build, live PTY smoke, all existing visual baselines and 289 tests (one Linux-only skip) passed. Three paired fresh-copy trials showed no clear first-frame improvement; the cold-start goal remains blocked.
Instruments System Trace identified a 537 ms pre-start wait in one fresh executable launch, ending when Malwarebytes' RTProtectionDaemon made the target main thread runnable. The repeat trace showed no such wakeup. No tools were installed or security settings changed. Local captures and limitations are documented in the TUI performance notes.
Ran five fresh/repeat PTY pairs with the identical ARM64 artifact on mbp2023 (macOS 27.0.1). All ten live smokes passed; fresh first frame took 1.24–1.49 s versus 82.5–84.8 ms on repeat. The fresh-start gate still fails on the second Mac. No global install or services changed, and temporary files were removed.
Instruments on mbp2023 observed fresh main-thread blocks of 265 and 864 ms ending in Malwarebytes and syspolicyd wakeups respectively, before the first target syscall. The same-file repeat showed neither wakeup. The measured fresh-start gates are still unmet; no security settings changed.
After the operator reported disabling Malwarebytes real-time protection, the same binary on mbp2023 still took 1.28–1.47 s fresh and 82–86 ms on repeat across five pairs. All ten live smokes passed. No new trace or independent verification of the protection setting was performed.
The operator removed macOS fresh-file startup and signing/packaging from the goal; the failed measurements remain in the performance notes. The retained checks passed, including repeat-launch startup, resize, interaction, idle and memory budgets, visual baselines and compiled discovery. Both TUI Memento items are complete. The Pi goal still requires an explicit resume before closing.
After resuming, reran type-check, build, live and discovery PTY smokes, visual baselines, and all 290 tests on macOS (289 pass, one Linux-only skip). The retained TUI acceptance checks and both Memento items are verified; fresh-file startup was removed by the operator, not passed.
The [diagnosis batch](docs/research/slices/26-37-diagnosis.md) added recorder health, history evidence, comparison reports, workload and interface history, redacted discovery diffs and diagnostic reports, and TUI sample inspection. Mac and OptiPlex builds passed the same-DB compiled diagnosis smoke; macOS had 298 tests pass (one Linux-only skip) and Linux had 299 pass. The existing Apple Silicon tracker `nht-9de7a2` remains open: two Macs did not supply validated fan and cluster-frequency measurements, and CPU energy stayed at zero in the second Mac's three live trials. Revisit only with a reliable unprivileged provider or a user-approved change to the requirement. NVIDIA and Linux powercap remain separate.
Rebuilt the current macOS arm64 checkout and installed it at `/opt/homebrew/bin/sloppytop`; the existing `st` symlink now runs the updated build. The installed binary matched the checkout artifact byte-for-byte and passed the compiled diagnosis smoke through `st`. No release, push, or service change.
The [Homebrew and TUI audit](docs/research/homebrew-tui-audit.md) reproduced the missing public cask and exercised install, upgrade and uninstall in a disposable prefix. The fixture omitted recorder hooks to protect the active legacy agent; exact published lifecycle verification remains open. The locally installed `st` now advertises discovery in the footer, opens seven numbered tabs, and uses aligned overlay frames. Full tests, type-check, visual check, and installed-binary smokes passed. Nothing pushed or published.
CLI-to-TUI coverage review: recorder health detail, report window comparisons, recorded workload trends, and visible subtree totals are implemented but lack equivalent TUI views. History inspection shows interface rows and sample anomaly evidence for the five newest points; it does not show stored top processes or RSS-growth evidence. Live discovery covers seven tabs; offline snapshot comparison and explicit redacted exports remain CLI workflows. Per-device NVIDIA telemetry is experimental and not rendered. Slice 34 remains the recorded goal blocker; the batch's scheduler evidence is split between native failed-job observations and parser tests, not a same-job lifecycle through the CLI.
The [CLI-to-TUI parity audit](docs/research/tui-parity.md) now maps the delivered recorder health, subtree summary, History and Report evidence, local JSON workflows, and experimental NVIDIA rendering to their checks. macOS arm64 validation passed: 302 tests, one Linux-only skip, type-check, build, visual checks and both compiled smokes. Real NVIDIA acceptance still requires an authorized Linux host with a working NVIDIA driver (`nht-f456db`); no live GPU support is claimed. Nothing installed or pushed.
The [TUI controls audit](docs/research/tui-controls-audit.md) covers tree readability, recorder UX, visual CI and current performance measurements. Repeat population exceeded 2 s twice on macOS; investigate before adding hot-path work. No scheduler state was changed.
Audit dispatch is tracked under Memento epic nht-f4dce9: one completed evidence record and nine follow-ups. Parallelize sampler tracing, benchmark harness development and the isolated picker prototype; reserve exclusive measurement slots and a single production-screen integrator.
First wave integrated locally through cd9f83e. The 12-repeat macOS baseline/candidate PTY comparison after warmup measured populated-table p95 2443/1988 ms, with 3/0 misses. Recorder Settings is read-only; focused picker remains prototype-only. Fixed-host macOS/Linux release-gate reports are still pending (nht-bee39c).
Integrated confirmed recorder schedule changes and readback (c4e0103), plus tree projection only (b97c133). Wire tree keys, focus and hidden counts next. The diagnosis smoke initially failed before the first tmux frame; launching the binary directly instead of through shell startup hooks fixed it (5eddc53). No real scheduler was changed.
Tree mode now supports folding and focus navigation (a24f505). Optional recording groups are enforced at SQLite insertion (88d15a0); the next screen integration is exposing those choices in recorder Settings without changing global probes.
Rebuilt and installed this checkout into /opt/homebrew/bin. Both ./st tui and /opt/homebrew/bin/st tui rendered the new tree help in independent PTYs. For subsequent user-facing changes distinguish built vs installed: refresh this local install and verify a visible feature through the user's actual command.
Installed integrated process privacy/disclosure and tree/interval controls plus the recording-only group picker through 740d600. Verified actual checkout and installed commands with a controlled child process and isolated configs. Recorder destination, history drill-down and fixed-host SLA acceptance remain open.
Installed the selected History evidence view, verified via both ./st and /opt/homebrew/bin/st. Destination preview and confirmed config switching are backend-only so far (36ebb8a); implement Settings UI next. No real DB or scheduler changed. Fixed-host SLA evidence remains pending.
Confirmed and stopped four stale visual fixture processes and their surviving private tmux server. Fix timeout/termination cleanup before further timing runs (nht-080f08); do not terminate ambiguous checkout TUI sessions or unrelated runtimes by name.
Recorder destination controls are installed: both checkout and shared st verified preview/cancel/confirm/restore on disposable config. Owned-process harness cleanup is integrated, with no matching TUI/test processes or private test servers remaining after validation. Fixed-host SLA acceptance remains outstanding.
Only nht-bee39c remains in the audit epic. Awaiting an authorized quiet macOS/Linux host pair; no certification runs started. Proposed candidate 735521a83a39809d786da91291c6df1c808125a6.
Booked candidate 735521a on MBARemote.local and optiplex. Mac passed; the only Linux issue was insufficient evidence for live full-soak lag p95 (retained 3600/8942, tail p95 0.34 ms, overall max 92.94 ms). Keep nht-bee39c open; count full-soak threshold exceedances before the next candidate run.
The [closing report](docs/research/tui-audit-closeout.md) supersedes earlier audit queue notes. Memento verified all 13 children and epic nht-f4dce9 completed; nht-a618d6 carries the separate release gate. Do not tag on the inconclusive Linux lag result.
Pushed main through 2ca6528 with the Homebrew cask and updated README. Checked published tap metadata against the v0.3.0 arm64 digest; no release tag, install or recorder action. Newer checkout features are not in that archive.
CI passed on 6ec3284 without changing baselines. The 0.4.0 pre-tag gate on 21759f6 passed Linux with full-soak lag counts; macOS live input p95 missed 100 ms and rising RSS medians need a longer soak. See nht-a618d6. Do not tag or bump the cask yet.
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
  "count": 8,
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
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-9de7a2-apple-silicon-energy-sample.md"
    },
    {
      "id": "nht-a618d6",
      "uuid": "01a1f25d-833f-7000-b60c-e9e17681881b",
      "slug": "nht-a618d6-certify-whole-soak-linux-event-loop-lag-on-the-next-release-cand",
      "title": "Certify whole-soak Linux event-loop lag on the next release candidate",
      "status": "in-progress",
      "type": "task",
      "parent": "nht-b1794f",
      "blockedBy": [],
      "blocking": [],
      "priority": "high",
      "attention": null,
      "attentionReason": null,
      "updatedAt": "2026-11-19T06:07:32.226Z",
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-a618d6-certify-whole-soak-linux-event-loop-lag-on-the-next-release-cand.md"
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
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-cb0edf-expand-the-cli-past-process-table-parity.md"
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
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-2613eb-harvest-faculties-from-the-repos-monitor-corpus.md"
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
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-b1794f-opentui-tui-replacement.md"
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
      "path": "/Users/dk/ghq/github.com/syphrpunk/neohtop-cli/.memento/items/nht-9bd745-stall-pressure-thermal-headroom-and-battery.md"
    },
    {

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
