# Sloppytop reference corpus: `_repos/new`

Reviewed 2026-11-18 against `bc5ca20` and the in-progress working tree. Two Luna and two Terra subagents covered **all 77 ZIPs** in four disjoint ranges. This was a static triage: member listings, bounded README/license reads, and selected source excerpts. No archive was extracted, executed, or fetched. License observations are not a provenance, per-file, or dependency audit. Treat these projects as design references; nothing was cleared for direct import.

## Recommended sequence

| Priority | Idea and reference | Sloppytop gap and guardrail |
|---|---|---|
| 1 | **Explain Linux memory pressure and OOM** — Headroom (`src/collect.rs`) and Below. | PSI and pressure reporting already exist. Add context for readable OOM event counters or recent interventions, distinguish pressure from actual kills, and omit unavailable providers. Don't assume systemd-oomd or journal access. |
| 2 | **Keep gaps distinct from zeros in rate histories** — GPUI Metrics Monitor (`src/metrics/system.rs`). | Review `ts/src/monitor/index.ts` and the history/TUI path: baseline missing, counter reset, unavailable measurement, and measured zero should stay distinct. Start with regression tests; don't copy from this archive (license not established). |
| 3 | **Compare disk devices in history** — iodyne (`src/collect/storage.rs`, `src/collect/io.rs`). | Sloppytop already samples per-device IOPS and interval-average latency. Start with comparative views and stable device labels; don't imply true latency distributions or add privileged tracing. |
| Later | Read-only hwmon voltage/current/power (Siomon); bounded optional NVIDIA collector (Tasklens); better macOS battery-health context (WhatBattery). | Require verified units and labels, no auto-elevation, and unavailable readings stay absent. Keep vendor dependencies optional; separate derived battery health from the OS-reported value. |

Keep active scanning, packet capture, remote administration, fan control, cleanup, and profilers out of this first pass. Treat unknown, restrictive, or mixed licensing as a stop for code reuse until verified. `netwatch-alt.zip` and `NetWatch-main.zip` are distinct projects; so are `vitals-gpui.zip` and `Vitals-main.zip`. The two Thermo archives share an archive root but are different snapshots; their ordering and terms were not verified.

## Deep dives

- [01 — Sampling gaps, idle rates, and counter resets](slices/01-sampling-gaps.md): three source snapshots compared; reproduced incorrect RX history and dropped chart slots.
- [02 — Linux memory pressure versus OOM kills](slices/02-linux-memory-pressure-and-oom.md): Headroom and Below compared; host kernel counter implementation scoped.

## Archive inventory

