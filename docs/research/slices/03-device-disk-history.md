# Slice 03: Per-device disk history and topology

## Reference findings

Read `iodyne-master.zip` in place (ZIP comment `18633c6daf3f064afdb435d3e09cfb40af372d22`, not independently verified). No archive code was extracted, run, or copied.

- `src/collect/io.rs:647–675` requires one baseline per device and records workload and await together. `src/screen.rs:1077–1115,1339–1341` renders separate workload and latency views and distinguishes sampled average latency from traced latency. Sloppytop already stores sampled averages, not per-request durations; do not label the series as a latency distribution or percentile.
- `src/collect/topology.rs:40–113,127–134` models relationships explicitly: partition parents, stacked backing devices, APFS containers, and other volume relationships. A device and a mapped layer can describe the same I/O. Keep their series separate; do not add them or infer topology from their names.
- `src/collect/io.rs:586–619` invalidates volume history if its underlying counter sources change. Sloppytop samples currently store device names rather than durable identities (`ts/src/monitor/disk.ts`, `ts/src/store/db.ts`). Grouping by name is useful within a short window but cannot disambiguate reused names. Stable identities and topology need independent evidence, particularly for hot-plug, mapper devices, and reboots.

## First increment

`sloppytop history --charts` now compares up to four recorded device names, ranked by their highest combined read/write throughput in the selected samples. It charts read and write throughput, IOPS, and interval-average latency on a shared scale per unit. Each chart preserves per-row gaps and measured zeros; all-missing fields are omitted. This visualizes existing data without changing collection, storage, or privileges. Raw samples still contain all recorded devices.

Verified 243 tests on macOS (one Linux-only test skipped), type-check, build, and compiled TUI smoke. A separate compiled CLI smoke used a temporary SQLite fixture and verified a missing middle sample and omitted latency; `history` without `--charts` still returns no chart block.

## Next

`nht-ed576c` remains in progress. Evaluate a TUI comparison view with enough room to read similar device labels, then establish which platform relationships can be measured read-only and which identities survive a name change. Do not put topology discovery in the hot sampling path. Privileged tracing, storage administration, SMART and directory scans are out of scope.
