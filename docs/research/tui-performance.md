# TUI responsiveness

**Acceptance scope:** The operator removed macOS fresh-file launch latency
and its signing/packaging investigation from this goal. Those measurements
remain below as history, not passing results. Repeat-launch startup and
every other TUI performance budget still apply.

## Acceptance budgets (before tuning)

Measure in an isolated terminal at the default 1 s refresh and 500 ms counter
window. Keep probes enabled as shipped, record the platform and viewport, and
run the same exercise before and after. These are local interactive budgets,
not performance promises for arbitrary machines and OS providers.

| Observable | Budget |
|---|---|
| Repeat launch to interactive frame | ≤ 500 ms p95 |
| Repeat launch to populated, usable process table | ≤ 2 s p95 |
| Input to visibly correct frame (search, scroll and dismiss; during live sampling and while frozen) | ≤ 100 ms p95; no trial above 250 ms |
| Resize to correct frame | ≤ 150 ms p95; no trial above 300 ms |
| Main-thread event loop lag while sampling | ≤ 50 ms p95; maximum ≤ 150 ms |
| Paused idle process CPU and RSS | ≤ 2% of one core and ≤ 160 MiB with 5,000 fixture processes |
| Steady-state live memory | ≤ 200 MiB with 5,000 fixture processes, no sustained growth after warm-up |

For discovery, measure responsiveness while loading separately from time to
data; correctness requires honoring providers' bounds and presenting unavailable
results, not silently disabling slower providers. Check that interactions stay
responsive with live discovery open and that freezing stops new samples.

Use `just build` and `just tui-visual`, then `just tui-bench`. The benchmark
runs disposable tmux servers and config directories, samples the visible frame
without saving any live process rows, and reports elapsed times and CPU/RSS.
CLI process startup and tmux overhead are included, so compare like for like.
Use the raw output for distributions and document worst cases, not just
averages. Append `--trace` to include main-thread lag and application phase
timings. The trace contains durations and counts only, no process or terminal
data. For manual reproduction set `SLOPPYTOP_TUI_TRACE` to a private file path
before launching the TUI and exit normally to write the result.

## Fixed-host release gate (still requires measurement)

Before tagging, reserve **exclusive, serial** slots on the designated macOS and
Linux machines. Record their exact `platform.node()` names in the booking,
not after selecting results. Use the same machines, power mode, shipped probes,
1 s refresh and 500 ms counter window before/after a change. Record OS, CPU,
load/power conditions and tool versions alongside evidence. A shared CI run,
visual baseline or the historical numbers below do **not** clear this gate.
This is a pre-tag operator check, not a publishing-workflow or runner change.

1. On **each** booked host, check out the same clean full candidate SHA. From
   its root, with Bun, just, Python 3.10+ and tmux available, set `BOOKED_HOST`
   to that machine's pre-recorded name and `REPORT` to a **new**, private file
   outside the checkout (`macos.json` or `linux.json`). Build *both* artifacts
   natively from that checkout; do not point at an installed or stale binary:

   ```sh
   (cd ts && bun install --frozen-lockfile --libc='*') && just build && \
     (cd ts && bun build --compile discovery-pty-fixture.ts --outfile dist/discovery-pty-fixture)
   # Continue only after a successful build. No other benchmarks during collection.
   umask 077
   python3 ts/bench-tui.py ts/dist/sloppytop ts/dist/discovery-pty-fixture \
     --fixed-host "${BOOKED_HOST:?}" > "${REPORT:?}"
   ```

   This exits nonzero on missing evidence, inconclusive growth/lag, or a miss.
   Preserve misses, interrupted/partial files and exit status; don't pick the
   best of reruns. Reports contain host/build metadata, digests, counts, timing
   and resource evidence, not live screen contents. Don't save live panes.

