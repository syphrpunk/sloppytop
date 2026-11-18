# CLAUDE.md

## Project Overview

Sloppytop is a terminal process monitor — the CLI companion to [NeoHtop](https://github.com/Abdenasser/NeoHtop). The program is the TypeScript CLI in `ts/`, built on [incur](https://github.com/wevm/incur). `sloppytop tui` is the screen, on `@opentui/core`.

## Quick Reference

Toolchain (bun, just) is managed by [mise](https://mise.jdx.dev) — run `mise install` once. Tasks run via `just` (see `justfile`). The npm package under `npm/` is managed with bun.

```bash
just setup     # bun install
./st tui       # this checkout's screen
just test      # bun test
just ts-check  # tsc --noEmit
just build     # compile ts/dist/sloppytop
```

Commands: `system`, `processes`, `top`, `tree`, `proc`, `snapshot`, `watch`, `kill`, `record`, `history`, `report`, `config`, `service`, `net`, `listen`, `hardware`, `probe`, `log`, `metrics`, `tui`. Monitors cover macOS (`bun:ffi` libproc), Linux (`/proc`), and Windows (PowerShell CIM). State lives in `~/.config/sloppytop/` (an existing `~/.config/neohtop/` directory is reused). An existing `~/.config/sloppytop-cli/config.json` is read once to seed columns, theme, and refresh, and is not written. All commands support `--format toon|json|yaml|md|jsonl`, `--llms`, and MCP. Compiled release binaries self-update via `--update`. The runtime dependencies in `ts/package.json` are `incur` and `@opentui/core`; the collectors and SQLite store use Bun APIs.

## Architecture

```
ts/src/
├── index.ts           # incur CLI
├── monitor/           # platform collectors
├── store/             # config, sqlite, report, service
├── tui/               # screen: frame, state, themes, keys
├── filter/            # search, sort, process tree
└── view/sparkline.ts  # braille sparklines
```

## Key Conventions

- **Theme colors only** — screen color comes from `ts/src/tui/theme.ts` and `ts/src/tui/style.ts`
- **Unicode rendering** — braille dots (U+2800–U+28FF) for sparklines, block chars (▏▎▍▌▋▊▉█) for bars, `…` for truncation
- **One sample** — `takeSample` in `ts/src/sample.ts` feeds the screen and the commands
- **Omit an unmeasured reading** — a measured 0 stays 0

## Adding Things

**New theme:** Add it in `ts/src/tui/theme.ts`.

**New screen row:** Render it from `ts/src/tui/frame.ts`. Key handling lives in `ts/src/tui/state.ts` and `ts/src/tui/run.ts`.

**New monitor metric:** Add the field in `ts/src/monitor/types.ts` and read it in the platform collector.

## Testing

```bash
just test
cd ts && bun test src/filter
```

## Release

Push a git tag to trigger the GitHub Actions release workflow. It builds `sloppytop` for macOS Apple Silicon, Linux, and Windows. `.github/workflows/ci.yml` type-checks, tests, and builds the Linux binary on every push and pull request.

## Handoff protocol

This project uses the handoff workflow (the handoff skills and plugin) for resumable state across sessions, compactions, model swaps, and agent runtimes.

**Before any work:**
- Run the `handoff-continue` skill to bootstrap context.
- Read files listed in `.handoff/config.yaml` under `project.readingOrder`.

**Before stopping:**
- Run the `handoff-create` skill to checkpoint.
- Use a full checkpoint flow if compaction is imminent or work is structurally significant (new phase, major refactor, etc.).
- A checkpoint ends in a commit of its own files (explicit paths, commit hook honoured, never pushed); unrelated dirty files stay unstaged.

**Other flags:**
- `handoff-list` — show checkpoints
- `handoff-switch` — promote an archived checkpoint to active
- `handoff-verify` — run project test command
- `handoff-diff` — what changed since last checkpoint

**Configuration:** `.handoff/config.yaml`

The workflow is task-manager, package-manager, VCS, and agent-runtime agnostic. Any agent that can read markdown and run shell can follow this protocol — see the handoff plugin's `references/multi-agent-protocol.md`.
