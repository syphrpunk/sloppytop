# Slice 05: Linux hwmon electrical readings

Read `siomon-main.zip` (`5647688bdfe011d761b972d8387fa285cd9a4be2`, archive
comment), `src/sensors/hwmon.rs`. Siomon discovers chips and channels by
filename, prefers a label override then the driver's `_label`, disambiguates
duplicate chip names, and can apply board-specific voltage multipliers. It
can use `powerN_average` as a fallback for `powerN_input`. No code was reused.

Sloppytop uses the [Linux hwmon sysfs ABI](https://docs.kernel.org/hwmon/sysfs-interface.html):
read `inN_input` in millivolts, `currN_input` in milliamps, and instantaneous
`powerN_input` in microwatts. Use the driver's label when present and show
the hwmon channel separately so duplicate names are not conflated. Skip
unlabeled voltage channels rather than assigning a rail or guessing a
resistor-divider correction. Report labeled voltages as kernel readings,
not independently calibrated board rail voltages. Skip malformed/unavailable
values, limits and average-only power channels. Zero and signed readings
are retained. The collector never writes to sysfs.

Readings are under the `sensors` probe in live system output, the probe log,
and live OpenMetrics. Omit the list and metric families when unavailable.
`hwmonN` identifiers are not durable; these readings do not enter SQLite
history. The Linux arm64 smoke used an unprivileged Apple container whose
sysfs did not expose electrical sensors; a fixture exercised discovery,
omission, label handling, converted values and the live metric families.
