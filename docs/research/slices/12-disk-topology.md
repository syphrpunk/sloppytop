# Slice 12: On-demand disk topology

Iodyne's `src/collect/topology.rs` and `src/collect/storage.rs` model
partition and stacked backing relationships separately. Following
[Slice 03](03-device-disk-history.md), current topology must not be used
to regroup historical samples with reused names.

`hardware --disk-topology` is a separate uncached, read-only inventory.
Linux uses sysfs class links, partition markers and `slaves` relationships.
macOS uses the structured `diskutil list` output for partitions, APFS
containers, physical stores and volumes. Unknown types stay unknown;
disconnected entries and edges to invisible devices are omitted. No
serial numbers, volume labels, UUIDs, or mount paths are exposed.

On macOS, the inventory matched native `diskutil` evidence for
`disk0s2` → `disk0` and APFS `disk3` backed by `disk0s2`. On Linux arm64
as UID 1000, the names matched `/sys/class/block` (including virtual
loop/ram devices and `vda`/`vdb`). Fixtures cover partition and stack
edges, unknown devices, dangling links and private fields. The only
runtime import is the explicit hardware flag branch; a temporary-config
`record` stored its sample without creating an inventory cache.
