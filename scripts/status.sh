#!/usr/bin/env bash
# Deployer balance + program info on devnet.
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
RPC="${RPC:-https://rpc.magicblock.app/devnet}"
echo "deployer: $(solana-keygen pubkey ~/.config/solana/id.json)"
echo "balance:  $(solana balance -u "$RPC")"
solana program show 9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U -u "$RPC" || true
ls -la target/deploy/ 2>/dev/null || true
