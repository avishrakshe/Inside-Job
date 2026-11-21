// End-to-end run against the LIVE devnet TEE rollup. Usage: npx tsx scripts/e2e.ts [roomId]
// 1 human (this script's session key) + bots play a full heist; along the way we prove the
// privacy claims with a stranger's VALID auth token and verify the deal at lights-on.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { PROGRAM_ID, TEE_RPC } from "../src/chain/config";
import fs from "node:fs";
import { GameClient, logPda, roomPda, viewPda, worldPda } from "../src/chain/client";
import { PH, PHASE_NAME, ROLE_MOLE, occupied } from "../src/chain/decode";
import { hex, sameBytes, useReplayBytes, verifyDeal, verifyReplay } from "../src/chain/verify";
import { log, sleep } from "./common";

useReplayBytes(fs.readFileSync(new URL("../src/chain/replay.wasm", import.meta.url)));
const roomId = Number(process.argv[2] ?? 34);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, note = "") => {
  results.push([name, ok, note]);
  log(ok ? "PASS" : "FAIL", name, note);
};

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms: number, label: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}`);
    await sleep(500);
  }
}

/** The `act` input byte of a fetched tx, or null if the instruction data isn't there. */
function actInput(tx: any): number | null {
  const msg = tx?.transaction?.message;
  if (!msg) return null;
  const keys: string[] = (msg.staticAccountKeys ?? msg.accountKeys ?? []).map((k: any) => new PublicKey(k.pubkey ?? k).toBase58());
  const ixs: any[] = msg.compiledInstructions ?? msg.instructions ?? [];
  for (const ix of ixs) {
    if (keys[ix.programIdIndex] !== PROGRAM_ID.toBase58()) continue;
    const d: Uint8Array = typeof ix.data === "string" ? utils.bytes.bs58.decode(ix.data) : Uint8Array.from(ix.data);
    if (d.length >= 9) return d[8];
  }
  return null;
}
const short = (e: unknown) => String((e as any)?.message ?? e).replace(/\s+/g, " ").slice(0, 90);

/**
 * Hiding accounts is not enough if a transaction can be fetched: `act`'s input byte carries
 * the cuff bit. Who can see a gameplay transaction, its data, or the history of the table?
 */
async function txVisibility(me: GameClient, stranger: GameClient, seat: number) {
  const IN_CUFF = 1 << 5;
  const opts = { commitment: "confirmed" as const, maxSupportedTransactionVersion: 0 };
  const probe = await me.act(roomId, IN_CUFF | 3); // a "cuff" press (ignored unless you're the Mole)
  await sleep(2000);
  type Seen = { found: boolean; input: number | null; keys: number; logs: number; err?: string };
  const fetchAs = async (c: Connection): Promise<Seen> => {
    try {
      const t: any = await c.getTransaction(probe, opts);
      if (!t) return { found: false, input: null, keys: 0, logs: 0 };
      const m = t.transaction?.message;
      return { found: true, input: actInput(t), keys: (m?.staticAccountKeys ?? m?.accountKeys ?? []).length, logs: (t.meta?.logMessages ?? []).length };
    } catch (e) { return { found: false, input: null, keys: 0, logs: 0, err: short(e) }; }
  };
  // The TEE RPC answers getTransaction with a redacted shell: signature + slot + time, no accounts,
  // no instruction data, no logs. A tx "existing" leaks nothing because every seat sends at 10 Hz.
  const redacted = (r: Seen) => !r.found || (r.input === null && r.keys === 0 && r.logs === 0);
  const note = (r: Seen) => r.found
    ? (redacted(r) ? "redacted shell: 0 accounts, 0 instructions, 0 logs" : `LEAK: ${r.keys} accounts, ${r.logs} logs, input ${r.input === null ? "?" : `0x${r.input.toString(16)}`}${(r.input ?? 0) & IN_CUFF ? " (cuff bit!)" : ""}`)
    : r.err ?? "not found";

  const st = await fetchAs(stranger.conn);
  check("another player sees no body of my act (no cuff bit)", redacted(st), note(st));
  const anonConn = new Connection(TEE_RPC, "confirmed");
  const anon = await fetchAs(anonConn);
  check("a no-token RPC caller sees no body of my act", redacted(anon), note(anon));
  const own = await fetchAs(me.conn);
  check("the TEE redacts even for the signer (nothing to subpoena)", redacted(own), note(own));

  // can a stranger DISCOVER my act signatures (they'd need them to fetch)?
  for (const [who, c] of [["stranger", stranger.conn], ["no-token", anonConn]] as const) {
    try {
      const sigs = await c.getSignaturesForAddress(me.pubkey, { limit: 100 });
      const hasProbe = sigs.some((s) => s.signature === probe);
      check(`${who} can't list my gameplay signatures`, !hasProbe, `${sigs.length} listed${hasProbe ? ", including the cuff probe" : ""}`);
    } catch (e) { check(`${who} can't list my gameplay signatures`, true, short(e)); }
  }

  const base = await fetchAs(me.base);
  check("gameplay never touches Solana base layer", !base.found, base.found ? "on base layer!" : "not on devnet");

  for (const [name, addr] of [["World", worldPda(roomId)], ["my View", viewPda(roomId, seat)], ["Room", roomPda(roomId)]] as const) {
    let n = -1; let err = "";
    try { n = (await stranger.conn.getSignaturesForAddress(addr, { limit: 50 })).length; } catch (e) { err = short(e); }
    const sealed = name !== "Room";
    const ok = sealed ? n <= 0 : true; // Room history is public by design; listed for information
    check(`stranger tx history of ${name}${sealed ? " is hidden" : " (public by design)"}`, ok, n >= 0 ? `${n} signatures` : err);
  }

  // live log stream: does a stranger see every player's act go by?
  let seen = 0; let leakedInput = false;
  const sub = stranger.conn.onLogs(PROGRAM_ID, (l) => { seen++; if (l.logs.some((x) => /input|cuff/i.test(x))) leakedInput = true; }, "confirmed");
  for (let k = 0; k < 10; k++) { await me.act(roomId, 0).catch(() => {}); await sleep(100); }
  await sleep(1500);
  await stranger.conn.removeOnLogsListener(sub).catch(() => {});
  check("program logs never carry inputs or roles", !leakedInput, `stranger saw ${seen} log events in 2.5 s`);
}

