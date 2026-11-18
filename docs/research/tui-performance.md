# TUI responsiveness

## Acceptance budgets (before tuning)

Measure in an isolated terminal at the default 1 s refresh and 500 ms counter
window. Keep probes enabled as shipped, record the platform and viewport, and
run the same exercise before and after. These are local interactive budgets,
not performance promises for arbitrary machines and OS providers.

| Observable | Budget |
|---|---|
| Cold start to interactive frame | ≤ 500 ms p95 |
| Cold start to populated, usable process table | ≤ 2 s p95 |
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
