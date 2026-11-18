# Slice 01: Missing samples, idle rates, and counter resets

Scope: three source snapshots from `_repos/new`, compared with Sloppytop at `c4f8def` plus the in-progress worktree. Read ZIP members in place; no extraction, execution, or source reuse. Snapshot identifiers below are ZIP comments, not verified upstream provenance.

## What the references actually do

| Source snapshot | Behavior verified in code | What to take from it |
|---|---|---|
| `gpui-metrics-monitor-main.zip` (`b06ab100d66acad6981cc48b686b02860f8a7b52`), `src/metrics/system.rs:27–35,60–96,107–193`, `src/ui.rs:34–40,138–161,614–627` | Per-device baselines and monotonic elapsed time. A checked delta returns no value on a decrease, and zero on equal counters. History retains an optional slot for every tick; gaps split the drawn line. Its host aggregate is deliberately unavailable if a contributing rate is unavailable. | Preserve the slot, not just the value. Aggregate completeness is a separate policy decision. No code reuse: license not established. |
| `iodyne-master.zip` (`18633c6daf3f064afdb435d3e09cfb40af372d22`), `src/collect/io.rs:286–304,442–449,647–666,2331–2358` | Skips a device without a baseline so lifetime counters don't spike the first interval. Ordinary byte/operation decreases saturate to zero. Timing counters have a separate wrap policy when the backend supplies a modulus. | Prime per device, and treat known wrapping counters explicitly. Don't copy the reset-to-zero policy when the chart needs to distinguish a reset from idleness. |
| `nanomon-main.zip` (`e307f0740ae95b22584f6e15ed6d83f5937575a7`), `src/sample.zig:173–188`, `src/model.zig:55–68,140–158` | Guards warm-up, but rates default to zero and use saturating subtraction. Numeric-only histories cannot encode a missing slot. | Useful contrast: guarding the calculation isn't enough if the data model can't represent its absence. |

## Findings in Sloppytop

1. **The in-progress TUI history path differences rates that have already been calculated.** `ts/src/monitor/index.ts:82–95,198–199` derives and publishes bytes/sec. `ts/src/store/db.ts:149,237,383` writes and reads those values unchanged; `ts/src/store/openmetrics.ts:14–15` labels them bytes/sec. But `ts/src/tui/store.ts:102–118,147–148` feeds those columns into `counterRates`. This calculates a change in rate, not throughput: steady traffic reads zero, a decline disappears, and the first recorded observation is lost.
2. **Optional readings lose their positions.** `measured()` at `ts/src/tui/store.ts:89–96` removes missing readings before rendering. At `ts/src/view/sparkline.ts:8–18,32–41`, a non-finite sentinel is not a safe substitute: it can poison auto-scaling and maps to the same glyph as zero.
3. **Some historical loss cannot be repaired in the renderer.** The live network collector uses `Date.now()` for elapsed time, initializes rates to zero, clamps negative deltas, and retains the prior rate if elapsed time is non-positive (`ts/src/monitor/index.ts:60–61,82–91`). SQLite network columns are `NOT NULL` (`ts/src/store/db.ts:30–31`). Rows with a stored zero cannot reliably distinguish idleness from older fallback behavior.

### Reproduction

Called `historyView()` with three samples one minute apart, supplied newest first. RX rates in chronological order were `100, 10, 10`; CPU power was `0, missing, 4`. The current output was `rx/s: [0]` and `cpu W: [0, 4]`. Expected: three RX samples as recorded and three power slots, with the middle slot visibly absent. This exercised projection, not the live collectors or database.

## Implementation and verification

- **Completed** (`nht-62c980`): history charts read stored RX/TX rates directly. Optional measurements retain one slot per row; missing slots render as `⠂`, distinct from zero and left padding, and don't affect auto-scaling. All-missing series are omitted; measured-zero series remain.
- Regression tests exercise steady and declining rates, a single measured-zero row, interior and trailing gaps in the rendered frame, and width clipping. On macOS arm64, `just test` (236 passing), `just ts-check`, `just build`, and `just ts-smoke` passed.
- **Separate follow-up** (`nht-4e0e0e`): make live elapsed time monotonic and invalidate only affected counter intervals; use the first valid observation after an unavailable reading as the next baseline. Trace storage and export compatibility before making the new validity signal public. Preserve older rows as recorded; don't guess which zeros were invalid. This slice treats gaps in existing rows, not intervals in which the recorder wrote no row at all.

Next research slice: Linux memory pressure versus OOM outcomes (Headroom and Below).
