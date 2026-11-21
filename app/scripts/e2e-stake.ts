// Staked heist, end to end, against the LIVE devnet TEE + Solana devnet.
//   two wallets buy tickets on Solana -> both sit down in the TEE -> bots fill -> the heist plays
//   out -> lights-on commits the Room and schedules the `settle` Magic Action -> we watch the Pot
//   get paid on Solana and check that every lamport is accounted for.
// Usage: npx tsx scripts/e2e-stake.ts [roomId=21]
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import { GameClient, InjectedWallet, potPda, randomNonce, roomPda } from "../src/chain/client";
import { BASE_RPC } from "../src/chain/config";
import { PH, PHASE_NAME, POT_OPEN, POT_SETTLED, decodeRoom, occupied } from "../src/chain/decode";
import { loadAdmin, log, sleep } from "./common";

const roomId = Number(process.argv[2] ?? 21);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, note = "") => { results.push([name, ok, note]); log(ok ? "PASS" : "FAIL", name, note); };
const asWallet = (kp: Keypair): InjectedWallet => ({
  publicKey: kp.publicKey,
  connect: async () => ({ publicKey: kp.publicKey }),
  signTransaction: async (tx) => { tx.partialSign(kp); return tx; },
});

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms: number, label: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await sleep(700);
  }
}

async function main() {
  const base = new Connection(BASE_RPC, "confirmed");
  const admin = loadAdmin();
  const w2 = Keypair.generate();
  await sendAndConfirmTransaction(base, new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: w2.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL })), [admin]);
  const wallets = [asWallet(admin), asWallet(w2)];
  const players = [new GameClient(Keypair.generate()), new GameClient(Keypair.generate())];
  for (const p of players) await p.connect();
  log("wallets", wallets.map((w) => w.publicKey!.toBase58()));

  let room = (await players[0].fetchRoom(roomId))!;
  check("staked table reports its stake", room.stake > 0, `${room.stake / LAMPORTS_PER_SOL} SOL/seat`);
  if (room.phase === PH.ENDED) { await players[0].finish(roomId, room.potNonce).catch(() => {}); room = (await players[0].fetchRoom(roomId))!; }
  if (room.phase === PH.REVEALED) { await players[0].reset(roomId); room = (await players[0].fetchRoom(roomId))!; }
  if (room.phase !== PH.LOBBY) throw new Error(`table ${roomId} busy (${PHASE_NAME[room.phase]})`);

  const nonce = room.potNonce || randomNonce();
  const before = await Promise.all(wallets.map((w) => base.getBalance(w.publicKey!)));
  for (let i = 0; i < 2; i++) await players[i].buyTicket(wallets[i], roomId, nonce);
  const pot0 = (await players[0].fetchPot(roomId, nonce))!;
  check("both tickets are in the Pot on Solana", pot0.n === 2 && pot0.status === POT_OPEN, `pot ${potPda(roomId, nonce).toBase58()}`);

  // a session key without a ticket is refused a seat
  const stranger = new GameClient(Keypair.generate());
  await stranger.connect();
  const denied = await stranger.join(roomId, 7, "NOPE", admin.publicKey, nonce).then(() => false).catch(() => true);
  check("a session key the ticket didn't name is refused a seat", denied);

  for (let i = 0; i < 2; i++) {
    const r = (await players[i].fetchRoom(roomId))!;
    const seat = Array.from({ length: r.maxPlayers }, (_, k) => k).find((k) => !occupied(r, k))!;
    await waitFor(async () => { await players[i].join(roomId, seat, `STAKE${i}`, wallets[i].publicKey!, nonce); return true; }, 20_000, "rollup sees the ticket");
  }
  room = (await players[0].fetchRoom(roomId))!;
  check("both staked players are seated in the TEE", room.potNonce === nonce && room.nHumans === 2, `pot_nonce ${nonce}`);

  await players[0].startMatch(roomId, 5).catch(async () => players[1].startMatch(roomId, 5));
  await waitFor(async () => { const r = await players[0].fetchRoom(roomId); return r && r.phase >= PH.PLAY ? r : null; }, 25_000, "deal");
  log("heist running; playing it out (vote skip, constant-rate no-ops)…");
  const end = await waitFor(async () => {
    const r = await players[0].fetchRoom(roomId);
    if (!r) return null;
    for (const p of players) {
      const s = r.players.indexOf(p.pubkey.toBase58());
      if (r.phase === PH.MEETING && s >= 0 && !(r.votedMask & (1 << s))) await p.vote(roomId, 254).catch(() => {});
      if (r.phase === PH.PLAY) await p.act(roomId, 0).catch(() => {});
    }
    if (Date.now() % 9 === 0) log(`  ${PHASE_NAME[r.phase]} tick ${r.tick} tasks ${r.taskDone}/${r.taskTotal}`);
    return r.phase >= PH.ENDED ? r : null;
  }, 15 * 60_000, "game end");
  check("the staked heist ends with a winner", end.winner <= 1, end.winner === 1 ? "Mole wins" : "Crew wins");

  const t0 = Date.now();
  if (end.phase === PH.ENDED) await players[0].finish(roomId, nonce);
  const pot = await waitFor(async () => { const p = await players[0].fetchPot(roomId, nonce); return p && p.status !== POT_OPEN ? p : null; }, 90_000, "Magic Action settle").catch(() => null);
  if (pot) {
    check("lights-on committed the Room and the Magic Action settled the Pot on Solana", pot.status === POT_SETTLED, `${((Date.now() - t0) / 1000).toFixed(1)} s after finish`);
  } else {
    const baseRoom = await base.getAccountInfo(roomPda(roomId));
    const committed = baseRoom ? decodeRoom(baseRoom.data) : null;
    check("lights-on committed the Room and the Magic Action settled the Pot on Solana", false, `pot still open; base room phase ${committed ? PHASE_NAME[committed.phase] : "?"} nonce ${committed?.potNonce}`);
    if (committed && committed.potNonce === nonce) {
      await players[0].settle(wallets[0], roomId, nonce);
      check("permissionless settle (fallback) pays from the committed Room", true);
    }
  }
  const final = (await players[0].fetchPot(roomId, nonce))!;
  const paid = final.paid.reduce((a, b) => a + b, 0);
  check("conservation: payouts == stake × tickets", paid === final.stake * final.n, `${paid} == ${final.stake * final.n}`);
  const after = await Promise.all(wallets.map((w) => base.getBalance(w.publicKey!)));
  log("balance deltas (incl. tx fees)", after.map((a, i) => ((a - before[i]) / LAMPORTS_PER_SOL).toFixed(5)));
  log("payouts", final.paid.slice(0, final.n).map((p) => p / LAMPORTS_PER_SOL));

  await players[0].reset(roomId).catch(() => {});
  // return w2's leftover to the admin
  const left = await base.getBalance(w2.publicKey);
  if (left > 10_000) await sendAndConfirmTransaction(base, new Transaction().add(SystemProgram.transfer({ fromPubkey: w2.publicKey, toPubkey: admin.publicKey, lamports: left - 5000 })), [w2]).catch(() => {});

  console.log("\n==== STAKED E2E (devnet TEE + Solana devnet) ====");
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`);
  process.exit(1);
});
