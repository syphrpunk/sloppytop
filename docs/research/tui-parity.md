# CLI-to-TUI parity verification

Run `just tui-visual` and inspect the `.txt` and `.svg` captures under
`ts/dist/tui-visual/`; the command also compares reviewed terminal baselines.
Run `just build && just ts-smoke && just ts-smoke-diagnosis` for the
compiled binary and isolated SQLite workflow. The smoke test reads scheduler
status but does not install, start, or stop the recorder.

| Audit gap | Implementation and verification |
|---|---|
| Recorder health | Settings uses the CLI scheduler parser and sample freshness helper. `19-settings` shows compact status; `19-settings-recorder-wide` shows a failed scheduler run with a zero-age DB insert; the compiled smoke compares Settings with `service status` against the same temporary DB. Reopen Settings to refresh. |
| Report comparisons | `c` calls `compareReportWindows`. `19-report-compare` and the compiled smoke show the insufficient-coverage case. Sample deltas are not time-weighted. |
| Workload history | `w` calls `reportWorkloadHistory`; `19-report-workloads` shows one stored match out of 24 observed processes. A sampled zero with incomplete coverage is not evidence of absence. |
| Visible subtree | `i`, then `t` uses the same sampler as `tree --summary-pid`. `11b`/`11c` verify full and partial metric coverage, `11d` returns to the separate cgroup view, and the compiled smoke samples the live TUI process. |
| Stored top processes and RSS growth | `17b`/`17d` show stored and empty process rows; `17e` checks the return to sample 2 and `17f` the empty evidence state. Report `l` renders RSS growth based on `reportLeaks`, including observed slopes, endpoints, duration, fit and thresholds. Stored process arguments are not rendered. |
| Discovery and diagnostic artifacts | `05d`–`05g` and `19-report-export` exercise the forms and return navigation. The compiled smoke writes both redacted files and compares a saved export; `artifacts.test.ts` verifies omitted identifiers, visible-count deltas, malformed inputs and refusal to overwrite. No live discovery tab is removed. |
| NVIDIA | Hardware sample readings show experimental device data or an explicit unmeasured state. `09c-nvidia` and the frame test cover zero and missing counters, not live hardware. |

## Verify the History drill through the checkout entrypoint

From the repo root, in an interactive terminal with dependencies installed:

```sh
(
  export XDG_CONFIG_HOME="$(mktemp -d)"
  trap 'rm -rf "$XDG_CONFIG_HOME"' EXIT
  ./st record && ./st record && ./st tui
)
```

Press `v`, `i`, `←`. Note the time on **history sample 2/2**. Press
`Enter`: **sample evidence 2/2** must show that time. Scroll if needed;
process rows are the stored subset, not all processes. Resize the pane to
56×12, press `Esc`, and check the same **history sample 2/2** and time.
`q` closes History; `q` quits. No scheduler or installed binary is needed.
`just build && just ts-smoke-diagnosis` separately checks the compiled
entrypoint; `just tui-visual` covers deterministic zero, missing and empty
cases without capturing live process names.

## Failures observed and disposition

- The first subtree visual assertion assumed the search had left PID 200
  selected; it had selected PID 201. The harness now selects Home explicitly.
  The live smoke switched from whichever process was selected to the stable
  pane PID after its initial subtree assertion failed.
- Live History had enough interface rows to push the process list below the
  viewport. The smoke now verifies scrolling to the list.
- The single-entry compiled visual fixture could not start the embedded
  worker on its release entrypoint path. The fixture injects the real report
  loader; `just ts-smoke-diagnosis` separately verifies the release worker.
- The discovery footer triggered a real text and style baseline failure.
  The new footer was shortened to fit at 56 columns and the review baseline
  updated. A smoke marker also incorrectly required the “unknown” TCP label;
  it now accepts the loaded overview with measured or unknown counts.
- One visual run timed out on a blank first frame; subsequent runs reached
  the captures. No cause established from the blank capture alone.

## Open hardware gate

The macOS test host cannot validate live Linux NVIDIA readings. See
[`07-nvidia-telemetry.md`](slices/07-nvidia-telemetry.md) and `nht-f456db`.
On a Linux NVIDIA host, enable the GPU probe and `SLOPPYTOP_NVIDIA=1`, run
the paired idle/loaded `nvidia-smi` and CLI checks, and compare the same UUID,
driver, utilization and VRAM with Hardware → sample readings in the compiled
TUI. Do not treat the fixture as supported-hardware evidence.