2. Collect both JSON reports. With `REVISION` set to the booked **full Git
   SHA** and `MAC_HOST`/`LINUX_HOST` to the original host names, replay offline:

   ```sh
   python3 ts/tui_sla.py --revision "${REVISION:?}" --macos-host "${MAC_HOST:?}" \
     --linux-host "${LINUX_HOST:?}" /path/to/macos.json /path/to/linux.json
   ```

   Only exit 0 with complete matching evidence from **both** hosts clears
   this numeric gate. A missing report, mismatch, timeout or nonzero result
   blocks release. Review recorded medians, RSS series and retained counts.
   Continue to use the diagnostic benchmark for discovery loading/interrupt,
   tree, composition and tmux resize; none substitutes for a direct PTY shrink.

### What counts as evidence

For **each** of live collection and the 5,000-row fixture, the protocol runs:

- Same binary, private config: one excluded warm-up PTY launch, then 12
  direct PTY launches at 112×30 with a shrink to 56×18. Time interactive
  frame, selected numeric PID row and compact redraw separately. Use
  nearest-rank p95; at n=12 it is the maximum. No fresh-file startup SLA.
- An uninterrupted 180 s running soak with one timestamped process RSS
  observation per second, then stop **before** pausing to read the sampling
  trace. Retain full elapsed-time/RSS series, aggregate CPU, target cadence,
  launch/teardown padding and full-session successful `sample` count (not
  attempts). Require ≥90 successes within the 180 s observation. Conservatively
  exclude possible completions outside it: an in-flight sample plus starts
  every 999 ms for each padding interval (1 ms timer truncation allowance).
  Fewer assured successes is inconclusive, not a new product cadence SLA;
  counts don't prove uniform spacing. A missed RSS second is incomplete evidence. Discard 0–60 s for steady-state RSS. Check every
  later reading against the 200 MiB fixture cap. For both workloads report
  medians for seconds 61–100, 101–140, 141–180. Three strictly rising medians
  are **inconclusive; a longer soak and review are required**, not a pass or
  a proven leak. This is a harness decision rule, not a new growth-rate SLA
  or a proof of long-term stability. Keep the original failed assessment.
- Check loop lag on that soak: the trace retains the newest 3,600 samples
  for p95, and the **full-session maximum** regardless of wrap. Report both
  counts. Reject p95 >50 ms or max >150 ms. If wrapped and max >50 ms, a
  passing retained p95 does **not** prove full-soak p95: block as unverified
  unless the whole-soak count above 50 ms is at most 5% of observations.
  Older reports without this count remain unverified unless max ≤50 ms.
- A separate private tmux session for input-to-visible-frame: 20 each of
  search, Escape dismissal and scroll, both running and frozen, with phase
  jitter relative to sampling. Require every distribution's n/p95/max and
  enforce p95 **and** individual worst-trial limits. While still frozen,
  measure process CPU (percent of one core) over 10 s and endpoint RSS;
  require both readings, with numeric caps on the 5,000-row workload.

`just tui-sla-test` runs only synthetic pass/fail and missing-evidence checks
(including a single 251 ms input despite a passing p95). No host timing was
performed to validate this harness change. Both fixed-host runs, the two-file
check, and review of their evidence remain required on the integrated candidate.

## Initial baseline

Apple M3, macOS 26.5.1, tmux 3.5a, `just tui-bench --trials 5 --starts 3 --idle 3`
on `bc9a9f0` (only the synthetic fixture and benchmark changes applied).
Resize alternates between 112×30 and 56×18. Times are milliseconds; the small
trial counts are for diagnosis, not final acceptance.

| Workload | Interactive start p50/p95 | Populated start p50/p95 | Live search p50/p95 | Resize p50/p95 | Paused CPU / RSS |
|---|---:|---:|---:|---:|---:|
| Live | 1016 / 4914 | 1733 / 5672 | 61 / 286 | 239 / 283 | 3.64% / 112 MiB |
| 100 rows | 669 / 716 | 675 / 720 | 22 / 50 | 244 / 272 | 4.63% / 84 MiB |
| 1,000 rows | 658 / 662 | 662 / 667 | 23 / 49 | 241 / 287 | 4.64% / 94 MiB |
| 5,000 rows | 839 / 843 | 845 / 854 | 33 / 51 | 242 / 285 | 5.30% / 99 MiB |

