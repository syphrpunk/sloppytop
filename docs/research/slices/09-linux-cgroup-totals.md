# Slice 09: Linux cgroup totals

Below (`20bf79f14c677b30d2d03df0111285a040a56d8d`) reads v2 files in
`below/cgroupfs/src/lib.rs` using directory-relative operations and filesystem
validation. Tasklens (`f23c43a85628fcd26e4d0ebdad194e654a3a47bf`) reads optional
`usage_usec` and `memory.current` for app/unit attribution in
`crates/tl-collect/src/proc/cgroup.rs`. No reference code was reused.

`tree --cgroup-pid <PID>` looks up the visible v2 mount via mountinfo and uses
hierarchical counters once, not a sum of descendants' counters. CPU is the
interval delta of `usage_usec` as percent of one core; charged memory is the
current kernel charge and differs from process RSS. Unavailable counters
are omitted. Changes observed in PID start time, membership or cgroup inode
invalidate the result. This cannot detect migration out and back between
observations. There is no recording, elevation, or private process data.

On Linux arm64, running as UID 1000 in a cgroup v2 container, the CLI
reported root cgroup `/`, 0.75% and 57,036,800 charged bytes while direct
reads showed increasing `usage_usec` and changing `memory.current`.
The CLI itself was in the measured group, so values need not repeat across
separate reads. Fixtures verify exact deltas, hierarchy, missing
controllers, recreation and migration.
