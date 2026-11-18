# Contributing to Sloppytop

Thanks for your interest in contributing to Sloppytop. Bug fixes, features, themes, and documentation are welcome.

## Getting Started

### Prerequisites

- **[mise](https://mise.jdx.dev)** — installs bun and just from `mise.toml`
- A terminal with Unicode support

### Setup

```bash
git clone https://github.com/<your-username>/sloppytop.git
cd sloppytop
mise install
just setup
./st tui
```

### Checks

```bash
just test
just ts-check
just build
```

`just build` writes `ts/dist/sloppytop`. `./st` runs the same program from source.

## Project Structure

```
ts/src/
├── index.ts           # commands
├── monitor/           # macOS, Linux, and Windows collectors
├── store/             # config, sqlite metrics, report, recorder
├── tui/               # screen
├── filter/            # search, sort, and the process tree
└── view/sparkline.ts
```

Screen state lives in `ts/src/tui/state.ts`. Rendering lives in `ts/src/tui/frame.ts`. Colors live in `ts/src/tui/theme.ts`.

## How to Contribute

### Reporting Bugs

Open an issue with your OS, the terminal, the steps, and what you expected.

### Adding a Theme

Add the palette in `ts/src/tui/theme.ts`. Unknown theme names resolve to `charm`. The theme list is the `t` overlay.

### Adding a Screen Row

Draw the row from `ts/src/tui/frame.ts`. Handle a new key in `ts/src/tui/state.ts`, and mention it in the help overlay.

### Adding a Metric

Add the field on the sample type in `ts/src/monitor/types.ts`. Read it in the platform file under `ts/src/monitor/`. Leave the field off when the platform has no reading. Keep a measured zero.

## Pull Requests

- One feature or fix per pull request
- Include a screenshot for a visual change
- `just test` and `just ts-check` should pass

## Need Help?

- Open a [GitHub issue](https://github.com/syphrpunk/sloppytop/issues)
- Check existing issues before opening a new one