Live dismiss and scroll p95 were 471 and 113 ms, versus 67 and 34 ms in
the 5,000-row fixture. A separate exploratory run showed similar resize
numbers, but the original benchmark teardown could orphan fixtures on tmux
hangup and create CPU contention. The table uses the corrected harness, which
requires a graceful exit before restarting and does not leave orphan fixtures.
The startup outlier is retained; more repetitions and phase instrumentation
are needed to separate client/emulator startup, rendering, and collection.

Reducing OpenTUI's renderer debounce from 100 to 16 ms did not improve
the measured resize: live p50 stayed at 239 ms and fixture p50 stayed
at 240–242 ms. Reverted the change. Measure the PTY window-size transition
separately from the app's resize event before tuning the renderer again.

Sharing the process row projection across selection and composition, skipping
identical frame styling, and avoiding paint after empty paused ticks improved
paused CPU for the 100/1,000/5,000-row fixtures to 1.32% / 1.66% / 1.33% (from
4.63% / 4.64% / 5.30%). Paused RSS was 82–92 MiB. Live paused CPU was still
2.98%, and live search and resize p95 still missed budget at 229 and 318 ms.
Do not treat the fixture CPU improvement as live performance acceptance.

## Phase trace before collector isolation

`just tui-bench --trace --trials 5 --starts 2 --idle 2` on the same host:
live sample p50/p95 1,004/1,063 ms; live event-loop lag p95 11 ms but
maximum 333 ms, compared with 23 ms maximum at 5,000 fixture rows.
The live renderer setup took 8 ms and first frame submission took 12 ms
from entry to `runTui`, versus 1.5–2.7 s from launching the benchmark
session to observing the screen. Resize composition p95 was 2.31 ms.
These measurements distinguish frame construction from the longer startup
and resize paths; they do not yet localize the wait before `runTui`, the
time between resize request and renderer event, or individual collectors.

## Live sampling off the UI thread

The TUI now runs the same `takeSample` on a retained Bun worker. It has at
most one live sample outstanding, preserves the configured counter window,
and surfaces a worker error or timeout in the screen. Freezing starts no new
samples and does not publish an in-flight result while frozen. The standalone
build embeds `src/tui/sample-worker.ts` as a second entrypoint; the compiled
PTY smoke waits for a selected live PID so a missing worker cannot pass.

The same trace exercise after isolation measured live search p95 of 48 ms
and worst loop delay of 45 ms (previous trace: 333 ms maximum). Resize p95
was still 280 ms and startup had an 8.8 s outlier; neither gate is met.
The 5,000-row run used 1.0% paused CPU with tracing. These small runs guide
the work; they are not a final performance certification.

## Direct PTY resize

Run `python3 ts/smoke-tui.py ts/dist/sloppytop --timings` to bypass tmux's
resize scheduling. This measures a 112×30 → 56×18 kernel PTY resize to
the first compact redraw containing the system band and selected process
row. `just tui-visual` separately checks the title and settled cells.

Six runs with the default 100 ms debounce took 102–103 ms to redraw.
With a 16 ms debounce, six runs took 33–34 ms. The first start after
rebuilding took 1,420 ms to first frame and 2,481 ms to populated; the
next five took 72–85 and 1,064–1,205 ms respectively. This separates the
resize bottleneck from tmux, but the fresh-binary startup outlier still
needs investigation.

Discovery now uses a separate on-demand collector worker. Obsolete queued
requests are skipped and late results cannot replace a newer tab. In a short
`just tui-bench --trace --trials 2 --starts 1 --idle 1` run, closing the visible
loading screen and entering search took 40 ms live and 29–45 ms across fixture
sizes. The visual smoke separately dismisses a deliberately delayed fixture.

