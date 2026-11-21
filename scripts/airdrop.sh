#!/usr/bin/env bash
# Devnet faucet top-up for the deployer (free test SOL; often rate-limited).
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
for rpc in https://api.devnet.solana.com https://rpc.magicblock.app/devnet; do
  for amt in 2 1; do
    if solana airdrop "$amt" -u "$rpc" 2>&1; then echo "ok via $rpc"; break 2; fi
  done
done
solana balance -u https://rpc.magicblock.app/devnet
