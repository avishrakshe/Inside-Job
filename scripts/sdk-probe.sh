#!/usr/bin/env bash
# Developer helper: locate the ephemeral-rollups-sdk sources and list its Magic Action / commit APIs.
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
SDK=$(ls -d $HOME/.cargo/registry/src/*/ephemeral-rollups-sdk-0.17.3 2>/dev/null | head -1)
echo "SDK: $SDK"
find "$SDK/src" -name "*.rs" | sed "s|$SDK/||" | sort
echo "== magic action / commit symbols"
grep -rn "pub fn \|pub struct \|pub enum " "$SDK/src" | grep -i "commit\|action\|handler\|magic\|undelegate\|escrow" | sed "s|$SDK/||" | head -80
echo "== balance"
solana balance -u https://rpc.magicblock.app/devnet 2>/dev/null || true
solana-keygen pubkey ~/.config/solana/id.json
