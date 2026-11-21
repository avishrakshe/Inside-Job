// Staked heist + Tip Line, end to end, against the LIVE devnet TEE + Solana devnet (USDC).
//   two wallets buy USDC tickets on Solana -> both sit down in the TEE -> a spectator stakes on
//   the Tip Line and calls a seat inside the rollup -> bots fill -> the heist plays out ->
//   lights-on commits the Room with two Magic Actions (record_tips + settle) -> we watch the
//   Pot pay out and the Tip Line resolve on Solana, claim the tip, and check conservation.
// Needs: the admin wallet (Solana CLI id.json) holding >= 3 of the table's token (devnet USDC:
// faucet.circle.com -> Solana Devnet) plus ~0.1 SOL.
// Usage: npx tsx scripts/e2e-stake.ts [roomId=41]
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { GameClient, InjectedWallet, marketPda, potPda, randomNonce } from "../src/chain/client";
import { BASE_RPC, USDC_DECIMALS } from "../src/chain/config";
import { MARKET_OPEN, MARKET_RESOLVED, PH, PHASE_NAME, POT_OPEN, POT_SETTLED, occupied } from "../src/chain/decode";
import { createAtaIx, loadAdmin, log, sleep, transferIx } from "./common";

const roomId = Number(process.argv[2] ?? 41);
const TIP = 1_000_000;
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, note = "") => { results.push([name, ok, note]); log(ok ? "PASS" : "FAIL", name, note); };
const asWallet = (kp: Keypair): InjectedWallet => ({
  publicKey: kp.publicKey,
  connect: async () => ({ publicKey: kp.publicKey }),
  signTransaction: async (tx) => { tx.partialSign(kp); return tx; },
});
const fmt = (u: number) => (u / 10 ** USDC_DECIMALS).toFixed(2);

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
  const players = [new GameClient(Keypair.generate()), new GameClient(Keypair.generate())];
  const spectator = new GameClient(Keypair.generate());
  for (const p of [...players, spectator]) await p.connect();

  let room = (await players[0].fetchRoom(roomId))!;
  const mint = new PublicKey(room.mint);
  check("staked table reports its stake + mint", room.stake > 0, `${fmt(room.stake)} / seat in ${mint.toBase58().slice(0, 8)}…`);
  const need = room.stake * 2 + TIP;
  const have = await players[0].tokenUnits(admin.publicKey, mint);
  if (have < need) throw new Error(`admin ${admin.publicKey.toBase58()} holds ${fmt(have)} of the table's token; needs ${fmt(need)}. Get devnet USDC at faucet.circle.com (Solana Devnet).`);

  // fund a second player and a spectator: SOL for fees + their token accounts + tokens
  const w2 = Keypair.generate(), w3 = Keypair.generate();
  await sendAndConfirmTransaction(base, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: w2.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }),
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: w3.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL }),
    createAtaIx(admin.publicKey, w2.publicKey, mint), createAtaIx(admin.publicKey, w3.publicKey, mint),
    transferIx(admin.publicKey, w2.publicKey, mint, room.stake, USDC_DECIMALS),
    transferIx(admin.publicKey, w3.publicKey, mint, TIP, USDC_DECIMALS),
  ), [admin]);
  const wallets = [asWallet(admin), asWallet(w2)];
  log("wallets", wallets.map((w) => w.publicKey!.toBase58()), "spectator", w3.publicKey.toBase58());

  if (room.phase === PH.ENDED) { await players[0].finish(roomId).catch(() => {}); room = (await players[0].fetchRoom(roomId))!; }
  if (room.phase === PH.REVEALED) { await players[0].reset(roomId); room = (await players[0].fetchRoom(roomId))!; }
  if (room.phase !== PH.LOBBY) throw new Error(`table ${roomId} busy (${PHASE_NAME[room.phase]})`);

  const nonce = room.potNonce || randomNonce();
  for (let i = 0; i < 2; i++) await players[i].buyTicket(wallets[i], roomId, nonce, mint);
  const pot0 = (await players[0].fetchPot(roomId, nonce))!;
  check("both USDC tickets are in the Pot on Solana", pot0.n === 2 && pot0.status === POT_OPEN, `pot ${potPda(roomId, nonce).toBase58()}`);

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
  room = await waitFor(async () => { const r = await players[0].fetchRoom(roomId); return r && r.phase >= PH.PLAY ? r : null; }, 25_000, "deal");
  await players[0].commitDeal(roomId).catch(() => {});

  // the spectator: stake on the Tip Line (Solana), then call a seat (rollup, session key)
  await spectator.buyTip(asWallet(w3), roomId, room.matchNo, TIP, mint);
  const insider = await players[0].pick(roomId, room.matchNo, 0).then(() => false).catch(() => true);
  check("a seated player can't use the Tip Line", insider);
  const suspect = Array.from({ length: 8 }, (_, s) => s).find((s) => occupied(room, s) && room.isBot[s] === 1)!;
  await waitFor(async () => { await spectator.pick(roomId, room.matchNo, suspect); return true; }, 20_000, "rollup sees the tip");
  const afterPick = (await players[0].fetchRoom(roomId))!;
  check("the spectator's call lands in the public Room", afterPick.tipN === 1 && afterPick.tipSeat[0] === suspect, `seat ${suspect}, weight ${afterPick.tipWeight[0]}`);

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
  if (end.phase === PH.ENDED) await players[0].finish(roomId);
  await waitFor(async () => { const r = await players[0].fetchRoom(roomId); return r && r.phase === PH.REVEALED ? r : null; }, 20_000, "lights on");
  await players[0].commitResult(roomId, nonce);
  // a second commit of the same heist is refused (once per heist)
  const twice = await players[1].commitResult(roomId, nonce).then(() => false).catch(() => true);
  check("the result commits once per heist", twice);
  const pot = await waitFor(async () => { const p = await players[0].fetchPot(roomId, nonce); return p && p.status !== POT_OPEN ? p : null; }, 120_000, "Magic Action settle").catch(() => null);
  check("Magic Action settled the USDC Pot on Solana", pot?.status === POT_SETTLED, `${((Date.now() - t0) / 1000).toFixed(1)} s after finish`);
  if (!pot) await players[0].settle(wallets[0], roomId, nonce, mint).catch((e) => log("fallback settle:", e.message));
  const final = (await players[0].fetchPot(roomId, nonce))!;
  const paid = final.paid.reduce((a, b) => a + b, 0);
  check("Pot conservation: payouts == stake × tickets", paid === final.stake * final.n, `${fmt(paid)} == ${fmt(final.stake * final.n)}`);

  let market = await waitFor(async () => { const m = await spectator.fetchMarket(roomId, end.matchNo); return m && m.status !== MARKET_OPEN ? m : null; }, 120_000, "Magic Action record_tips").catch(() => null);
  check("Magic Action resolved the Tip Line from the committed Room", market?.status === MARKET_RESOLVED, `market ${marketPda(roomId, end.matchNo).toBase58()}`);
  if (!market) { await spectator.recordTips(asWallet(w3), roomId, end.matchNo).catch((e) => log("fallback record_tips:", e.message)); market = await spectator.fetchMarket(roomId, end.matchNo); }
  if (market) {
    const right = end.rolesPub[suspect] === 1;
    check("Tip Line conservation: payouts == stakes", market.paid.slice(0, market.n).reduce((a, b) => a + b, 0) === market.amounts.slice(0, market.n).reduce((a, b) => a + b, 0), right ? "called the Mole" : "wrong call (refunded: nobody else called it)");
    const before = await spectator.tokenUnits(w3.publicKey, mint);
    await spectator.claimTip(asWallet(w3), roomId, end.matchNo, 0, w3.publicKey, mint);
    const after = await spectator.tokenUnits(w3.publicKey, mint);
    check("the spectator's claim pays exactly what the Market owes", after - before === market.paid[0], `+${fmt(after - before)}`);
  }

  await players[0].reset(roomId).catch(() => {});
  // return leftovers to the admin
  for (const kp of [w2, w3]) {
    const units = await players[0].tokenUnits(kp.publicKey, mint);
    if (units > 0) await sendAndConfirmTransaction(base, new Transaction().add(transferIx(kp.publicKey, admin.publicKey, mint, units, USDC_DECIMALS)), [kp]).catch(() => {});
    const left = await base.getBalance(kp.publicKey);
    if (left > 10_000) await sendAndConfirmTransaction(base, new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: admin.publicKey, lamports: left - 5000 })), [kp]).catch(() => {});
  }

  console.log("\n==== STAKED + TIP LINE E2E (devnet TEE + Solana devnet, USDC) ====");
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  (${note})` : ""}`);
  process.exit(1);
});