| Archive | Purpose / platform | Observed license | Disposition |
|---|---|---|---|
| `agtop-master.zip` | Agent-aware process discovery/containment; Windows/Linux, CLI/library/HTTP/desktop | No root license entry observed | **Defer**: relevant process attribution idea, but provenance/terms unclear; containment and local HTTP widen scope. |
| `airprowl-main.zip` | Wireless discovery scanner (Wi-Fi/Bluetooth/Sub-GHz), Linux | MIT (README badge; LICENSE present) | **Skip**: wireless scanning not a monitor feature; potentially sensitive scanning. |
| `anemll-profile-main (1).zip` | Core ML/Apple Neural Engine model profiler; Apple platforms | LICENSE present (not inspected in detail) | **Skip**: specialized model profiling, outside system-monitor scope. |
| `asterism-dev.zip` | AI agent session/process/container visualization; macOS, Windows untested | LICENSE present (not inspected in detail) | **Inspiration**: session-level grouping and resource attribution; provenance/license details should be verified before reuse. |
| `below-main.zip` | Live and historical Linux system/cgroup/PSI monitor, record/replay and exports | LICENSE present (not inspected in detail) | **Inspiration**: history/replay and pressure/cgroup UX; Linux-specific. |
| `blitzclean-main.zip` | macOS resource monitor plus storage cleaner | MIT (README badge; LICENSE present) | **Skip**: cleaner/remediation privileged/destructive scope is not appropriate to port. |
| `colima-gpui-main.zip` | Colima/container management GUI; macOS/Linux | LICENSE present (not inspected in detail) | **Skip**: container administration rather than monitoring. |
| `computer-state-main.zip` | Tray monitor/API/Prometheus endpoint, macOS/Windows/Linux, SQLite history | LICENSE present (not inspected in detail) | **Inspiration**: local metric endpoint/history; overlaps existing metrics/reporting and API surface. |
| `coolant-main.zip` | Diagnoses heat/resource costs around coding-agent workloads (README) | LICENSE present (not inspected in detail) | **Defer**: potentially relevant attribution, but inspected README excerpt insufficient to characterize implementation/platform; verify provenance and licensing. |
| `cwelux-main.zip` | macOS tmux session manager; Linux HTTP companion | No root license entry observed | **Skip**: unrelated; companion exposes session data over bearer-token HTTP without TLS (README describes private-network restriction). |
| `disktree-main.zip` | Disk-space treemap explorer; macOS/Linux | MIT (LICENSE) | **Inspiration**: treemap/category visualization; destructive trash/delete workflow and macOS/Linux scan specifics make direct adoption unsuitable. |
| `edgecontrol-main.zip` | Native customizable macOS dashboard/widgets | MIT (LICENSE) | **Inspiration**: dashboard composition only; SwiftUI desktop app unlike terminal UI. |
| `fleet-main (1).zip` | SSH fleet CPU/RAM/GPU/disk monitor; Linux/WSL/macOS hosts | MIT (LICENSE) | **Defer**: compelling remote-host overview, but streams shell collection over SSH; materially broader security/config surface. |
| `flow-main.zip` | Terminal real-time network-throughput monitor; cross-platform claims | MIT (LICENSE) | **Inspiration**: throughput graph/UI and non-TTY output behavior; local net collector already exists. |
| `fsearch-mac-master.zip` | macOS filesystem index/search with FSEvents/headless CLI | GPL-2.0-or-later (README and LICENSE) | **Skip**: unrelated and copyleft terms require separate legal review. |
| `gpui-metrics-monitor-main.zip` | Windows CPU/memory/GPU/network/disk dashboard, GPUI | Unknown (no license file listed) | **Inspiration**: unavailable values, separate collector thread, rate-counter reset handling; no license means no code adoption. |
| `gpur-main.zip` | GPU terminal monitor; Linux/macOS/Windows, multiple vendors | MIT (LICENSE) | **Inspiration**: GPU backend/parsing concepts; README says real-hardware coverage limited and most backends unvalidated. |
| `gputaskman-main.zip` | Per-process GPU activity/memory/model attribution; Windows/Linux/WSL/macOS Apple Silicon | MIT (LICENSE) | **Defer**: potentially valuable GPU attribution; OS/vendor introspection complexity and claims need independent verification. |
| `gtop-main.zip` | Native macOS system/process monitor with history, GPU, ports | MIT (LICENSE) | **Inspiration**: process detail/history UX and sampling semantics; substantial overlap, native GPUI/Rust not reusable in TS TUI. |
| `headroom-main.zip` | Linux RAM, CPU and GPU monitor | MIT | **Inspiration:** pressure explanations, OOM history and adaptive collection; overlaps existing counters. |
| `HealthyMac-main.zip` | macOS Apple Silicon disk cleanup and AI inventory | GPL-3.0 | **Defer:** APFS-exclusive-space reporting is interesting, but cleanup is outside monitor scope; avoid copying GPL code without license review. |
| `iodyne-master.zip` | Linux/macOS storage I/O TUI | MIT | **Inspiration:** device topology and comparative I/O views extend existing device metrics. |
| `kestrel-main.zip` | macOS/Linux system monitor and process supervisor | MIT | **Defer:** managed-process supervision expands scope beyond observation. |
| `lazymacfan-master.zip` | macOS Bun/TS fan monitor and controller | MIT | **Defer:** relevant stack, but persistent hardware control and privileged helper add safety and maintenance obligations. |
| `linstress-main.zip` | Linux stress testing and hardware tuning | MIT | **Skip:** workload generation and tuning are outside monitor scope and can require root. |
| `longbridge-lite-main.zip` | macOS/Linux/Windows market-data desktop client | Apache-2.0 | **Skip:** desktop market client, not a system monitor. |
| `mac-monitor-main.zip` | macOS security-event and malware-triage monitor | BSD-3-Clause | **Skip:** defensive security specialization requires a system extension and Full Disk Access; poor fit for a general CLI monitor. |
| `mlxtop-main (1).zip` | macOS/Linux/Windows local-LLM performance monitor | MIT | **Inspiration:** correlate measured runtime telemetry with system pressure; optional specialization. |
| `naabu-dev.zip` | Port scanner; cross-platform CLI (README) | MIT | **skip** — active network probing is outside passive local diagnostics. |
| `nanomon-main.zip` | Compact activity monitor / graph suggestion UI; macOS/Linux | MIT | **inspiration** — `src/sample*.zig`, `src/model.zig`, `src/graff.zig`; passive metric sampling, but Sloppytop already has `ts/src/sample.ts`, `monitor/`, TUI. |
| `neko-master-main.zip` | Network traffic auditing/multi-gateway; README summary | MIT | **skip** — network appliance/control rather than local monitor; not enough bounded evidence for safe transfer. |
| `netkeep-main (1).zip` | Linux per-process connection allow/deny/routing agent | GPL-3.0 | **skip** — enforcement/proxy and privileged packet interception, not passive monitor; copyleft also incompatible absent deliberate decision. |
| `netmap-main.zip` | Browser map of outbound connections; Windows/macOS/Linux | MIT | **defer** — `netmap.py`; potential visualization, but geolocation/browser/server flow adds complexity and external-data/privacy concerns; current `ts/src/monitor/net.ts`, `listen.ts` already report network. |
| `netwatch-alt.zip` | Terminal network diagnostics/process attribution, multi-platform | MIT | **inspiration** — `src/collectors/{connections,process_bandwidth,health}.rs`, `src/ui/{connections,processes,stats}.rs`; useful network diagnostic UX/attribution, but substantial overlap with `ts/src/monitor/net.ts`, `listen.ts`, `tui/`. Some capture/diagnosis facilities require elevated capabilities; prefer passive connection/stat collection only. |
| `NetWatch-main.zip` | LAN-wide traffic map/alerts, Linux/Raspberry Pi | MIT | **skip** — mirrored-port monitoring and network-wide collection require privileged/network infrastructure, beyond local diagnostics. |
| `nvtop-master.zip` | GPU process monitor; Linux and other GPU backends | GPL-3.0 (COPYING) | **inspiration** — `src/extract_gpuinfo*`, `src/extract_processinfo*`; backend-specific GPU attribution/per-vendor discovery ideas. Sloppytop has `ts/src/monitor/gpu.ts`; retain platform collector boundary; GPU device interfaces may need elevated/device access. Avoid copying GPL code. |
| `orbit-disk-main.zip` | Visual disk-usage map; macOS 14+ | license unknown (no root license observed in listing) | **inspiration** — `README.md`, `apps/`; treemap/interactive drilldown idea. Existing `ts/src/monitor/disk.ts` covers metrics, not directory-size visualization; directory traversal is passive but potentially expensive and accesses user files. |
| `osquery-master.zip` | SQL OS instrumentation framework; Linux/macOS/Windows | Apache-2.0 OR GPL-2.0-only (root LICENSE) | **defer** — broad schema/query model could inspire future declarative probes, but large scope/dependencies and existing `ts/src/monitor/` collectors; query plugins/capabilities introduce security/privilege risk. |
| `oxi-pulse-main.zip` | Host-metrics agent exporting OTLP; Linux/Windows | Apache-2.0 | **defer** — `src/metrics/collector.rs`, `src/telemetry/exporter.rs`; useful metric/export architecture, but Sloppytop already has `ts/src/store/openmetrics.ts` and metrics commands; remote telemetry is not a default passive-local feature. |
| `process-viewer-main (1).zip` | Process/system monitor GUI; Linux, Raspberry Pi, macOS, FreeBSD, Windows | MIT | **inspiration** — `src/display_procs.rs`, `display_sysinfo.rs`, `display_network.rs`, `graph.rs`; multi-platform process/network graph presentation; substantial overlap with `ts/src/tui/` and `monitor/`. |
| `procmon-main.zip` | Desktop process/system monitor plus disk recovery/storage tools; macOS apparent from Swift app and README | license unknown (no root license entry in inspected listing) | **defer** — `src/system/{monitor,sampler,snapshot,network}.rs` offers sampler/snapshot concepts; existing `ts/src/sample.ts` and collectors cover core. Avoid recovery/cleanup/action capabilities; interactive quitting/stack inspection adds privileges and scope. |
| `rano-main.zip` | Network observer for AI CLI processes; platform not verified in bounded README | unusual custom MIT rider restricting OpenAI/Anthropic use | **defer** — `src/pcap_capture.rs`, `src/config_validation.rs`; process-attributed socket observation can inform `ts/src/monitor/listen.ts` and process display, but scope-specific and capture may need elevated privileges. License rider is a serious adoption constraint; don't reuse code without legal review. |
| `samply-main.zip` | Sampling CPU profiler; macOS/Linux/Windows | MIT and Apache-2.0 | Defer — useful profiling, but substantially beyond process monitoring; perf permissions matter. |
| `sdrtop-main.zip` | SDR instrument TUI; Linux, unofficial macOS | GPL-3.0-or-later | Skip — radio instrumentation is outside scope. |
| `sensors_cmdline-main.zip` | M1/iPhone temperature, voltage and current sensors | BSD-3-Clause | Inspiration — HID sensor discovery; macOS temperature collection already exists. |
| `siomon-main.zip` | Linux hardware and sensor monitor | MIT | Inspiration — broader hwmon readings and labeling; see below. |
| `smalltv-mac-monitor-main.zip` | Mac metrics for a Wi-Fi display | PolyForm Noncommercial 1.0 | Defer — specialized display and restricted license. |
| `squirreldisk-main.zip` | Disk-space explorer; macOS/Linux/Windows | AGPL-3.0 | Defer — adjacent utility, not live process monitoring; copyleft review needed. |
| `streamtop-main.zip` | Video-stream health TUI; platform unspecified in excerpt | MIT | Skip — stream diagnostics, not host monitoring. |
| `sysglance-master.zip` | Linux sensor dashboard, optional privileged helper | MIT and Apache-2.0 | Inspiration — explicit source and unavailable-reason presentation; avoid silently widening RAPL access. |
| `sysinfo-main.zip` | Cross-platform Rust system-information library | MIT | Inspiration — platform collector reference; replacing Bun collectors adds native maintenance. |
| `sysly-main.zip` | Apple Silicon system monitor | MIT | Inspiration — bounded history and sample-driven redraw; GUI is not a direct fit. |
| `sysman-main.zip` | Linux monitoring daemon and history GUI | MIT | Inspiration — durable crash history and isolated collection; overlaps existing recording. |
| `sysmon-main.zip` | Native system monitor; desktop and mobile | MIT | Defer — broad GUI/mobile scope overlaps existing collectors. |
| `system-pulse-main.zip` | Desktop monitor, notably Windows GPU and thermals | GPL-3.0 COPYING and Apache-2.0 license present; scope needs verification | Inspiration — unavailable/stale sensor states; Windows thermals require authorized helper and driver. |
| `sysvitals-main.zip` | Windows taskbar/macOS menu-bar monitor | MIT | Defer — compact presentation, but existing CLI already records metrics. |
| `szt-main.zip` | macOS disk-usage tree | MIT | Defer — careful scan semantics are useful but disk inventory is adjacent scope. |
| `tasklens-main.zip` | Linux task manager and hardware monitor | MIT | Inspiration — isolate NVML failures; see below. |
| `Thermite-main.zip` | Linux laptop thermal and fan control | MIT | Defer — read-only sensor ideas only; privileged fan control has safety and hardware-support costs. |
| `thermo-main-2.zip` | macOS thermal/fan/power monitor and controls | Unknown; no root license found | Defer — no code adoption without license clarity; root helper for fan control. |
| `thermo-main.zip` | Same named macOS thermo project, different snapshot | Unknown; no root license found | Defer — same qualification; do not assume snapshots are identical. |
| `tidegauge-main.zip` | macOS menu-bar and process monitor | MIT | Inspiration — battery and IOReport sources, subject to API stability. |
| `tinyjsapp-main (1).zip` | Cross-platform JS desktop-app framework | MIT | Skip — alternative GUI runtime, not a monitor feature. |
| `tokenmeter-main.zip` | AI-agent token and cost dashboard; macOS/Linux/Windows | MIT | Skip — different monitoring domain. |
| `top-main.zip` | Apple Silicon system monitor | Unknown; no root license found | Defer — overlaps existing metrics; license unclear. |
| `traffic-ctrl-main.zip` | Per-process network monitor; macOS/Linux | Unknown; no root license found | Defer — interesting traffic attribution, but incomplete Linux UDP and unclear license. |
| `vitals-gpui.zip` | SSH remote-host monitor with agent; agent targets Linux/macOS/Windows | Apache-2.0 | Defer — remote operation adds host-key, deployment and protocol responsibilities. |
| `Vitals-main.zip` | Local Apple Silicon system monitor, not the SSH project above | GPL-3.0 | Inspiration — sensor and health presentation; licensing and privileged-helper review before reuse. |
| `watt-main.zip` | macOS power and cost monitor | MIT | Defer — root `powermetrics` daemon is significant operational cost. |
| `whatbattery-main.zip` | macOS battery health and power monitor | MIT | Inspiration — battery health semantics; see below. |
| `whatcable-main.zip` | macOS USB-C cable and charging diagnostics | MIT default; subdirectory licenses may override | Defer — specialized hardware scope; verify individual subtree terms. |
| `whatport-main.zip` | macOS USB-C/Thunderbolt port monitor | MIT | Defer — specialized port diagnostics beyond core monitor. |
| `wstrace-main.zip` | Windows process/API tracing | GPL-3.0 | Defer — tracing is a distinct diagnostic feature, with elevated system-wide mode. |
| `Xenon-main.zip` | Second-screen control dashboard; Windows/macOS/Linux | Custom noncommercial | Skip — scope and license restrictions. |
| `xprof-master.zip` | ML workload profiler; platform unspecified in excerpt | Apache-2.0 | Skip — model profiling rather than host monitoring. |
| `yscan-main.zip` | Network discovery and port scanning; macOS/Linux | Apache-2.0 | Skip — active scanning, classified only. |
| `Zoomit-Mac-main.zip` | macOS screen zoom, annotation and capture | MIT | Skip — unrelated presentation utility. |
