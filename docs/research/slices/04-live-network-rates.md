# Slice 04: Live host network rate validity

Follow-up to [Slice 01](01-sampling-gaps.md), which compared GPUI Metrics Monitor,
iodyne, and nanomon. Host rates use adjacent counter samples timed by
`performance.now()`, independently for RX and TX. The monitor compares
interface counters before summing deltas, so traffic on another interface
cannot mask a reset. The aggregate direction is unavailable if its interface
set changes, any contributing counter was unavailable or decreased, or no
positive elapsed interval exists. The current reading becomes the next
baseline; no prior rate is carried forward.

System output omits unmeasured directions, the plots leave gaps, and both
OpenMetrics paths omit the corresponding metric family. SQLite stores NULL
and migrates legacy required columns atomically, keeping sample IDs and
existing values. Old zeros cannot be distinguished from older fallback zeros.
Only decreases and changes visible in adjacent samples can be detected;
Linux interface names and Windows CIM names are not persistent identities.
The on-demand per-process connection probe is separate.

Regression coverage: injected elapsed time and counter recovery, Linux and
macOS parsing, Windows raw CIM assembly, SQLite legacy migration, zero versus
absence in live and stored metrics, and a rendered TUI gap. macOS arm64 passed
250 tests, type-check, compiled build and PTY smoke. Compiled `system`, `record`,
and `history --openmetrics` returned live macOS rates from a temporary store;
the local HTTP `/metrics` scrape also returned both directions.
