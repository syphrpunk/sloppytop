# Sloppytop — task runner (run `just --list` to see all recipes)

# Default: compile the native binary
default: build

# Install TypeScript dependencies
setup:
    cd ts && bun install --libc='*'

# Compile this checkout to ts/dist/sloppytop
build:
    cd ts && bun build --compile --minify src/index.ts src/tui/sample-worker.ts --outfile dist/sloppytop
    @echo "Binary built: ts/dist/sloppytop"

# Run this checkout. Pass args after --, for example `just dev system`
dev *args:
    ./st {{args}}

# Run the TypeScript tests
test:
    cd ts && bun test

# Remove build output and leftover Go binary names
clean:
    rm -rf ts/dist
    rm -f sloppytop-cli sloppytop-cli.exe sloppytop-cli-* neohtop-cli neohtop-cli.exe neohtop-cli-*

# Install the compiled binary and add st only if that command is free
install directory="/usr/local/bin": build
    bun ts/install.ts ts/dist/sloppytop "{{directory}}"

# Install TS dependencies
ts-setup:
    cd ts && bun install --libc='*'

# Run the TS CLI (pass args after --, e.g. `just ts top --count 5`)
ts *args:
    cd ts && bun run src/index.ts {{args}}

# Same command as ./st and ./sloppytop: this checkout's TypeScript CLI
st *args:
    ./st {{args}}

# Type-check the TS CLI
ts-check:
    cd ts && bunx tsc --noEmit

# Run TS tests
ts-test:
    cd ts && bun test

# Compile the TS CLI to a standalone binary (ts/dist/sloppytop)
ts-compile: build

# Quit-check the compiled screen. Uses a temp config dir and does not print the frame.
ts-smoke:
    python3 ts/smoke-tui.py ts/dist/sloppytop

# Check one temporary DB through the compiled recorder, reports and TUI (needs tmux).
ts-smoke-diagnosis:
    python3 ts/smoke-tui.py ts/dist/sloppytop --history

# Capture synthetic terminal frames (text and SVG, plus PNG with rsvg-convert)
tui-visual output="ts/dist/tui-visual":
    cd ts && bun build --compile discovery-pty-fixture.ts --outfile dist/discovery-pty-fixture
    python3 ts/visual-tui.py ts/dist/discovery-pty-fixture "{{output}}"

# Benchmark compiled live and synthetic screens (build both binaries first).
tui-bench *args:
    python3 ts/bench-tui.py ts/dist/sloppytop ts/dist/discovery-pty-fixture {{args}}

# Cross-target bun runtimes are not downloadable on canary. Release binaries
# are compiled natively per platform in CI (see release.yml).
