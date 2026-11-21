// The trust story, visible: the TEE keeps secrets during the heist, but it doesn't get to
// decide who won. Before play the deal is committed to Solana; at lights-on the browser
// replays the whole heist with the program's own rules (WASM) and checks every commitment.
import { useEffect, useState } from "react";
import { GameClient, roomPda } from "../chain/client";
import { explorerBase } from "../chain/config";
import { PH, RoomState } from "../chain/decode";
import { hex, ReplayReport, sameBytes, verifyReplay } from "../chain/verify";

const shortHex = (b: Uint8Array | string) => { const h = typeof b === "string" ? b : hex(b); return `${h.slice(0, 8)}…${h.slice(-6)}`; };
const isZero = (b: Uint8Array) => b.every((x) => x === 0);

/** During the heist: is the deal commitment already on Solana? (reads the base layer) */
export function DealLock({ client, room }: { client: GameClient; room: RoomState }) {
  const [onChain, setOnChain] = useState<Uint8Array | null>(null);
  const [seenAt, setSeenAt] = useState(0);
  const live = room.phase >= PH.PLAY && !isZero(room.dealCommit);
  const key = hex(room.dealCommit);
  useEffect(() => {
    if (!live) return;
    let stop = false;
    const poll = async () => {
      const r = await client.fetchBaseRoom(room.roomId).catch(() => null);
      if (stop) return;
      if (r && r.matchNo === room.matchNo && sameBytes(r.dealCommit, room.dealCommit)) {
        setOnChain(r.dealCommit);
        setSeenAt((t) => t || Date.now());
        return;
      }
      setTimeout(poll, 3000);
    };
    poll();
    return () => { stop = true; };
  }, [client, room.roomId, room.matchNo, key, live]);
  if (!live) return null;
  return (
    <div className="proofcard">
      <h3>⛓ Deal locked on Solana</h3>
      <div className={`check ${onChain ? "ok" : "wait"}`}>
        {onChain ? <>✓ Solana holds the deal commitment {shortHex(onChain)} since {new Date(seenAt).toLocaleTimeString()}</> : <>⏳ Committing the deal to Solana…</>}
      </div>
      <p className="muted tiny">H(seed ‖ room ‖ heist). The seed stays sealed until lights-on; then anyone checks it against this. The roles can't be swapped mid-game.</p>
      <a className="mono tiny" href={explorerBase(roomPda(room.roomId).toBase58())} target="_blank" rel="noreferrer">Room on Solana Explorer ↗</a>
    </div>
  );
}

/** At lights-on: replay the whole heist in the browser and check it against Solana. */
export function ReplayCheck({ client, room }: { client: GameClient; room: RoomState }) {
  const [rep, setRep] = useState<ReplayReport | null>(null);
  const [err, setErr] = useState("");
  const [base, setBase] = useState<RoomState | null>(null);
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (room.phase !== PH.REVEALED) return;
    let stop = false;
    (async () => {
      try {
        const raw = await client.fetchRevealed(room.roomId);
        if (!raw) throw new Error("couldn't read the revealed accounts");
        const t0 = performance.now();
        const r = await verifyReplay(raw.room, raw.world, raw.log);
        if (!stop) { setRep(r); setMs(Math.round(performance.now() - t0)); }
      } catch (e: any) {
        if (!stop) setErr(e?.message ?? String(e));
      }
    })();
    // the final commit lands on Solana a few seconds after lights-on
    const poll = async () => {
      const b = await client.fetchBaseRoom(room.roomId).catch(() => null);
      if (stop) return;
      if (b && b.matchNo === room.matchNo && (b.phase === PH.ENDED || b.phase === PH.REVEALED)) { setBase(b); return; }
      setTimeout(poll, 3000);
    };
    poll();
    return () => { stop = true; };
  }, [client, room.roomId, room.matchNo, room.phase]);

  const onSolana = base && sameBytes(base.logHash, room.logHash) && sameBytes(base.dealCommit, room.dealCommit) && base.winner === room.winner;
  return (
    <div className="proofcard">
      <h3>🔁 Replay the heist</h3>
      {!rep && !err && <p className="muted small">Replaying every step with the program's own rules (WebAssembly)…</p>}
      {err && <div className="check bad">✗ {err}</div>}
      {rep && (
        <>
          <div className={`check ${rep.ok ? "ok" : "bad"}`}>
            {rep.ok ? <>✓ {rep.steps.toLocaleString()} steps replayed in {ms} ms: same World, same winner</> : <>✗ The replay disagrees{rep.world ? ` (World.${rep.world})` : rep.room ? ` (result: ${rep.room})` : rep.error ? `: ${rep.error}` : ""}</>}
          </div>
          <div className={`check ${rep.commit ? "ok" : "bad"}`}>{rep.commit ? "✓" : "✗"} revealed seed matches the deal commitment {shortHex(rep.dealCommit)}</div>
          <div className={`check ${rep.chain ? "ok" : "bad"}`}>{rep.chain ? "✓" : "✗"} move log ({rep.records.toLocaleString()} records) hashes to {shortHex(rep.logHash)}</div>
          <div className={`check ${onSolana ? "ok" : "wait"}`}>
            {onSolana ? <>✓ Solana holds the same result, log hash and commitment</> : <>⏳ Waiting for the result commit to land on Solana…</>}
          </div>
          <p className="muted tiny">The enclave was trusted only to keep secrets during the game. Who won (and who gets paid) is re-derived here from public data.</p>
        </>
      )}
    </div>
  );
}
