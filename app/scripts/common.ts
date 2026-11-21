// Shared helpers for the node scripts (setup-rooms, e2e, prove-privacy).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { ATA_PROGRAM, TOKEN_PROGRAM } from "../src/chain/config";
import { ataOf } from "../src/chain/client";

/** Associated Token Account `CreateIdempotent` (hand-encoded, no spl-token dependency). */
export function createAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ataOf(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** spl-token `TransferChecked` between two owners' ATAs. */
export function transferIx(from: PublicKey, to: PublicKey, mint: PublicKey, units: number, decimals: number): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(BigInt(units), 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: ataOf(from, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: ataOf(to, mint), isSigner: false, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: false },
    ],
    data,
  });
}

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
