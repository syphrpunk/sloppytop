---
name: sloppytop-system
description: "System-wide stats: CPU, memory, disk, per-device throughput and latency, network, load, host info. On macOS, GPU utilization and in-use GPU memory are included when AGX PerformanceStatistics is present. Temperatures, fan speeds, memory composition, page rates, thermal state, and P/E core labels are included when the platform measures them. Run `sloppytop system --help` for usage details."
requires_bin: sloppytop
command: sloppytop system
---

# sloppytop system

System-wide stats: CPU, memory, disk, per-device throughput and latency, network, load, host info. On macOS, GPU utilization and in-use GPU memory are included when AGX PerformanceStatistics is present. Temperatures, fan speeds, memory composition, page rates, thermal state, and P/E core labels are included when the platform measures them.

On Linux, `electrical_sensors` lists kernel-reported hwmon voltage, current,
and instantaneous power when available. The `sensors` probe controls these
readings. Unlabeled voltage channels are omitted; no board corrections
are inferred.

Experimental NVIDIA live sampling on Linux is opt-in via
`SLOPPYTOP_NVIDIA=1`, requires `nvidia-smi` on `PATH` and the `gpu` probe on,
and is not yet validated on NVIDIA hardware.

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--sampleMs` | `number` | `500` | Delta-sampling window in ms for CPU/network rates |
