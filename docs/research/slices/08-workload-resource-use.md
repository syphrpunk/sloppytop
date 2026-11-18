# Slice 08: Workload resource use

Read `asterism-dev.zip` (`c10df4dae20628085f7549a89e0906be16220fc4`),
`crates/core/src/attribute.rs` and `tests/attribution.rs`: Asterism sums
subtrees once and takes additional session, folder, command and container
signals to attach detached work. Coolant (`ddc1a22a2898be36fdc201751c4a61f8c54fd42b`),
`crates/coolant-core/src/classify.rs`, walks parent pointers to assign the
nearest agent ancestor, with command classification and memoization.
Sloppytop uses visible parent pointers only; no reference code was reused.

`sloppytop tree --summary-pid <PID>` reports the CPU and summed RSS of
that root and visible descendants once per PID. CPU is percent of one
core, so the total can exceed 100. macOS uses the sampled `ps` CPU measure;
Linux and Windows count CPU only for a matching process incarnation across
samples without a counter reset. RSS is not unique physical memory and can
double-count shared pages. Each metric reports how many visible members
were measured and whether the total is incomplete; a total with no
contributors is omitted. The command cannot establish whether it sees all
descendants (or detached work), and labels the membership accordingly.
It returns no process records, command lines or environment values.

Unit tests cover subtree boundaries, cycles, partial metrics, zero, PID
reuse, resets, and private input fields. Live macOS arm64 and unprivileged
Linux arm64 outputs reported CPU and RSS with measured and visible counts.
The compiled macOS command excluded explicit argument and environment
canaries. Final validation passed 256 tests on macOS (one Linux-only skip)
and all 257 on Linux arm64, plus both type-checks and builds and the macOS
PTY smoke.
