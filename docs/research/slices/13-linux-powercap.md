# Slice 13: Linux powercap package watts

Siomon (`5647688bdfe011d761b972d8387fa285cd9a4be2`),
`src/sensors/rapl.rs`, discovers RAPL domains under powercap, uses
monotonic elapsed time, and uses the reported counter range on a decrease.
Linux [powercap](https://docs.kernel.org/power/powercap/powercap.html)
reports cumulative `energy_uj` in microjoules. It does not say whether a
drop was a reset or wrap; this collector omits that interval instead of
guessing. No reference code was reused.

The experimental `SLOPPYTOP_POWERCAP=1` setting enables sampling with
the `power` probe. Use explicit `package-N` names from top-level
`intel-rapl:N` zones, excluding auxiliary subdomains and MMIO aliases.
Use each zone's own monotonic interval and unchanged file identity.
Report interval-average watts (`ΔµJ / (1000 × Δms)`), never an
instantaneous hwmon reading. Omit decreases, changed identities,
unavailable readings and intervals over two seconds. Counter changes
invisible between observations cannot be detected. There is no elevation,
permission change or write to powercap. Results appear in live system
output and the power probe log, not the SQLite history.

Fixtures cover exact conversion, measured zero, resets/wrap ambiguity,
domain identity, permissions, and unavailable powercap. The local Apple
Silicon host is not Linux; its unprivileged Linux arm64 container exposes
no `/sys/class/powercap`. The OptiPlex (Intel Core i7-6700, Linux 6.18.43
x86_64) exposes `intel-rapl:0` named `package-0`, but the SSH account
(UID 1000) cannot read `energy_uj`: it is mode `0400`, owned by
`root:root`. No elevation or permission changes were attempted.
Real hardware validation with an unprivileged reader remains open
(`nht-4aa2dd`).

## Real hardware verification

On authorized Linux hardware with readable package counters as the normal
user, record the checkout commit, platform/CPU, zone name, counter units
and range. Capture multiple directly read counter/elapsed-time pairs and
the CLI's `powercap_packages` at idle and with an existing workload.
Compare the watts using the same units and interval; allow variation
between separate sample windows. Save the evidence here.

```sh
git rev-parse --short HEAD
for zone in /sys/class/powercap/intel-rapl:[0-9]*; do
  [ -r "$zone/energy_uj" ] || continue
  printf '%s\n' "$zone"
  head -n 1 "$zone/name" "$zone/energy_uj" "$zone/max_energy_range_uj"
done
SLOPPYTOP_POWERCAP=1 ./st system --format json | jq '.powercap_packages'
```
