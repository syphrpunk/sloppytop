# 18–25 — Socket, resolver, and discovery workflow

## Usage

```sh
sloppytop discover
sloppytop discover --section listeners
sloppytop discover --section connections
sloppytop discover --section dns
sloppytop discover --format json > before.json
# At a later time, explicitly collect a second observation:
sloppytop discover --format json > after.json
sloppytop discover --before before.json --after after.json
sloppytop discover --redact --format json
```

Press **D** for discovery in the TUI, **←/→** for overview and detail tabs,
**↑/↓** to scroll, **r** to refresh and **Esc** to close. The view uses
numeric addresses. Collection occurs only when opened or refreshed.

## Provider matrix

| Section | Linux | macOS |
|---|---|---|
| Interfaces | `ip -j address show`, `/proc/net/dev` | `ifconfig -a`, numeric `netstat -ibn` |
| Routes | numeric `ip -j -4/-6 route show table all` | numeric `netstat -rn` per family |
| Neighbors | `ip -j neigh show` | numeric `arp -an` and `ndp -an` |
| Listeners and connections | numeric `ss`, per transport and family | numeric verbose `netstat`, per transport |
| DNS configuration | `/etc/resolv.conf`; `resolvectl dns` and `resolvectl domain` when available | `scutil --dns` |

Windows has no discovery providers in this batch; the existing `listen`
and `net` contracts are unchanged. Linux requires iproute2 for `ip` and
`ss`. A resolver stub and its optional split configuration are distinct
sources; absence of `resolvectl` does not hide `/etc/resolv.conf`.
`resolvectl` reads configuration, not DNS answers.

## Interpretation and privacy

Reviewed NetWatch-alt's `src/ui/connections.rs` for coverage and rate
presentation and Tasklens's `net/socket_map.rs` and `net/attribution.rs`
for socket identity and unknown or shared ownership. Sloppytop does not
walk arbitrary process files or adopt active collectors. The new
`discover --section connections` and `--section listeners` provide the
coverage-aware counterparts to legacy `net` and `listen`; those
commands' payloads are unchanged.

- TCP LISTEN and UDP bound endpoints are separate. Bind scope is not
  reachability or firewall status. A dual-stack Darwin row counts once.
- Report owners only from the OS dump. A nonempty PID list does not prove
  that all holders were visible. Only the same socket cookie or generation,
  endpoint and observed owner set can supply a rate baseline. Zero is a
  measurement; reset, missing counter, and missing baseline are not.
- Overview rolls up visible rows, not inferred hosts. Cached peers can
  be stale, failed, incomplete, or expired. An interface's rate says
  nothing about a particular peer's traffic.
- Snapshot comparison reads two explicit local JSON exports (4 MiB each);
  it is not a saved timeline. Hostname and, on Linux, boot and network
  namespace markers bound the comparison. The macOS hostname is not proof
  of identity across different hosts. Changed provider/scope or partial
  coverage suppresses differences in that section. Cache removal is an
  observation change, not proof of departure. Transient rates are not
  compared.
- A regular snapshot contains raw local network data. Use `--redact` to
  produce counts and coverage enums only; it excludes host scope, raw
  provider text, IPs, MACs, domains, interfaces and process identities.
  Raw discovery is not appended to the probe log, SQLite or OpenMetrics,
  and the `discover` command is excluded from MCP. `record`, `watch`, and
  the metrics server do not call discovery.

## Troubleshooting and performance

`empty` indicates a successful zero-row read; `unavailable` indicates no
usable data; `partial` means some rows are usable; `truncated` means a byte
or row cap was reached. A missing tool, denied access, timeout, malformed
input, or unknown owners has an explicit issue code. Use the local tool
for that provider in the same namespace and as the same user; do not
elevate to make counts look complete.

Each native command is bounded to 1.5 seconds and 512 KiB; provider output
is limited to 4096 rows. Interface and connection rates use a short
150 ms sampling window when a baseline exists. Multiple independent
providers can take longer than one timeout. There is no background
discovery cadence or automatic snapshot persistence.

## Acceptance evidence

| Slice | Artifact or observed verification |
|---|---|
| 18 | `sockets.test.ts`: bind family and scope, hidden and shared owners, separate UDP, live loopback fixture; existing `listen` tests and command matrix still pass. |
| 19 | `sockets.test.ts`: shared PIDs, independent zero/reset directions, process exit and PID reuse with a different cookie; local test socket on macOS and Linux with native providers. |
| 20 | `dns.test.ts`: stub and duplicate resolvers, VPN split configuration, unsupported platform. macOS `scutil --dns` and Linux `/etc/resolv.conf` matched the providers. Configuration-only command list, no resolver API. |
| 21 | `overview.test.ts`: counts, interface join, scoped IPv6 and isolated denied provider. Both platforms returned compiled CLI overviews. |
| 22 | `tui/frame.test.ts`: denied/partial fixtures at 56 and 110 columns, scoped numeric text, refresh and close. `smoke-discovery.py`: compiled PTY at 58 and 112 columns, navigation and refresh, plus a compiled fixture showing denied and partial coverage. |
| 23 | `overview.test.ts`: equal snapshots, rename, cache aging, changed scope, partial coverage and order independence. `smoke-discovery.py`: bounded malformed snapshot error. |
| 24 | `overview.test.ts`: IP, MAC, DNS, interface, host and PID canaries. `smoke-discovery.py`: compiled redacted output and sanitized errors; no discovery output in record/watch/history/probe log/HTTP metrics; direct MCP catalog and progressive lookup exclusion. |
| 25 | `provider.test.ts`: oversized files and rows; provider matrix above; full macOS and Linux type-check, test and build; compiled CLI/TUI smoke. No Windows support claim. |

Linux arm64 `strace -f -e trace=network` observed no AF_INET or AF_INET6
socket creation on the overview, DNS configuration, or connection
discovery paths. Netlink and Unix sockets used by native tools are local
OS interfaces, not network probes.

Final validation: 280 tests passed on macOS with one Linux-only skip,
and all 281 passed on Linux arm64 as UID 1000. Type-check and compiled
build passed on both. macOS also passed the standard TUI smoke and the
compiled discovery PTY, export/comparison, log, HTTP metrics and MCP
smoke. Linux exec tracing confirmed `record` and `watch` did not launch
discovery providers; the compiled macOS scrape returned ordinary sampler
metrics only, with no discovery providers on the scrape call path.

Reproduce the compiled discovery smoke on Linux or macOS:

```sh
just build
(cd ts && bun build --compile discovery-pty-fixture.ts --outfile dist/discovery-pty-fixture)
python3 ts/smoke-discovery.py ts/dist/sloppytop ts/dist/discovery-pty-fixture
```
