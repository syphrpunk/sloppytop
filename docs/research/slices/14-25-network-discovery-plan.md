# Proposed slices 14–25: Local network discovery

Start with a question Sloppytop can answer without sending network traffic:
**What does this machine already know about its network?** Build on
[Slice 04](04-live-network-rates.md), [Slice 11](11-interface-throughput.md),
`net`, and `listen`. Keep the NVIDIA and powercap hardware checks separate.

Discovery in this batch reads local OS state on demand. It does not scan
subnets, open connections to identify services, capture packets, resolve
names externally, or escalate privileges. A neighbor-cache entry is not
proof that a peer is online. A non-loopback bind is not proof of reachability.
Use NetWatch-alt and GPUI Metrics Monitor as presentation references, and
Tasklens as a reference for clear attribution and collector boundaries.
Read relevant source before each implementation; don't adopt its active
collection mechanisms or import code without checking licensing.

| Slice | What to ship | Evidence required |
|---|---|---|
| **14 — Discovery contract** | Add a shared on-demand result schema with source, observation time, platform, and explicit empty, unavailable, partial, and truncated states. Keep existing CLI contracts intact. | Schema fixtures distinguish an empty table from denied access, missing tools, parse failure, and clipping. Check bounded reads and absence of network I/O. |
| **15 — Interface and address inventory** | Show interface names, local addresses/prefixes, loopback and link state where known, plus existing per-interface rates when measured. Preserve IPv6 scope and omit unmeasured rates. | Compare Linux and macOS output with native tools; test dual-stack, multiple addresses, missing attributes, and interface churn. |
| **16 — Routes and default gateways** | Read the current OS route table. Show IPv4/IPv6 default routes and the interface/gateway relationships the OS actually exposes; do not use external reachability tests. | Fixtures cover competing defaults, tunnel routes, on-link routes, and no default. Compare with native output on Linux and macOS. |
| **17 — Neighbor-cache inventory** | Read existing ARP and IPv6 neighbor entries, scoped by interface. Label source and state; expired or incomplete entries must not be shown as online. No cache refresh traffic. | Compare against native cache output; test stale, failed, duplicated, scoped-IPv6, and empty entries. |
| **18 — Local listener bind scope** | Extend local TCP listener inventory with address family, wildcard vs. loopback vs. specific-address binds, and explicit owner visibility. Keep UDP bound endpoints separate if the OS exposes them; do not label them TCP listeners. | Test IPv4/IPv6 wildcard, loopback, specific binds, and hidden owners using fixtures and sockets created by the test suite. Verify existing `listen` compatibility. |
| **19 — Socket ownership and lifecycle** | Improve the `net`/listener view with source-backed PID attribution and connection lifecycle labels. Preserve unknown owners and rate gaps rather than guessing. | Test shared endpoints, process exit/PID reuse, unattributed rows, idle zero and partial visibility. Verify with local test processes only. |
| **20 — DNS configuration inventory** | Show configured resolver and split-DNS settings where exposed by the OS. Separate system resolver configuration from per-interface/domain overrides. Do not issue DNS lookups. | Compare with native settings; test stub resolvers, VPN split DNS, duplicate entries, and missing tooling. Verify no DNS queries are generated. |
| **21 — Local network overview** | Compose interfaces, defaults, cached peers, and local socket counts into a one-shot CLI overview. Keep sources and partial-state labels visible; distinguish traffic on an interface from observations about a peer. | Cross-check counts and join keys against underlying views. Verify a missing provider doesn't blank other sections and that IPv6 scope stays intact. |
| **22 — TUI discovery page** | Render the same overview and drill-downs in the TUI, on demand. Keep numeric addresses by default and show freshness and coverage. | Inspect compiled PTY frames for narrow/wide layouts, denied and partial data, keyboard navigation, and refresh behavior. |
| **23 — Snapshot comparison** | Compare two explicitly supplied local snapshots for observed additions, removals, and changes. Don't imply a peer departed when coverage or collection scope changed. No background inventory history. | Test equal snapshots, rename, cache aging, changed scope, and partial snapshots; verify deterministic output independent of row order. |
| **24 — Shareable summaries** | Add an explicit redacted export that omits raw IPs, MACs, DNS domains and process identities; avoid re-identifiable hashes. Don't publish discovery data to probe logs, SQLite history, OpenMetrics or MCP by default. | Use canaries for each sensitive field and confirm they do not appear in exports, logs, metrics, or default MCP surfaces. Test redaction of errors as well as successful output. |
| **25 — Platform coverage and release check** | Publish the supported-provider matrix, diagnostic guidance for partial visibility, and performance limits. Verify Linux and macOS; document Windows gaps unless tested on a real Windows host. | Run repo tests, type-check, build, compiled CLI/TUI smoke, privacy checks and bounded-read tests with larger fixtures. Verify `record`, `watch`, and the metrics server do not start discovery work implicitly. |

Start with 14, then 15–17 to establish a useful inventory before adding
socket detail and UI. Capture source and privacy semantics with each slice.
Use isolated fixtures and authorized read-only host checks, and checkpoint
each completed slice with its evidence. See the implementation and evidence
notes for [14](14-discovery-contract.md), [15–17](15-17-discovery-inventory.md)
and [18–25](18-25-discovery-workflow.md).
