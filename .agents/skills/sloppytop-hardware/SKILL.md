---
name: sloppytop-hardware
description: "On-demand hardware inventory: chip, core layout, memory, displays, battery health, and CPU feature flags when the platform lists them. Cached under ~/.config/sloppytop, or an existing ~/.config/neohtop directory. record and service never call this. Run `sloppytop hardware --help` for usage details."
requires_bin: sloppytop
command: sloppytop hardware
---

# sloppytop hardware

On-demand hardware inventory: chip, core layout, memory, displays, battery health, and CPU feature flags when the platform lists them. Cached under ~/.config/sloppytop, or an existing ~/.config/neohtop directory. record and service never call this.

On macOS, supported battery registry fields add design and raw maximum
capacity in mAh. The OS-reported maximum-capacity percentage and cycle
count remain separate. Use `--refresh` to update a preexisting cache.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--refresh` | `boolean` | `false` | Re-read the platform and replace the cache |
