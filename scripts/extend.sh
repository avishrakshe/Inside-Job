#!/usr/bin/env bash
# Grow the program's data account so a slightly larger build can be upgraded in place.
# Usage: scripts/extend.sh [bytes=20000]
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
RPC="${RPC:-https://rpc.magicblock.app/devnet}"
solana program extend 9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U "${1:-20000}" -u "$RPC"
solana program show 9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U -u "$RPC" | grep -E "Data Length|Balance"