## Demand-driven rendering and startup control

The screen has no animations, so it no longer starts OpenTUI's continuous
render loop. In `just tui-bench --trace --trials 12 --starts 3 --idle 5`, paused
CPU was 0.2% live and 0.8% at 5,000 rows. Live search and scroll p95 were
19 and 43 ms; live loop lag peaked at 25 ms. The 5,000-row fixture had a
paused RSS of 83 MiB. The tmux resize and startup timings still missed the
direct PTY budgets and are reported separately, not counted as passes.

Immediately after rebuilding on macOS, direct PTY first frame was 1,334 ms,
of which `runTui` took 16 ms to submit the first frame. A separate fresh build
showed the same delay on `sloppytop --version` (1.22 s real, 0.08 s user+system),
then 0.04 s on the second invocation and 79 ms to the TUI first frame. The
fresh executable is a 96 MiB ad-hoc-signed Mach-O. The control reproduces the
delay without a renderer, sample or terminal; it does not establish which
outside-TUI launch step is responsible. Cold startup is not yet accepted.

## Sustained workloads

`just tui-bench --workload 5000 --trace --trials 20 --starts 1 --idle 5 --soak 40`
observed 67–76 MiB RSS during 40 seconds of live fixture ticks, including a
drop from 76 to 67 MiB; subsequent interactive trials peaked at 103 MiB.
Paused CPU/RSS were 0.6%/110 MiB. Live search, scroll and tree-on p95 were
45, 47 and 34 ms. Escape dismissal narrowly missed the 100 ms p95 budget
(102 ms p95, 160 ms maximum). Worst loop lag was 39 ms.

With `--workload live --soak 35` and otherwise the same options, operation
p95 was 36 ms for search, 56 ms for Escape dismissal and 22 ms for scroll.
Paused CPU was 0.6%; worst loop lag was 43 ms. Live RSS grew from 94 to
127 MiB during that run. It stayed below the size budget but did not yet
show a plateau over this interval. Soak output contains one CPU aggregate
and a timestamped RSS series per workload for longer follow-up runs.

Linux arm64 Apple Container (Bun 1.4.4) also passed type-check, standalone
build and all 288 tests; the compiled TUI passed both direct PTY smokes as
UID 1000. One timed run observed 148 ms to the first frame, 682 ms to a
populated table and 23 ms to shrink. The raw PTY check matches the selected
row, not the footer PID, which Linux can emit as separate updates.

### Longer macOS control runs

- A 105-second live soak showed RSS growing to 132 MiB at 60 seconds, then
  dropping to 107 MiB at 70 seconds and ending at 123 MiB. This shows
  reclamation, not sustained monotonic growth, over the observed interval.
  Live search, Escape and scroll p95 were 16, 37 and 19 ms. The trace from
  that run only proves the maximum over its final 3,600 lag observations
  (149 ms). The trace now retains a session-wide maximum separately from
  its rolling percentile window, with a wraparound regression test.
- A repeat with 5,000 fixture rows and 24 trials measured Escape p95 of
  45 ms live and 41 ms frozen; maxima were 49 and 53 ms. The earlier
  102 ms live p95 remains a recorded miss rather than being discarded.
- A fresh standalone Bun program containing only `console.log` took
  1.31 s to launch, versus under 0.01 s on its second launch. This
  reproduces the fresh-build delay without any Sloppytop dependencies or
  code. It is not evidence that the cold-start target has been met.
- Three first launches of APFS clones of the already-built executable
  took 2.32–2.51 s for `--version` (at most 0.08 s user plus system CPU).
  The delay therefore also occurs on a new file without recompiling or
  invoking the TUI. Running `codesign --verify --strict` on two more clones
  did not remove the delay; their first launches still took 2.36 and
  2.41 s. This does not identify the macOS component responsible.
