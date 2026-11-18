# Slice 03: Per-device disk history and topology

## Reference findings

Read `iodyne-master.zip` in place (ZIP comment `18633c6daf3f064afdb435d3e09cfb40af372d22`, not independently verified). No archive code was extracted, run, or copied.

- `src/collect/io.rs:647–675` requires one baseline per device and records workload and await together. `src/screen.rs:1077–1115,1339–1341` renders separate workload and latency views and distinguishes sampled average latency from traced latency. Sloppytop already stores sampled averages, not per-request durations; do not label the series as a latency distribution or percentile.
- `src/collect/topology.rs:40–113,127–134` models relationships explicitly: partition parents, stacked backing devices, APFS containers, and other volume relationships. A device and a mapped layer can describe the same I/O. Keep their series separate; do not add them or infer topology from their names.
- `src/collect/io.rs:586–619` invalidates volume history if its underlying counter sources change. Sloppytop samples currently store device names rather than durable identities (`ts/src/monitor/disk.ts`, `ts/src/store/db.ts`). Grouping by name is useful within a short window but cannot disambiguate reused names. Stable identities and topology need independent evidence, particularly for hot-plug, mapper devices, and reboots.

## First increment

`sloppytop history --charts` now compares up to four recorded device names, ranked by their highest combined read/write throughput in the selected samples. It charts read and write throughput, IOPS, and interval-average latency on a shared scale per unit. Each chart preserves per-row gaps and measured zeros; all-missing fields are omitted. This visualizes existing data without changing collection, storage, or privileges. Raw samples still contain all recorded devices.

Verified 243 tests on macOS (one Linux-only test skipped), type-check, build, and compiled TUI smoke. A separate compiled CLI smoke used a temporary SQLite fixture and verified a missing middle sample and omitted latency; `history` without `--charts` still returns no chart block.

## TUI comparison

In `sloppytop tui`, press `v` then `d`. Left and right select a metric, and `d` returns to the overview. The CLI and TUI share device ranking, sample alignment, and scale ceilings. TUI rows have a stable number within the view so clipped names with the same prefix are distinguishable. A device with no measurements for the selected metric shows only gaps, not zeros.

## Read-only topology findings

| Platform | Observed without elevation | Limit |
|---|---|---|
| Linux aarch64 guest, UID 1000 | `/sys/class/block/{vda,vdb}/dev` exposed major/minor, and `diskseq` gave distinct sequence numbers for the two disks. No `/dev/disk/by-id` directory, partition or stacked-device edge was observed in this guest. | Major/minor can be reused. Linux allocates `diskseq` from a runtime counter, so pairing it with boot identity can distinguish device instances in one boot, not identify the same physical disk across boots. Partition-parent and `slaves` discovery in iodyne are source-backed, not live-verified here. |
| macOS arm64, UID 501 | `diskutil list -plist` returned APFS container-to-physical-store edges. `diskutil info -plist` reported a partition's `ParentWholeDisk` and a partition UUID, but no disk or volume UUID for the corresponding whole disk. IOMedia exposed BSD name and `Whole`. | A partition or volume UUID identifies that layer, not the underlying whole disk; a current BSD name is not historical identity. |
| Windows | No live topology check. | Keep existing physical-disk labels and do not infer topology from them. |

**Decision:** Keep charts grouped by recorded name, with no layer summation or topology discovery in the sampling path. Old rows cannot be safely re-keyed. If durable identity or topology becomes a product requirement, use a separate opt-in inventory and validate it on hot-plug, hardware and stacked-device fixtures. Privileged tracing, storage administration, SMART and directory scans were outside this slice.

## Completion

`nht-ed576c` is complete. On macOS, 245 tests passed (one Linux-only test skipped), plus type-check, build and TUI smoke. A temporary SQLite fixture verified the compiled CLI gap output and the compiled TUI `v` → `d` → left-arrow path in a real PTY.
