# Slice 11: Live interface throughput

GPUI Metrics Monitor's `src/metrics/system.rs` refreshes its interface
inventory and forgets disappeared interfaces. NetWatch-alt's
`src/ui/connections.rs` presents receive and send separately for connections;
Sloppytop applies that presentation to interface counters, not to packet
capture or individual flows.

`system` and live snapshots expose `network_interfaces` under the network
probe. Each direction requires a valid baseline; an idle direction is zero
and an unavailable direction is omitted. Renames and first sightings prime
a new baseline. The strict host aggregate still requires a matching
interface set and valid counters in that direction. Values are not persisted
in SQLite or the probe log and do not add scrape series. Interface names
are not durable IDs.

Fixtures cover first sight, reset, rename, removal and idle zero. Live
unprivileged Linux arm64 reported `eth0` with 0 RX and 170 TX bytes/s;
macOS exposed live rates with matching interface names in `netstat -ibn`.
