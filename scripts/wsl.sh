#!/usr/bin/env bash
# Runs a command inside WSL with the Solana/Anchor toolchain on PATH, from the repo root.
# Usage (from Windows): wsl.exe -d Ubuntu -- bash "/mnt/d/project1/Among Us - Magic block/scripts/wsl.sh" <cmd...>
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
exec "$@"
