# Slices 26–37: From live monitoring to diagnosis

| Slice | Evidence and status |
|---|---|
| 26 — Recorder health | `service status` separates installation, scheduler state, recorder state, scheduler exit outcome, and age of the latest successful DB insert. Compiled macOS smoke with an isolated config returned no age for an empty DB and age 0 after `record`. A temporary uniquely named launchd agent exited 7; the parser reported an armed scheduler, idle recorder, and failed run with exit code 7. Both parser suites pass. **Open:** verify systemd on a Linux host with an active user manager, including a temporary failing oneshot; fixture results alone do not close this slice. `orb list` returned no guests, local Incus has no server, and the Lima `buildkit` VM is stopped. |
| 27 — History gaps | CLI coverage annotates long intervals as `boot-change-observed` when adjacent Linux samples have different recorded boot IDs, or `unknown` otherwise. A change does not establish the cause of the entire gap. No boot IDs are output. A current failed job is not timestamped evidence about a past interval. Coverage tests distinguish gaps, missing readings and measured zero. |
| 28 — Window comparison | `report --compare --hours N` compares adjacent half-open windows, showing sample counts, occupied hourly slots, and sampled deltas. Tests cover boundary rows, both-empty, unequal, equally sparse and comparable coverage. Compiled smoke with only a current sample emitted `insufficient` and omitted deltas. |

Run `just test`, `just ts-check`, and `just build`. On macOS ARM64 the
initial diagnostics changes passed 294 tests, with one Linux-only skip.
Next: add the supporting measurements and thresholds for Slice 29; revisit
the Linux scheduler gate independently.