- After the Unicode layout fix, `just tui-bench --workload live --trace
  --trials 20 --starts 1 --idle 5 --soak 80` measured 16.9 ms maximum
  loop lag across all 4,686 observations (1.04 ms p95 over the last
  3,600). Search, Escape and scroll p95 were 27, 45 and 19 ms. Paused
  CPU/RSS were 0.4%/106 MiB. RSS rose from 93 to 145 MiB during the live
  soak without a captured drop; the earlier longer run showed reclamation,
  but this run alone does not establish a steady-state plateau.

### Final soak and direct-PTY repeat

At `2b90cba` on the same Mac, the 180-second live soak peaked at 130 MiB
and ended at 107 MiB, with multiple drops exceeding 8 MiB. The 90-second
5,000-row fixture soak peaked at 73 MiB and ended at 62 MiB. Paused CPU
was 0.4% live and 0.6% for the fixture; paused RSS was 103 and 97 MiB.
Session-wide worst loop lag was 58 ms live and 57 ms for the fixture.
Live search/Escape/scroll p95 was 28/41/19 ms; the 5,000-row fixture
measured 34/46/19 ms. Every interaction in both runs stayed below 250 ms.

Across twelve direct PTY starts of the already-executed binary, first
frame p95 was 207 ms, populated table p95 was 1,285 ms, and shrink p95
was 25 ms. Those are repeat-launch numbers, not fresh-file acceptance.
The existing source launcher (`./st`) took 545 ms to first frame and
1,592 ms to populate in a single control. It requires Bun and is not a
drop-in replacement for the standalone distribution.

### macOS packaging investigation

After authorization, tested disposable copies on the same Mac with Bun
1.4.4 and the direct PTY harness. The gate remains 500 ms to the first
interactive frame and 2,000 ms to a populated table (both p95). These
small series report nearest-rank p95, which is the maximum in each.

| Fresh artifact | Runs | First frame p95 | Populated p95 |
|---|---:|---:|---:|
| APFS clone of standalone executable | 3 | 2,773 ms | 3,805 ms |
| Bundled JS and worker using preinstalled Bun and existing OpenTUI dependency files | 12 | 809 ms | 1,898 ms |
| Bundled JS, worker and newly copied OpenTUI native assets using preinstalled Bun | 8 | 1,094 ms | 2,151 ms |

The smaller prototypes were not release candidates: the first pointed
to the checkout's OpenTUI dependencies; the second needed the package
directory as its working directory for the relative dylib path. The
second test used that directory only in the disposable launcher, not
as a production fix. Both miss the first-frame target even without
including first launch of Bun itself. Standalone `--bytecode` did not
compile: OpenTUI's top-level await was rejected by Bun's bytecode build.
No valid code-signing identity was available in the current keychain,
so a Developer ID signed/notarized artifact has not been tested.
Nothing was installed or changed in the distribution or OS protections.

### Lazy loading

The TUI now loads page handlers and storage backends on demand, and each
collector worker imports only its requested backend. The first live sample
still starts immediately; the sampling cadence and standalone build are unchanged.

On the same arm64 Mac, three interleaved fresh-copy PTY trials per build
showed no clear first-launch improvement: before 2.45–3.86 s, after
3.39–3.76 s to first frame. The interrupted repeat-launch series was not
large or consistent enough to claim a warm-start gain. The cold-start
target remains unmet.

### Dynamic-loader timing control

After lazy loading, measured `--version` with `DYLD_PRINT_LIBRARIES=1`
on five ordinary copies of the standalone ARM64 executable, followed by
a repeat on each identical path. Both pipes were timestamped with a
monotonic clock from before `subprocess.Popen`, without a TTY.

| Launch | Spawn call returned | First dyld line | Version output |
|---|---:|---:|---:|
| Fresh file (5) | 2.3–3.0 ms | 1,117–1,293 ms | 1,167–1,350 ms |
| Same file again (5) | 2.0–5.3 ms | 2.9–6.2 ms | 44–53 ms |

