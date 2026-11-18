# Homebrew lifecycle and discovery TUI audit

## Homebrew

The public tap's default branch did not contain `Casks/sloppytop.rb`.
Both `brew info --cask syphrpunk/sloppytop/sloppytop` and a dry-run upgrade
failed on that missing file. GitHub's latest release was `v0.3.0`, which
predates discovery. A checkout install into `/opt/homebrew/bin` does not
register the binary in Homebrew's Caskroom.

Using Homebrew 7.0.14 in a disposable prefix and a local tap, we verified
the published `v0.3.0` ARM64 archive checksum, installed its cask fixture,
then upgraded it to a fixture version `0.3.1` containing the checkout build.
Homebrew replaced the symlink and removed the old version. A fresh candidate
install was also exercised. The first invocation of each fresh archive can
still be interrupted by macOS quarantine (SIGKILL observed). After local
approval, the candidate passed the compiled discovery and same-database
diagnosis smokes. Homebrew removed the candidate binary on uninstall, and
the explicitly recorded sample stayed in the disposable SQLite store.
The fixture cask version is not a release version: the packaged candidate
still reports `0.3.0`.

The fixture cask differed from the real one in URLs, versions, and omission
of recorder hooks. The active legacy launchd agent was left intact: the real
hooks can remove or replace it. Before declaring the published lifecycle
verified, test the exact cask without skipping its hooks in a disposable
macOS account: install, verify sample and agent, upgrade, verify the new
binary and retained samples, uninstall, then verify agent removal and
retained data. A local approval is not a signing/notarization result. No
security settings were changed and nothing was published.

## Terminal

The main footer now advertises **D discover** at narrow and wide widths.
Use Left/Right to switch among the seven numbered tabs. Panels share a
consistent frame and inner padding; duplicate in-panel close hints are gone.
`just tui-visual` captures the seven tabs, the other overlays, and main-screen
resize states. `python3 ts/smoke-discovery.py ts/dist/sloppytop` visits all
seven tabs using live local tables in narrow and wide terminal panes.
Representative rendered PNGs were reviewed alongside the terminal-cell
baselines. Capture output is under `ts/dist/tui-visual/`.
