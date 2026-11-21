#!/usr/bin/env bash
# Build the WASM replay (tools/replay: the program's own rule files) into the web app.
set -eo pipefail
export PATH="$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/inside-job-build"
mkdir -p "$WORK"
rsync -a --delete --exclude target --exclude app --exclude node_modules --exclude .git "$REPO/" "$WORK/"
rustup target list --installed | grep -q wasm32-unknown-unknown || rustup target add wasm32-unknown-unknown
cd "$WORK/tools/replay"
cargo build --release --target wasm32-unknown-unknown 2>&1 | grep -Ev "^\s*(Compiling|Downloaded|Downloading)" | tail -${TAILN:-20}
cp target/wasm32-unknown-unknown/release/ij_replay.wasm "$REPO/app/src/chain/replay.wasm"
ls -la "$REPO/app/src/chain/replay.wasm"