After the first loader line, version output took 49–57 ms fresh versus
41–50 ms on repeat. Most of the cold penalty precedes the first
observable dyld message, so additional JS lazy loading cannot account
for it. This control does not identify the OS or host policy component
responsible; it does not establish that signing or notarization would help.

### OpenTUI 0.9.2

Upgraded from 0.6.8 without changing TUI code or visual baselines. The
Apple Silicon standalone build, live PTY smoke, and visual suite passed.
Three interleaved fresh-copy PTY trials per version measured 2.96–3.25 s
to first frame on 0.6.8 and 2.88–3.27 s on 0.9.2. The ranges overlap,
and neither version meets the cold-start target.

### Instruments launch trace

Used the existing Xcode Instruments **System Trace** template with
`xcrun xctrace record --template 'System Trace' --time-limit 5s --no-prompt
--output <trace> --launch -- <binary> --version`. Traced a fresh APFS copy
and then the same executable again, with no security settings changed.
In the fresh trace, the target's main thread blocked for **537.13 ms**
and was made runnable by Malwarebytes' `RTProtectionDaemon`, as identified
by the daemon PID's executable path. The first recorded target syscall
followed about **26 µs** after that wakeup. An earlier `syspolicyd` wakeup
followed a roughly **21 µs** block. No target wakeup by `RTProtectionDaemon`
appeared in the repeat trace. This attributes one material pre-start wait
on this host; it does not explain every millisecond across prior runs or
establish how another Mac behaves. No profiling tools were installed.

The captures are local under `~/tmp/st-instruments.PqHJI7/` (`fresh.trace`
and `repeat.trace`). Inspect `thread-narrative` and `syscall` via
`xctrace export --xpath '/trace-toc/run/data/table[@schema="…"]'`.
Raw captures can contain host process metadata and are not committed.

### Second Mac: mbp2023

Ran the same ARM64 binary (verified by SHA-256) on macOS 27.0.1 using
the direct PTY smoke. Each of five APFS copies was launched twice, with
temporary config and no global install or service changes.

| Launch | First frame | Populated table | Shrink |
|---|---:|---:|---:|
| Fresh copy | 1,239–1,485 ms | 2,456–2,746 ms | 18.5–20.1 ms |
| Repeat | 82.5–84.8 ms | 1,284–1,365 ms | 17.7–20.0 ms |

All ten live smokes passed, but the fresh-file startup budgets still
failed. This independently reproduces the first-launch penalty.

A follow-up Instruments 27.2 **System Trace** pair used the same binary
and `--version`. This Instruments version exports wakeups in
`thread-state` rather than `thread-narrative`. The fresh target's main
thread was blocked for 264.52 ms from the trace boundary, then woken by
Malwarebytes' `RTProtectionDaemon`. After 40 µs running it blocked for
another 864.03 ms, ending in a `syspolicyd` wakeup. The first captured
target syscall followed about 36 µs later. The repeat trace had a
pre-launch tool-controlled wait ending in an `xctrace` wakeup; neither
security daemon appeared among its named main-thread wakeups. These
are scheduler observations, not proof of what either daemon checked
or that signing would remove the waits. Both probes exited successfully,
and no security settings changed.

After the operator reported turning off Malwarebytes real-time protection,
repeated the five fresh/repeat PTY pairs on mbp2023 with the same binary
(SHA-256 matched) and harness:

| Launch | First frame | Populated table | Shrink |
|---|---:|---:|---:|
| Fresh copy | 1,282–1,470 ms | 2,503–2,774 ms | 19.7–20.2 ms |
| Repeat | 82.0–86.0 ms | 1,294–1,367 ms | 19.5–19.6 ms |

All ten live smokes passed. The first-frame range overlapped the earlier
1,239–1,485 ms range, and neither fresh-start target passed. This retest
did not independently verify the protection setting or capture a new
trace, so it cannot attribute the remaining delay to a particular daemon.
