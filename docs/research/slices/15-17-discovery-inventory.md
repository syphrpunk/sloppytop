# 15–17 — Interfaces, routes, and cached neighbors

Reviewed Tasklens `src/net/addrs.rs` and `netns.rs` for scoped addresses
and on-demand boundaries, GPUI Metrics Monitor `src/metrics/system.rs`
for disappearing interfaces, and NetWatch-alt `src/collectors/health.rs`
as a contrast: its active reachability probes are not adopted here.
No reference code was reused.

`discover --section interfaces` reads `ip -j address` or `ifconfig -a`.
It clips native output, preserves IPv6 scope, and uses the existing
interface delta logic over a short local counter interval. An absent
rate is omitted. `--section routes` reads separate family tables
(`ip route show table all`, `netstat -rn`) and preserves competing
defaults and on-link routes; the result does not pick a winning route.
`--section neighbors` reads the existing `ip neigh`, `arp -an`, or
`ndp -an` cache. State labels are OS observations, never a claim that a
peer is online. No refresh packets, external DNS or elevation.

On macOS, direct native output and the CLI showed 21 interfaces
(including `lo0`), numeric IPv4/IPv6 routing tables, and ARP/NDP cache
rows. The Linux arm64 guest, UID 1000 with iproute2, showed two
interfaces, both route tables, and an empty neighbor cache. No traffic
was sent to populate that cache. Fixtures exercise scoped dual stack,
multiple addresses, missing link attributes, competing defaults, tunnel
and on-link routes, stale/failed/expired and duplicate cache entries.
