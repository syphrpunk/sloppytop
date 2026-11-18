# sloppytop — changelog

User-facing changes. Follows [Keep a Changelog](https://keepachangelog.com/) loosely.

The `handoff-create --changelog` flow appends entries to "## Unreleased" as you go. Release tagging is manual.

---

## Unreleased

- Removed the Go sources in `cli/` and the `.augment` skill links. `just build` compiles `ts/dist/sloppytop`. CI tests and builds the TypeScript CLI only.
- `service install` stores one sample before it returns, then starts the hourly recorder. `sloppytop history`, `sloppytop report`, and `v` on the screen read that sample.
- The Linux recorder timer starts 5 seconds after the user service manager (`OnStartupSec=5s`, `AccuracySec=1s`).
- `Casks/sloppytop.rb` is a Homebrew cask for the v0.3.0 Apple Silicon binary. `brew tap syphrpunk/sloppytop https://github.com/syphrpunk/sloppytop` and then `brew install syphrpunk/sloppytop/sloppytop` stores one sample and starts the hourly recorder.
- Linux temperature readings include critical limits and headroom when the same hwmon sensor reports a valid `tempN_crit`.
- TUI history charts show more recorded signals, plot network rates as stored, and retain gaps for missing readings.
- Linux samples include kernel OOM kills since boot when available. Reports flag increases across adjacent same-boot samples separately from memory pressure.
- `history --charts` compares recorded throughput, IOPS, and interval-average latency for up to four disk device names.
- TUI history (`v`) has a disk comparison tab (`d`); left and right switch metrics.
- Host network rates use monotonic elapsed time. Missing or reset counter intervals are omitted instead of reported as idle; previously recorded values are unchanged.

## 0.3.0 - 2026-10-23

### Added

- `./st` runs this checkout's TypeScript CLI. `./sloppytop` is the same command.
- `sloppytop tui` opens the process monitor on OpenTUI. It shows CPU, memory, disk, and network with braille history, and a process table you can search, sort, pin, and pause. Kill asks before it signals.
- The screen also draws memory composition, page rates, per-device disk, load and host, package watts, GPU, temperatures, fans, thermal state, pressure, battery, and swap when the sample includes them. A missing reading is left off the strip. A measured zero stays zero. Thermal state is the name, not a gauge. Package watts are not added together.
- On the screen, `e` shows a process environment, `o` shows open files, `n` shows connections, `l` shows listeners, and `h` shows the hardware inventory. Those pages sample only while they are open. Hardware re-reads on `r` and otherwise uses the cache. The probe log still stores counts and flags, not paths, environment values, or addresses.
- On the screen, `v` shows history sparklines, `w` shows the report, `b` shows the probe log, and `a` records one sample. `m` opens settings for probe switches and the metrics listener. The listener stays off until that switch, binds like `metrics serve`, and stops when the screen quits. `service install` stays a command. The screen can show whether the hourly recorder is installed.
- The screen draws a labeled system band, a ruled process table, and a footer with the host and the selected process. Theme colors mark the section labels, the selected row, and the toolbar. A wide terminal gives each probe its own box: cpu, memory, disk, and network always, and power, gpu, sensors, pressure, battery, swap, and host when that sample has a reading. Each reading is its own labeled row, including when the box is wide enough to fit two. Per-core sparklines stay in the cpu box. A short terminal keeps one system band so the table stays on screen. A page replaces the band while it is open. Process detail lists the measured process fields. The toolbar names the process, connections, listen, and hardware pages.
- The compiled release binary `sloppytop` includes `sloppytop tui`. Release assets cover macOS Apple Silicon, Linux x86_64, Linux arm64, and Windows. An Intel Mac runs `./st` from a checkout.
- Monitoring probes can be turned on or off with `probe enable` and `probe disable`. An off probe is left out of command output, `probes.jsonl`, and the scrape. `log` prints the recent probe lines. Process command lines and environment values are not written there.
- `metrics enable` and `metrics serve` expose `GET /metrics` as OpenMetrics text for a Prometheus or Grafana scrape. The listener stays off until it is enabled, and it binds to `127.0.0.1:9464` unless config says otherwise.
- System stats include memory composition, page and compression rates, and P/E core labels when the platform measures them. Disk devices include average request size, and on Linux the merge rate.
- Temperatures, fan speeds, and the macOS thermal state are included when a public sensor reports them. Thermal state is not a temperature limit. `record` stores these host series.
- On macOS, process rows include `idle_wakeups_per_s` and `owning_app` when those can be read. Neither is stored by `record`.
- `proc --files` lists open files for one process. `listen` lists local TCP sockets in LISTEN.
- Hardware inventory includes CPU feature flags when the platform lists them.
- On macOS, system stats include GPU utilization and in-use GPU memory when AGX PerformanceStatistics is present. Process rows include `phys_footprint_bytes` when the rusage read succeeds.
- Every command appends one line to the event log.
- CI tests the Go sources and builds the TypeScript CLI on every push and pull request. The release uploads `sloppytop` only.

### Changed

- The TypeScript CLI uses `@opentui/core` 0.6.8, incur 0.7.1, and TypeScript 7.0.2.

- The project name is Sloppytop. The installed binary is `sloppytop`. The release does not upload `sloppytop-cli`. `just build` still writes that binary locally from `cli/`.
- An existing `~/.config/neohtop` directory, including `neohtop.db` and `neohtop.log`, stays in use until the new directory and files exist. The Go TUI does the same for `~/.config/neohtop-cli/config.json`.
- `service install` and `service uninstall` also remove the previous launchd agent `com.syphrpunk.neohtop.record` and the systemd units `neohtop-record`.
- OpenMetrics gauge names use the `sloppytop_` prefix.

---
