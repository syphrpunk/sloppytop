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

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--filter` | `string` |  | Match name, command, and PID. Commas OR terms (chrome, node); quote a term to keep a comma in a regex. Predicates AND: cpu>, cpu>=, mem>, mem>= (K/M/G), pid:N |
| `--user` | `string` |  | Only processes owned by this user |
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
| `--summary-pid` | `number` |  | Summarize one visible subtree; incompatible with `--filter` and `--user` |
