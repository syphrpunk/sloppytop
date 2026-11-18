# Slice 07: Optional NVIDIA live telemetry

Reviewed these ZIP snapshots in place, with no source reuse:

- Tasklens (`f23c43a85628fcd26e4d0ebdad194e654a3a47bf`): `tl-engine`'s
  `workers/gpu_nvidia.rs` and `gpu/spawn.rs` keep NVML in a separate
  `tl-gpu-probe` process, bound requests by deadlines, and reap killed
  helpers off the sampling path; permanently unsupported probes park.
- gpur (`13612c4cbaad9e6c5feaa728c68fa51e2c96f1f0`),
  `src/backend/nvidia.rs`: opens NVML directly and has separate DRM/nouveau
  discovery for devices without NVML.
- nvtop (`71094a9f7dfbfe7cbe9faebfdf055e580a034283`),
  `src/extract_gpuinfo_nvidia.c`: dynamically loads libnvidia-ml and adapts
  to supported API versions for utilization and VRAM.

Sloppytop isolates the driver through the existing `nvidia-smi` CLI rather
than adding native bindings. On Linux, use the normal `gpu` probe and set
`SLOPPYTOP_NVIDIA=1`. Read utilization and used/total VRAM per device UUID
in parallel with the normal sample window. The query is capped at 250 ms
and 32 KiB, with at most one concurrent helper per Sloppytop process;
the sampler never waits for the helper. Short sample windows may end before
the query finishes. Missing values are omitted; a measured 0 is not.
`nvidia_devices` is in live system output, the GPU probe log, and live
OpenMetrics (labeled by device UUID), not SQLite history. Other GPU
backends and their metrics are unchanged.

An unprivileged Linux arm64 container without a driver or `nvidia-smi`
produced a normal CPU and network sample with the opt-in enabled and no
NVIDIA fields. Helper fixtures cover success, missing binary, nonzero
exit, excessive output, and a stuck child. **Real NVIDIA validation is
pending.** Do not describe the probe as supported until a real Linux
NVIDIA host produces device, driver, utilization and VRAM evidence.

On that host, compare these outputs at idle and during an existing GPU
workload. The measurements need not match exactly because they are sampled
at different times:

```sh
nvidia-smi --query-gpu=name,uuid,driver_version,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits
SLOPPYTOP_NVIDIA=1 ./st system --format json | jq '.nvidia_devices'
```
