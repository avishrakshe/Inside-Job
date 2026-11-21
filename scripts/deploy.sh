#!/usr/bin/env bash
# Deploy (or upgrade) the program on Solana devnet.
# Uses MagicBlock's devnet RPC by default (the public endpoint rate-limits program uploads).
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
RPC="${RPC:-https://rpc.magicblock.app/devnet}"
echo "deployer: $(solana-keygen pubkey ~/.config/solana/id.json)  balance: $(solana balance -u "$RPC")"
# reclaim rent from any half-written buffers left by an interrupted deploy
solana program show --buffers -u "$RPC" || true
if [ "${CLOSE_BUFFERS:-0}" = "1" ]; then solana program close --buffers -u "$RPC" || true; fi
solana program deploy target/deploy/inside_job.so \
  --program-id target/deploy/inside_job-keypair.json \
  -u "$RPC" --with-compute-unit-price 20000 --max-sign-attempts 50 --use-rpc
solana program show "$(solana-keygen pubkey target/deploy/inside_job-keypair.json)" -u "$RPC"
