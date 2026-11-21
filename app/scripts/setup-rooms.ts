// Provision the public room pool on devnet:
//   base layer: create_room (pre-funded) -> delegate_room (to MagicBlock's TEE validator)
//   TEE rollup: setup_core (sealed World + move log + public Room permission; repeated to grow
//   the move log to full size) -> setup_view x8 (private Views)
// Usage: npx tsx scripts/setup-rooms.ts [id[:stakeUSDC]...]   (mint: USDC_MINT env, default devnet USDC)
//   default: free tables 31 32 33 34 and staked tables 41:1 42:1 (1 USDC a seat)
import { AnchorProvider, Program, type Idl, BN } from "@coral-xyz/anchor";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getAuthToken, permissionPdaFromAccount, DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../src/idl/inside_job.json" with { type: "json" };
import { BASE_RPC, EPHEMERAL_VAULT, MAGIC_PROGRAM, PROGRAM_ID, TEE_RPC, TEE_VALIDATOR, USDC_DECIMALS, USDC_MINT } from "../src/chain/config";
import { KeyWallet, logPda, PERMISSION_PROGRAM, roomPda, viewPda, worldPda } from "../src/chain/client";
import { loadAdmin, log, sleep } from "./common";
import { decodeRoom, READY_ALL } from "../src/chain/decode";

const args = process.argv.slice(2).length ? process.argv.slice(2) : ["31", "32", "33", "34", "41:1", "42:1"];
const SPECS = args.map((a) => { const [id, s] = a.split(":"); return { id: Number(id), stake: Math.round(Number(s ?? 0) * 10 ** USDC_DECIMALS) }; }).filter((x) => x.id > 0);
/** DISC + MoveLog header + 12 288 records (replaylog.rs LOG_ACCOUNT_SIZE) */
const LOG_ACCOUNT_SIZE = 8 + 88 + 4 * 12_288;
const ROOMS = SPECS.map((s) => s.id);
const stakeOf = (id: number) => SPECS.find((s) => s.id === id)?.stake ?? 0;

async function main() {
  const admin = loadAdmin();
  log("admin", admin.publicKey.toBase58(), "program", PROGRAM_ID.toBase58());
  const base = new Connection(BASE_RPC, "confirmed");
  log("admin balance", (await base.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL, "SOL");
  const baseProgram = new Program(idl as Idl, new AnchorProvider(base, new KeyWallet(admin) as any, { commitment: "confirmed" }));

  const { token } = await getAuthToken(TEE_RPC, admin.publicKey, async (m) => nacl.sign.detached(m, admin.secretKey));
  const tee = new Connection(`${TEE_RPC}?token=${token}`, "confirmed");
  const teeProgram = new Program(idl as Idl, new AnchorProvider(tee, new KeyWallet(admin) as any, { commitment: "confirmed", skipPreflight: true }));

  const sendTee = async (ixs: any[], label: string) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await tee.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const sig = await tee.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const r = await tee.confirmTransaction(sig, "confirmed");
    if (r.value.err) {
      const t = await tee.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
      throw new Error(`${label} failed: ${JSON.stringify(r.value.err)}\n${(t?.meta?.logMessages ?? []).join("\n")}`);
    }
    log("  tee", label, sig);
    return sig;
  };

  for (const id of ROOMS) {
    const room = roomPda(id);
    log(`== room ${id}`, room.toBase58());
    let info = await base.getAccountInfo(room);
    if (!info) {
      const sig = await baseProgram.methods
        // staked tables pay a commit (+ Magic Action) at every lights-on: pre-fund more
        .createRoom(new BN(id), 8, new BN((stakeOf(id) ? 0.05 : 0.03) * LAMPORTS_PER_SOL), new BN(stakeOf(id)), USDC_MINT)
        .accountsPartial({ authority: admin.publicKey, room, systemProgram: SystemProgram.programId })
        .rpc();
      log("  created", sig, stakeOf(id) ? `(staked ${stakeOf(id) / 10 ** USDC_DECIMALS} USDC)` : "(free)");
      info = await base.getAccountInfo(room);
    }
    if (info && info.owner.equals(PROGRAM_ID)) {
      const sig = await baseProgram.methods
        .delegateRoom(new BN(id))
        .accountsPartial({ payer: admin.publicKey, room, validator: null } as any)
        .rpc();
      log("  delegated to TEE", TEE_VALIDATOR.toBase58(), sig);
    } else if (info && info.owner.equals(DELEGATION_PROGRAM_ID)) {
      log("  already delegated");
    }
    // wait for the rollup to see it
    for (let k = 0; k < 30; k++) {
      const r = await tee.getAccountInfo(room);
      if (r && r.owner.equals(PROGRAM_ID)) break;
      await sleep(1000);
    }
    const state = decodeRoom((await tee.getAccountInfo(room))!.data);
    const world = worldPda(id);
    const logKey = logPda(id);
    const logSize = async () => (await tee.getAccountInfo(logKey))?.data.length ?? 0;
    if (state.readyMask === READY_ALL && (await logSize()) >= LOG_ACCOUNT_SIZE) {
      log("  ready");
      continue;
    }
    // first call creates World + log + permissions; each later call grows the log by 10 KiB
    for (let k = 0; k < 8 && (!(decodeRoom((await tee.getAccountInfo(room))!.data).readyMask & 1) || (await logSize()) < LOG_ACCOUNT_SIZE); k++) {
      const ix = await teeProgram.methods.setupCore().accountsPartial({
        signer: admin.publicKey, room, world, worldPermission: permissionPdaFromAccount(world), roomPermission: permissionPdaFromAccount(room),
        log: logKey, logPermission: permissionPdaFromAccount(logKey),
        permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM,
      }).instruction();
      await sendTee([ix], `setup_core (log ${await logSize()} bytes)`);
    }
    for (let s = 0; s < 8; s++) {
      if (state.readyMask & (1 << (8 + s))) continue;
      const view = viewPda(id, s);
      const ix = await teeProgram.methods.setupView(s).accountsPartial({
        signer: admin.publicKey, room, world, view, viewPermission: permissionPdaFromAccount(view),
        permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM,
      }).instruction();
      await sendTee([ix], `setup_view ${s}`);
    }
    const after = decodeRoom((await tee.getAccountInfo(room))!.data);
    log("  ready mask", after.readyMask.toString(16), after.readyMask === READY_ALL ? "READY" : "INCOMPLETE");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
