# Slice 02: Linux memory pressure versus OOM kills

Research started from `d6c3e63`. Source snapshots were read in place; nothing was extracted or run. Snapshot identifiers are ZIP comments, not verified upstream provenance.

## What the reference implementations measure

| Source | Verified behavior | Sloppytop decision |
|---|---|---|
| `headroom-main.zip` (`e8bd6c0babc795cf30c9b28aae65d60de9c79c57`), `src/collect.rs:93–111,472–478` | Samples system PSI and a specific systemd user-service cgroup separately. Queries one oomd property, but falls back to a 50% limit and hard-codes 20 seconds. | Keep scope explicit, but don't present defaults as this host's policy. |
| Headroom, `src/collect.rs:548–608` | Filters journal messages from systemd-oomd and the kernel, then tags the parsed events by source. Its kernel expression only matches `Out of memory: Killed process`, and helper errors can look like no data. | An event viewer could add attribution later. Don't make journal access, log wording, or systemd a dependency of the basic monitor. |
| `below-main.zip` (`20bf79f14c677b30d2d03df0111285a040a56d8d`), `below/procfs/src/lib.rs:481`, `below/model/src/system.rs:398–415` | Parses the optional `/proc/vmstat` `oom_kill` count and carries the latest absolute value through its host model rather than converting it to a per-second rate. The procfs fixture distinguishes `Some(0)` from absent (`below/procfs/src/test.rs:435,501`). | Start with a kernel-scope cumulative count; no new privilege or external helper. |
| Below, `below/cgroupfs/src/lib.rs:850–866`, `below/model/src/cgroup.rs:698–711` | Collects cgroup `oom` and `oom_kill` separately, including a separate local-only view. Model fields are calculated from paired cgroup samples. | Don't add hierarchical and local counters together or call allocation failures process kills. Defer cgroup-level tracking until scope and identity are designed. |

The [Linux PSI docs](https://docs.kernel.org/accounting/psi.html) define `some` as time when at least some tasks stall and `full` as time when all non-idle tasks stall simultaneously. Neither is an event count. The [cgroup v2 docs](https://docs.kernel.org/admin-guide/cgroup-v2.html) distinguish `oom`, `oom_kill` and hierarchical versus local events. Treat kernel counts and userspace oomd actions as different signals.

## Sloppytop gap

`ts/src/monitor/linux.ts:285–291,356–358` already reads `some avg10` separately for CPU, I/O and memory. Linux also reads `/proc/vmstat` for paging (`linux.ts:153`), but does not project a kernel OOM counter. `ts/src/store/report.ts:326–349` flags memory pressure using the platform pressure level, Linux PSI, or a usage fallback; none proves a kill occurred. Don't replace or extend those heuristics with a cumulative total.

## K1: Host-first implementation scope (`nht-9f5f15`)

- Parse exactly `oom_kill` from readable `/proc/vmstat`; accept safe nonnegative integers, preserve measured zero, and omit a missing or malformed key. Wire it into the optional `pressure` probe without coupling it to PSI availability; reuse the vmstat read when both consumers need it.
- Label the value **Linux kernel OOM kills since boot**. For a container, make no claim it is container-local; the scope is that of the mounted procfs. Do not claim to identify the killed process or count userspace oomd interventions.
- Persist it in nullable storage. If reporting increases, compare adjacent observations with confirmed same-boot identity and a nondecreasing count. Missing readings, reset or reboot establish a new baseline; the oldest observation in a requested window alone is not evidence of a kill in that window. Keep boot identity internal rather than emitting it in the CLI or metrics.
- Test the parser with absent, zero, positive and malformed values; test probe gating and old DB rows, then report behavior for flat counts, increases, missing rows, and a reboot whose new count already exceeds the old one. Verify a read-only live Linux sample without inducing an OOM.

## Implementation and verification

K1 now exposes `linux_oom_kills` in Linux system samples and recorded history, and `sloppytop_linux_oom_kills_total` in live and recorded OpenMetrics. It reuses the paging read of `/proc/vmstat`. The pressure switch hides the count, and an independent nullable boot ID is only used inside the recorder and report. Missing values and old rows remain absent while a measured zero is preserved. `kernel_oom_kill` report entries describe increases between adjacent samples, rather than attributing exact event times or victims.

Verification: 241 tests passed on macOS arm64 (the Linux-only test skipped), plus type-check, build, and compiled TUI smoke. On Linux aarch64, 36 targeted tests passed in an unprivileged container, including a read-only comparison with live procfs and a check that disabling the pressure probe omits the count. No OOM was induced.

Cgroup attribution, journald event attribution, and oomd policy discovery remain outside K1. Next research candidate: per-device disk history and topology (iodyne).
