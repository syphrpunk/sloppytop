---
name: sloppytop-tree
description: Process tree (depth-first, PPID→PID) with rendering prefixes. Run `sloppytop tree --help` for usage details.
requires_bin: sloppytop
command: sloppytop tree
---

# sloppytop tree

Process tree (depth-first, PPID→PID) with rendering prefixes

Use `--summary-pid <PID>` for CPU and summed RSS of the visible subtree.
The summary reports coverage per metric and does not include process
command lines or environment values. Summed RSS may count shared pages
more than once.

On Linux, `--cgroup-pid <PID>` instead reads the containing cgroup v2's
hierarchical CPU and charged memory, including descendants. This charged
memory is not summed RSS. Unavailable counters are omitted.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--filter` | `string` |  | Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N |
| `--user` | `string` |  | Only processes owned by this user |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
| `--summary-pid` | `number` |  | Summarize one visible subtree; incompatible with `--filter` and `--user` |
| `--cgroup-pid` | `number` |  | Summarize one Linux cgroup v2; incompatible with `--summary-pid`, `--filter`, and `--user` |