async function main() {
  const me = new GameClient(Keypair.generate());
  const stranger = new GameClient(Keypair.generate());
  await me.connect();
  await stranger.connect();
  log("player", me.pubkey.toBase58(), "stranger", stranger.pubkey.toBase58());

  let room = (await me.fetchRoom(roomId))!;
  check("room is readable by anyone (public)", !!room, `phase ${PHASE_NAME[room?.phase ?? 0]}`);
  // clean slate
  if (room.phase === PH.ENDED) { await me.finish(roomId).catch(() => {}); room = (await me.fetchRoom(roomId))!; }
  if (room.phase === PH.REVEALED) { await me.reset(roomId); room = (await me.fetchRoom(roomId))!; }
  if (room.phase !== PH.LOBBY) throw new Error(`room ${roomId} is busy (${PHASE_NAME[room.phase]}); pick another`);

  const seat = Array.from({ length: room.maxPlayers }, (_, i) => i).find((i) => !occupied(room, i))!;
  await me.join(roomId, seat, "E2E");
  log("joined seat", seat);

  // privacy before the deal: the stranger can't read my View, I can
  const mine = await me.tryRead(viewPda(roomId, seat));
  const theirs = await stranger.tryRead(viewPda(roomId, seat));
  check("seat owner can read their own View", mine.ok, mine.note);
  check("stranger with a valid token is refused my View", !theirs.ok, theirs.note);

  const t0 = Date.now();
  await me.startMatch(roomId, 6);
  room = await waitFor(async () => { const r = await me.fetchRoom(roomId); return r && r.phase >= PH.PLAY ? r : null; }, 20_000, "VRF deal");
  check("VRF callback dealt the roles", room.seedState === 1, `seed_state=${room.seedState} in ${Date.now() - t0} ms`);

  const v0 = (await me.fetchView(roomId, seat))!;
  check("my View holds my role", v0.role === 0 || v0.role === 1, v0.role === ROLE_MOLE ? "I am the Mole" : "I am crew");

  // the deal commitment goes to Solana while everything is still sealed
  await me.commitDeal(roomId).catch((e) => log("  commit_deal:", String(e?.message ?? e).slice(0, 80)));
  const baseDeal = await waitFor(async () => {
    const b = await me.fetchBaseRoom(roomId);
    return b && b.matchNo === room.matchNo && sameBytes(b.dealCommit, room.dealCommit) ? b : null;
  }, 60_000, "deal commitment on Solana").catch(() => null);
  check("the deal commitment is on Solana before play", !!baseDeal && !room.dealCommit.every((x) => x === 0), hex(room.dealCommit).slice(0, 16));
  const lg = await stranger.tryRead(logPda(roomId));
  check("stranger is refused the sealed move log", !lg.ok, lg.note);

  const w = await stranger.tryRead(worldPda(roomId));
  const w2 = await me.tryRead(worldPda(roomId));
  const ov = await me.tryRead(viewPda(roomId, (seat + 1) % 8));
  check("stranger is refused the sealed World", !w.ok, w.note);
  check("a seated player is refused the sealed World too", !w2.ok, w2.note);
  check("a seated player is refused another seat's View", !ov.ok, ov.note);

  // crank: ticks advance on their own
  const ta = (await me.fetchRoom(roomId))!.tick;
  await sleep(3000);
  const tb = (await me.fetchRoom(roomId))!.tick;
  const rate = (tb - ta) / 3;
  check("crank ticks the heist inside the TEE", tb > ta, `${rate.toFixed(1)} ticks/s`);

  // move around a bit with the uniform `act` instruction (constant rate)
  for (let k = 0; k < 20; k++) {
    await me.act(roomId, k < 10 ? 3 : 7).catch(() => {});
    await sleep(100);
  }
  const v1 = (await me.fetchView(roomId, seat))!;
  check("act moves my sealed position", v1.meX !== v0.meX || v1.meY !== v0.meY, `(${v0.meX},${v0.meY}) -> (${v1.meX},${v1.meY})`);

  await txVisibility(me, stranger, seat);

  // let the bots play it out; we vote skip in meetings
  log("letting the heist play out…");
  const end = await waitFor(async () => {
    const r = await me.fetchRoom(roomId);
    if (!r) return null;
    if (r.phase === PH.MEETING && !(r.votedMask & (1 << seat))) await me.vote(roomId, 254).catch(() => {});
    if (r.phase === PH.PLAY || r.phase === PH.MEETING || r.phase === PH.RESULT) await me.act(roomId, 0).catch(() => {});
    if (Date.now() % 7 === 0) log(`  ${PHASE_NAME[r.phase]} tick ${r.tick} tasks ${r.taskDone}/${r.taskTotal}`);
    return r.phase >= PH.ENDED ? r : null;
  }, 15 * 60_000, "game end");
  check("the heist ends with a winner", end.winner === 0 || end.winner === 1, end.winner === 1 ? "Mole wins" : "Crew wins");
  check("roles are published only at the end", end.rolesPub.some((x) => x === 1), "");

  if (end.phase === PH.ENDED) await me.finish(roomId);
  const revealed = await waitFor(async () => { const r = await me.fetchRoom(roomId); return r && r.phase === PH.REVEALED ? r : null; }, 20_000, "lights on");
  const wr = await stranger.tryRead(worldPda(roomId));
  check("after lights-on the World is public", wr.ok, wr.note);
  const world = (await stranger.fetchWorld(roomId))!;
  const rep = await verifyDeal(revealed, world);
  check("seed = sha256(vrf || salts || room || heist)", rep.seedOk, rep.seedHex.slice(0, 16));
  check("replayed shuffle == revealed roles", rep.rolesOk, "");

  // replay the whole heist with the program's own rules (WASM) and check every commitment
  const raw = (await stranger.fetchRevealed(roomId))!;
  const rp = await verifyReplay(raw.room, raw.world, raw.log);
  check("the move log is public after lights-on", raw.log.length > 100, `${rp.records} records over ${rp.steps} steps`);
  check("WASM replay rebuilds the exact revealed World + result", rp.ok, rp.ok ? "" : JSON.stringify(rp));
  check("revealed seed matches the deal commitment", rp.commit, rp.dealCommit.slice(0, 16));
  check("move log hash chain matches the Room's", rp.chain, rp.logHash.slice(0, 16));
  const baseEnd = await waitFor(async () => {
    const b = await me.fetchBaseRoom(roomId);
    return b && b.matchNo === revealed.matchNo && b.phase >= PH.ENDED ? b : null;
  }, 90_000, "result commit on Solana").catch(() => null);
  check("Solana holds the same result + log hash (free table commit)", !!baseEnd && sameBytes(baseEnd.logHash, revealed.logHash) && baseEnd.winner === revealed.winner, baseEnd ? `winner ${baseEnd.winner}` : "not landed");

  await me.reset(roomId);
  const back = (await me.fetchRoom(roomId))!;
  const sealed = await stranger.tryRead(worldPda(roomId));
  check("reset re-seals the World", back.phase === PH.LOBBY && !sealed.ok, sealed.note);
  await me.leave(roomId, seat).catch(() => {});

  console.log("\n==== E2E against devnet TEE ====");
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  — ${note}` : ""}`);
  console.log(`room ${roomPda(roomId).toBase58()}`);
  process.exit(results.every((r) => r[1]) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  console.log("\n==== partial results ====");
  for (const [n, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `  — ${note}` : ""}`);
  process.exit(1);
});
