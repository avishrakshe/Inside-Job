#!/usr/bin/env bash
# Fast host-side check + unit tests of the program (no SBF build).
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
export CARGO_TARGET_DIR="$HOME/.ij-target"
cargo test -p inside-job --lib 2>&1 | grep -v "^\s*Compiling\|^\s*Checking" | tail -${TAILN:-60}
