<div align="center">

# 👻 Sloppytop

**A cross-platform terminal process monitor with btop-style visualizations**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Release](https://img.shields.io/github/v/release/syphrpunk/sloppytop?color=purple)](https://github.com/syphrpunk/sloppytop/releases)

A terminal process monitor — originally the CLI companion to [NeoHtop](https://github.com/Abdenasser/NeoHtop). The prebuilt binary is `sloppytop`. `sloppytop tui` opens the screen.

[Installation](#installation) · [Features](#features) · [Keybindings](#keybindings) · [Themes](#themes) · [Configuration](#configuration)

<br/>

<img src="assets/demo.gif" alt="Sloppytop demo" width="820" />

<br/>

<img src="assets/neohtop-cli.JPG" alt="Sloppytop screenshot" width="820" />

</div>

<br/>

## Installation

Homebrew stores one performance sample before the install command returns, then starts an hourly recorder. Read that log with `sloppytop history`, `sloppytop report`, or `sloppytop tui` and press `v`.

```bash
brew tap syphrpunk/sloppytop https://github.com/syphrpunk/sloppytop
brew install syphrpunk/sloppytop/sloppytop
```

Homebrew needs the git URL because this repository name has no `homebrew-` prefix. The fully qualified install trusts this cask. After that, `brew install sloppytop` and `brew upgrade sloppytop` use the short name.

The macOS release build is Apple Silicon. An Intel Mac runs this checkout with bun. A downloadable binary is the fallback below. `sloppytop tui` opens the process monitor. `sloppytop --help` lists the other commands.

<details>
<summary><b>macOS (Apple Silicon)</b></summary>

```bash
curl -LO https://github.com/syphrpunk/sloppytop/releases/latest/download/sloppytop-macos-arm64.tar.gz
tar xzf sloppytop-macos-arm64.tar.gz
sudo mv sloppytop-macos-arm64 /usr/local/bin/sloppytop
sloppytop record
sloppytop service install
```

</details>

<details>
<summary><b>Linux</b></summary>

```bash
# x86_64
curl -LO https://github.com/syphrpunk/sloppytop/releases/latest/download/sloppytop-linux-amd64.tar.gz
tar xzf sloppytop-linux-amd64.tar.gz
sudo mv sloppytop-linux-amd64 /usr/local/bin/sloppytop

# ARM64
curl -LO https://github.com/syphrpunk/sloppytop/releases/latest/download/sloppytop-linux-arm64.tar.gz
tar xzf sloppytop-linux-arm64.tar.gz
sudo mv sloppytop-linux-arm64 /usr/local/bin/sloppytop

# either archive: store one sample now, then keep an hourly recorder
sloppytop record
sloppytop service install
```

</details>

<details>
<summary><b>Windows</b></summary>

Download [`sloppytop-windows-amd64.tar.gz`](https://github.com/syphrpunk/sloppytop/releases/latest). The archive contains `sloppytop-windows-amd64.exe`.

</details>

<details>
<summary><b>Intel Mac</b></summary>

The release has no Intel Mac binary. Clone the repo and run the checkout:

```bash
git clone https://github.com/syphrpunk/sloppytop.git
cd sloppytop
mise install
./st tui
```

</details>

<details>
<summary><b>Build from source</b></summary>

Requires [mise](https://mise.jdx.dev) (installs bun and just from `mise.toml`).

```bash
git clone https://github.com/syphrpunk/sloppytop.git
cd sloppytop
mise install
just setup
./st tui
```

`just build` writes `ts/dist/sloppytop`.
Use `just install` for `/usr/local/bin`, or `just install /opt/homebrew/bin`
for the usual Apple Silicon Homebrew PATH. The checkout installer adds an
`st` symlink beside `sloppytop` only if neither the destination, PATH, nor
your login shell already uses `st`. It does not edit shell startup files.
Package-manager installs keep their existing command names.

</details>

<br/>

## Features

<table>
<tr>
<td width="50%">

**Real-time monitoring**
CPU per-core sparklines, memory, disk I/O, and network stats rendered with braille-dot visualizations

</td>
<td width="50%">

**Powerful search**
Regex-powered filtering with live match highlighting — `^chrome`, `name|pid`, `\.log$`

</td>
</tr>
<tr>
<td>

**15 built-in themes**
Catppuccin, Dracula, Tokyo Night, Nord, Gruvbox, Synthwave, and more — switch with `t`

</td>
<td>

**Process management**
Inspect details, kill processes, pin favorites to the top, toggle tree view

</td>
</tr>
<tr>
<td>

**JSON output**
`sloppytop snapshot --format json` pipes structured data to `jq` for scripting and dashboards

</td>
<td>

**Single binary, cross-platform**
macOS, Linux, and Windows — no runtime dependencies

</td>
</tr>
</table>

<br/>

## Quick Start

```bash
sloppytop tui                      # open the process monitor
sloppytop discover                 # read local network tables without probing peers
sloppytop discover --redact        # share counts and coverage, not addresses
sloppytop snapshot --format json   # one-shot JSON snapshot
sloppytop --help                   # see all commands
```

Press `?` inside the TUI to see every keybinding.

<br/>

## Keybindings

| | Key | Action |
|---|---|---|
| **General** | `q` · `Ctrl+C` | Quit |
| | `?` | Help overlay |
| | `s` · `/` | Search (regex) |
| | `Space` | Pause / resume |
| | `Esc` | Close overlay / clear search |
| **Navigate** | `↑` `↓` `j` | Move selection |
| | `PgUp` · `PgDn` | Page scroll |
| | `Home` · `g` / `End` · `G` | Jump to top / bottom |
| **Process** | `i` · `Enter` | Inspect details |
| | `k` · `x` · `Del` | Kill (with confirmation) |
| | `p` | Pin / unpin |
| **Display** | `0`–`9` | Sort by column (flat view only) |
| | `f` | Filter panel |
| | `c` | Column visibility |
| | `T` | Toggle tree: pins first, then parents before children; roots and siblings in PID order. Return to flat view to restore its sort. |
| | `←` / `→` | Tree: fold or select parent / expand or select first child (`+N` hidden rows) |
| | `t` | Theme selector |
| | `r` | Cycle the saved screen refresh interval, including while frozen. Does not change the recorder schedule. |
| **Mouse** | Click row | Select process |
| | Double-click | Open details |
| | Click header | Sort by column (flat view only) |
| | Scroll wheel | Navigate list |

<br/>

## Search

Press `s` or `/` to search. Supports full regex:

```
chrome          process name contains "chrome"
^sys            names starting with "sys"
\.log$          commands ending in ".log"
node|deno       matches either
1234            PID 1234
```

Matches are highlighted in yellow in the Name and Command columns.

<br/>

## Themes

Press `t` to open the theme selector with live color swatches.

| | | |
|---|---|---|
| **Charm** *(default)* | **Catppuccin Mocha** | **Catppuccin Latte** |
| **Dracula** | **Tokyo Night** | **Gruvbox Dark** |
| **Nord** | **One Dark** | **Rosé Pine** |
| **Synthwave** | **Solarized Dark** | **Monokai Pro** |
| **High Contrast** | **Green Terminal** | **Amber Terminal** |

<br/>

## JSON Output

`snapshot --format json` outputs system stats and all processes:

```bash
# top 10 by CPU
sloppytop snapshot --format json | jq '[.processes[] | {name, cpu: .cpu_usage}] | sort_by(.cpu) | reverse[:10]'

# memory usage
sloppytop snapshot --format json | jq '.system | {memory_used, memory_total, pct: (.memory_used/.memory_total*100|round)}'

# watch mode
watch -n2 'sloppytop snapshot --format json | jq ".system.cpu_usage_per_core"'
```

<br/>

## Configuration

Screen settings persist at `~/.config/sloppytop/config.json`. An existing `~/.config/neohtop` directory stays in use until the new directory exists.
Press `m` in the TUI to check recorder health on macOS or Linux. Settings
shows whether the scheduler is on, off or unknown and its cadence when
reported. Press Enter on **Recorder details** for the resolved database path,
last scheduled run outcome and latest successful insert (including manual
recordings). Esc returns to Settings; ↑/↓ selects the global probe switches
or metrics listener. Close and reopen Settings to refresh recorder health.
In Recorder details, `e` enables scheduling, `c` changes the interval (whole
seconds, at least 60), and `d` disables it without deleting history. Review
the change and press `y` to confirm, or Esc to cancel. Enabling or changing
cadence stores a sample **before** installing the schedule, just like
`sloppytop service install`. If installation fails, that sample stays in the
database. Settings rechecks the scheduler and database after each attempt.
From a selected process, press `i` for details and `t` to sample its visible
subtree with the same collector as `tree --summary-pid`. Press `t` again
to return. Coverage is shown per metric; the subtree may omit processes,
and summed RSS can count shared pages more than once. This is separate from
the `g` cgroup view. `e` and `o` independently show or hide environment
**names only** and open files. Both start hidden for each process inspection;
hide a section and reopen it to retry an unavailable reading. Neither list
is written to the probe log.
Press `v`, then `i`, to inspect the five newest History samples. Use `←` for
an older sample or `→` for a newer one. `Enter` opens the selected sample’s
anomaly evidence, recorded interfaces and stored top processes. A rate of
`0 B/s` was measured; `—` means no reading. Process arguments are not shown.
Scroll with `↑`/`↓` or the wheel. `Esc` returns to the same sample, `i` to
the overview, and `q` closes History.

In Report (`w` from the main screen), `c` compares
the last 24 hours with the preceding 24 hours, `w` shows per-sample CPU/RSS
for configured groups, and `l` shows RSS-growth evidence and thresholds.
Press the same key again for the overview. Scroll with arrows or the mouse
wheel. Coverage counts stored observations, not all host processes.
In discovery (`D`), use `c` to compare two saved snapshots. Type the two
local paths, use Tab to switch fields, and press Enter to compare. Both
files must be full snapshots or both must be redacted snapshots. Use `e`
in discovery to save the loaded overview as counts and coverage only, or
`e` in Report to save redacted diagnostics. Exports create a new local file
and never overwrite; diagnostic timestamps may still be sensitive.

```json
{
  "tui": {
    "columns": ["pid", "name", "command", "threads", "user", "memory", "cpu"],
    "refreshMs": 1000,
    "theme": "charm"
  }
}
```

**Columns:** `pid` `name` `command` `threads` `user` `memory` `cpu` `status` `runtime` `disk`

**Refresh rates** — cycle with `r`: 1s *(default)* → 2s → 3s → 5s → 0.5s

<br/>

## Architecture

The prebuilt binary is the TypeScript CLI. `sloppytop tui` is the screen. Collectors for macOS, Linux, and Windows live under `ts/src/monitor/`.


<details>
<summary><b>Project structure</b></summary>

```
sloppytop/
├── ts/src/
│   ├── index.ts             # commands
│   ├── monitor/             # macOS, Linux, and Windows collectors
│   ├── store/               # config, metrics, report, recorder
│   ├── tui/                 # screen
│   └── filter/              # search, sort, tree
├── justfile
├── mise.toml
└── CONTRIBUTING.md
```

</details>

<br/>

## Sloppytop vs NeoHtop Desktop

| Feature | Desktop | CLI |
|---|:---:|:---:|
| Process monitoring | ✅ | ✅ |
| CPU per-core stats | ✅ | ✅ |
| Memory / Disk / Network | ✅ | ✅ |
| Regex search | ✅ | ✅ |
| Kill / Pin / Inspect | ✅ | ✅ |
| Mouse support | ✅ | ✅ |
| Themes | 12 | **15** |
| Process tree view | — | ✅ |
| JSON scripting | — | ✅ |
| Runs in terminal | — | ✅ |
| Single binary | — | ✅ |

<br/>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and how to add themes, icons, and keybindings.

## License

[MIT](LICENSE)

<br/>

<div align="center">

**[NeoHtop Desktop](https://github.com/Abdenasser/NeoHtop)** · **[Bubble Tea](https://github.com/charmbracelet/bubbletea)** · **[btop](https://github.com/aristocratos/btop)**

Made with 👻 by [Abdenasser](https://github.com/Abdenasser)

</div>
