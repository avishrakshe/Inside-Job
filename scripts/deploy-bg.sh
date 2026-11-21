#!/usr/bin/env bash
# Runs deploy.sh with a persistent log at target/deploy.log
cd "$(dirname "$0")/.."
mkdir -p target
CLOSE_BUFFERS="${CLOSE_BUFFERS:-1}" bash scripts/deploy.sh > target/deploy.log 2>&1
echo "EXIT=$?" >> target/deploy.log
