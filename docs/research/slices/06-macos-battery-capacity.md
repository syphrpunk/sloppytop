# Slice 06: macOS battery capacity context

WhatBattery snapshot `77958857edbc41c8ac33db8b3cfb6c00597ab7c9` (ZIP
comment): `AppleSmartBatteryReader.swift` reads IOKit natively, using
top-level values and nested fallbacks. `AppleSmartBattery.swift` distinguishes
nominal and raw maximum capacity in mAh from the normalized `MaxCapacity`.
Its full-charge estimate prefers nominal capacity on the Mac SMC path and raw
capacity on the PMU path. No reference code was reused.

Sloppytop's on-demand inventory reports top-level `DesignCapacity` and
`AppleRawMaxCapacity` in mAh when available, without treating either
`MaxCapacity` or nominal charge capacity as a fallback for the raw reading.
The OS health percentage and cycle count still come from `system_profiler`.
Some OS versions or hardware expose neither raw field at the top level;
missing raw readings do not remove the OS health data. `hardware --refresh`
updates old caches. The recorder does not query the inventory:
scheduled services continue to invoke `record`.

Verified on an Apple Silicon Mac: `hardware --refresh` showed 5760 mAh
design, 4456 mAh raw maximum, 80% OS maximum and 495 cycles. The raw ratio
was about 77%, so substituting it would change the OS number. A subsequent
cache read retained the new fields. A compiled `record` in an empty config
directory wrote a sample without creating an inventory cache. Service unit
tests verify the scheduled arguments run `record`; no job was installed.
The macOS suite passed 252 tests, plus type-check, build and TUI smoke.
