#!/usr/bin/env bash
# Program unit tests on the host. Usage: scripts/test.sh [filter]
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="$HOME/.ij-target"
cargo test -p inside-job --lib ${1:-} -- --nocapture 2>&1 | grep -Ev "^\s*(Compiling|Checking|Downloaded|Downloading)" | tail -${TAILN:-60}
