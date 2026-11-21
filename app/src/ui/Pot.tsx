import { useEffect, useState } from "react";
import { GameClient, potPda } from "../chain/client";
import { explorerAddr } from "../chain/config";
import { POT_OPEN, POT_REFUNDED, POT_SETTLED, PotState, RoomState } from "../chain/decode";
import { SEAT_COLORS } from "../game/render";
import { PublicKey } from "@solana/web3.js";
import { short, usdc, WalletState } from "./wallet";

const REFUND_AFTER = 20 * 60;

/**
 * The money, read straight from the Pot account on Solana. At lights-on the TEE commits
 * the Room and its Magic Action runs `settle` there; this panel just watches it happen.
 * If the action never lands, anyone can run the same settle (or, after 20 min, a refund).
 */
export function PotPanel({ client, room, wallet, onConnectWallet }: { client: GameClient; room: RoomState; wallet: WalletState | null; onConnectWallet: () => Promise<WalletState> }) {
  const [pot, setPot] = useState<PotState | null>(null);
  const [since] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const nonce = room.potNonce;

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const p = await client.fetchPot(room.roomId, nonce).catch(() => null);
      if (!stop) { if (p) setPot(p); setNow(Date.now()); }
      if (!stop) setTimeout(poll, 2500);
    };
    poll();
    return () => { stop = true; };
  }, [client, room.roomId, nonce]);

  const run = async (kind: "settle" | "refund") => {
    setErr("");
    setBusy(kind);
    try {
      const ws = wallet ?? (await onConnectWallet());
      if (kind === "settle") await client.settle(ws.wallet, room.roomId, nonce, new PublicKey(room.mint));
      else await client.refund(ws.wallet, room.roomId, nonce, new PublicKey(room.mint));
      const p = await client.fetchPot(room.roomId, nonce);
      if (p) setPot(p);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy("");
    }
  };

  if (!pot) return <div className="proofcard potpanel"><h3>💰 The pot</h3><p className="muted small">Reading the Pot on Solana…</p></div>;
  const total = pot.stake * pot.n;
  const me = wallet?.pubkey.toBase58();
  const waitedS = Math.round((now - since) / 1000);
  const refundable = pot.status === POT_OPEN && Date.now() / 1000 >= pot.createdAt + REFUND_AFTER;
  const seatOf = (w: string) => room.wallets.indexOf(w);
  return (
    <div className={`proofcard potpanel s${pot.status}`}>
      <h3>💰 The pot: {usdc(total)} USDC</h3>
      <div className={`check ${pot.status === POT_SETTLED ? "ok" : pot.status === POT_REFUNDED ? "" : "wait"}`}>
        {pot.status === POT_SETTLED && <>✓ Paid out on Solana from the sealed result: no oracle, no admin</>}
        {pot.status === POT_REFUNDED && <>↩ Refunded to every ticket</>}
        {pot.status === POT_OPEN && <>⏳ Room committed to Solana → Magic Action `settle` running… ({waitedS}s)</>}
      </div>
      <div className="payouts">
        {pot.wallets.slice(0, pot.n).map((w, i) => {
          const s = seatOf(w);
          const paid = pot.paid[i];
          const delta = paid - pot.stake;
          return (
            <div key={w} className={`payrow ${w === me ? "me" : ""}`}>
              <span className="dotc" style={{ background: s >= 0 ? SEAT_COLORS[s] : "#666" }} />
              <span>{s >= 0 ? room.names[s] : "unseated"} <span className="mono tiny muted">{short(w)}</span>{w === me && <span className="tag">YOU</span>}</span>
              <span className={`mono ${pot.status === POT_OPEN ? "muted" : delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
                {pot.status === POT_OPEN ? `staked ${usdc(pot.stake)}` : `${delta > 0 ? "+" : ""}${usdc(delta)} USDC`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="row">
        <a className="mono tiny" href={explorerAddr(potPda(room.roomId, nonce).toBase58())} target="_blank" rel="noreferrer">Pot account on Explorer ↗</a>
        {pot.status === POT_OPEN && waitedS > 25 && (
          <button className="btn sm" disabled={!!busy} onClick={() => run("settle")}>{busy === "settle" ? "…" : "Settle it myself"}</button>
        )}
        {refundable && <button className="btn sm ghost" disabled={!!busy} onClick={() => run("refund")}>{busy === "refund" ? "…" : "Refund everyone"}</button>}
      </div>
      {err && <div className="error inline">{err}</div>}
    </div>
  );
}
