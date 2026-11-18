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
| **Display** | `0`–`9` | Sort by column |
| | `f` | Filter panel |
| | `c` | Column visibility |
| | `T` | Tree view |
| | `t` | Theme selector |
| | `r` | Cycle refresh rate |
| **Mouse** | Click row | Select process |
| | Double-click | Open details |
| | Click header | Sort by column |
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
