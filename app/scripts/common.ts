// Shared helpers for the node scripts (setup-rooms, e2e, prove-privacy).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

/** The deployer/admin keypair. Defaults to the WSL Solana CLI wallet. */
export function loadAdmin(): Keypair {
  const candidates = [
    process.env.ADMIN_KEYPAIR,
    "\\\\wsl.localhost\\Ubuntu\\home\\hp\\.config\\solana\\id.json",
    path.join(os.homedir(), ".config", "solana", "id.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
    } catch { /* next */ }
  }
  throw new Error("admin keypair not found; set ADMIN_KEYPAIR");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function log(...a: unknown[]) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
