# Slice 10: History coverage

The GPUI Metrics Monitor `src/metrics/system.rs` and chart implementation
reviewed in [Slice 01](01-sampling-gaps.md) track missing readings within
observations. This slice adds a separate marker between stored observations.

CLI history and the TUI use one projection over the same oldest-first
rows. Intervals over 90 minutes get one `╌` cell, regardless of their
duration. This is descriptive, not a timer contract: manual samples and
old or new cadences are valid, and no recorder failure or missing sample
count can be inferred. `⠂` still means a missing reading, and measured zero
is a blank Braille cell. No rows are inserted or changed. Coverage applies
to the displayed window and row limit; latest age refers to its newest row.

The compiled CLI read two stored zero-valued samples three hours apart and
rendered `⠀╌⠀` without changing the returned row count. The TUI frame
regression and the compiled TUI in a real PTY render the same cells, age,
and legend. Additional fixtures
cover hourly, bursty and mixed-cadence histories.
