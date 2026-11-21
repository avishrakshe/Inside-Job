#!/usr/bin/env bash
# Upgrade the devnet program in place: grow the program account if the new build is bigger,
# then deploy. Logs to target/deploy.log (WSL background jobs don't survive wsl.exe calls).
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
RPC="${RPC:-https://rpc.magicblock.app/devnet}"
PROG=9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U
mkdir -p target
{
  echo "deployer $(solana-keygen pubkey ~/.config/solana/id.json)  balance $(solana balance -u "$RPC")"
  have=$(solana program show "$PROG" -u "$RPC" | awk '/Data Length/ {print $3}')
  need=$(stat -c %s target/deploy/inside_job.so)
  echo "program data: $have bytes, new build: $need bytes"
  if [ "$need" -gt "$have" ]; then
    grow=$(( need - have + 4096 ))
    echo "== extending by $grow bytes"
    solana program extend "$PROG" "$grow" -u "$RPC"
  fi
  CLOSE_BUFFERS=1 bash scripts/deploy.sh
  echo "EXIT=0"
} > target/deploy.log 2>&1 || { echo "EXIT=$?" >> target/deploy.log; }
tail -n 14 target/deploy.log
