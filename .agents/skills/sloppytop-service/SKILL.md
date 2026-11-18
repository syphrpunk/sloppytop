---
name: sloppytop-service
description: Manage the hourly metrics recorder (launchd agent on macOS, systemd user timer on Linux). install stores one sample immediately. Run `sloppytop service --help` for usage details.
requires_bin: sloppytop
command: sloppytop service
---

# sloppytop service install

Store one sample now and start the hourly recorder

## Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--intervalSecs` | `number` | `3600` | Seconds between record runs (default hourly) |

---

# sloppytop service status

Show scheduled-job state, last run when reported by the scheduler, and
DB sample freshness. An armed scheduler can be idle between runs or
after a failed run. `sample_age_seconds` is the age of the last successful
insert (which may be a manual recording), not the age of the last
scheduled run. Missing or future-dated samples have no age.

---

# sloppytop service uninstall

Stop and remove the scheduled recorder job
