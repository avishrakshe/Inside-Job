#!/usr/bin/env bash
# SBF build + IDL. Output: target/deploy/inside_job.so and target/idl/inside_job.json
# Builds in the Linux filesystem (fast) and copies artifacts back into the repo.
set -eo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:/usr/local/bin:/usr/bin:/bin"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/inside-job-build"
mkdir -p "$WORK"
# mirror sources (not target/) into the Linux FS
rsync -a --delete --exclude target --exclude app --exclude node_modules --exclude .git "$REPO/" "$WORK/"
cd "$WORK"
echo "== cargo build-sbf"
cargo build-sbf --manifest-path programs/inside-job/Cargo.toml --sbf-out-dir target/deploy 2>&1 | grep -Ev "^\s*(Compiling|Downloaded|Downloading)" | tail -${TAILN:-30}
echo "== idl"
mkdir -p target/idl
# (not `anchor idl build`: anchor-cli 1.0 switches the global Solana release and downloads
#  its own platform-tools; tools/idlgen runs the same anchor-lang-idl builder directly)
cargo build --quiet --release --manifest-path tools/idlgen/Cargo.toml 2>&1 | grep -Ev "^\s*(Compiling|Downloaded|Downloading)" | tail -5 || true
# anchor-lang-idl 0.1.4 mis-formats `+toolchain` when RUSTUP_TOOLCHAIN is set: run with it unset
env -u RUSTUP_TOOLCHAIN tools/idlgen/target/release/idlgen "$WORK/programs/inside-job" "$WORK/target/idl/inside_job.json" 2>&1 | grep -Ev "^\s*(Compiling|Downloaded|Downloading)|warning|^\s*\||^\s*=|^\s*$|-->" | tail -15
echo "idl: $(wc -c < target/idl/inside_job.json) bytes"
mkdir -p "$REPO/target/deploy" "$REPO/target/idl" "$REPO/app/src/idl"
cp target/deploy/inside_job.so "$REPO/target/deploy/"
[ -f target/idl/inside_job.json ] && cp target/idl/inside_job.json "$REPO/target/idl/" && cp target/idl/inside_job.json "$REPO/app/src/idl/"
ls -la "$REPO/target/deploy/inside_job.so" "$REPO/app/src/idl/" 2>/dev/null || true
