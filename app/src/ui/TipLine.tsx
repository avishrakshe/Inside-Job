// The Tip Line: spectators stake devnet USDC on who the Mole is. The stake sits in a
// Market on Solana; the call is made inside the rollup (signed by this browser's session
// key) and lands in the public Room. At lights-on a Magic Action copies the committed
// result into the Market. No oracle: the answer was sealed program state all along.
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { GameClient, marketPda } from "../chain/client";
import { explorerBase, USDC_FAUCET_URL } from "../chain/config";
import { MARKET_OPEN, MARKET_REFUNDED, MARKET_RESOLVED, MarketState, MAXP, NO_PICK, occupied, PH, ROLE_MOLE, RoomState } from "../chain/decode";
import { SEAT_COLORS } from "../game/render";
import { usdc, WalletState } from "./wallet";

const AMOUNTS = [500_000, 1_000_000, 2_000_000];

function useMarket(client: GameClient, room: RoomState, every = 3000) {
  const [m, setM] = useState<MarketState | null | undefined>(undefined);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const r = await client.fetchMarket(room.roomId, room.matchNo).catch(() => undefined);
      if (!stop) { if (r !== undefined) setM(r); setTimeout(poll, every); }
    };
    poll();
    return () => { stop = true; };
  }, [client, room.roomId, room.matchNo, every]);
  return [m, setM] as const;
}

/** During the heist, for spectators. */
export function TipLinePanel({ client, room, wallet, onConnectWallet }: { client: GameClient; room: RoomState; wallet: WalletState | null; onConnectWallet: () => Promise<WalletState> }) {
  const [market] = useMarket(client, room);
  const [amount, setAmount] = useState(AMOUNTS[1]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  const me = client.pubkey.toBase58();
  const entry = market ? market.sessions.slice(0, market.n).indexOf(me) : -1;
  const myPick = entry >= 0 ? room.tipSeat[entry] : NO_PICK;
  const crowd = Array.from({ length: MAXP }, (_, s) => room.tipSeat.filter((x, e) => x === s && e < room.tipN).length);
  const running = room.phase >= PH.PLAY && room.phase <= PH.RESULT;
  const pool = market ? market.amounts.slice(0, market.n).reduce((a, b) => a + b, 0) : 0;

  const stake = async () => {
    setErr(""); setBusy("stake");
    try {
      const ws = wallet ?? (await onConnectWallet());
      const mint = new PublicKey(room.mint);
      if ((await client.tokenUnits(ws.pubkey, mint)) < amount) throw new Error(`You need ${usdc(amount)} devnet USDC: faucet.circle.com → Solana Devnet.`);
      await client.buyTip(ws.wallet, room.roomId, room.matchNo, amount, mint);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(""); }
  };
  const pick = async (s: number) => {
    setErr(""); setBusy(`pick${s}`);
    // a fresh Market may take a moment to be cloned into the rollup
    for (let k = 0; k < 6; k++) {
      try { await client.pick(room.roomId, room.matchNo, s); setBusy(""); return; } catch (e: any) {
        const m = String(e?.message ?? e);
        if (!/tip|NoTip|retry/i.test(m) || k === 5) { setErr(m); break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    setBusy("");
  };

  if (!running) return null;
  return (
    <div className="hudcard tipline">
      <button className="tl-role" onClick={() => setOpen((o) => !o)}>📞 TIP LINE<span className="tl-count">{pool ? `${usdc(pool)} USDC` : "who's the Mole?"} {open ? "▴" : "▾"}</span></button>
      {open && (entry < 0 ? (
        <div className="tip-body">
          <p className="small muted">Stake devnet USDC on who the Mole is. Earlier calls pay more. Settled on Solana from the sealed result, no oracle.</p>
          <div className="row tip-amts">
            {AMOUNTS.map((a) => <button key={a} className={`qbtn ${a === amount ? "on" : ""}`} onClick={() => setAmount(a)}>{usdc(a)}</button>)}
            <span className="small muted">USDC</span>
          </div>
          <button className="btn sm gold" disabled={!!busy} onClick={stake}>{busy === "stake" ? "Approve in wallet…" : `Stake ${usdc(amount)} & call it`}</button>
          {wallet && (wallet.usdc ?? 0) * 1e6 < amount && <p className="tiny muted">Need devnet USDC? <a href={USDC_FAUCET_URL} target="_blank" rel="noreferrer">faucet.circle.com</a> (Solana Devnet)</p>}
        </div>
      ) : (
        <div className="tip-body">
          <p className="small">{myPick === NO_PICK ? <>Staked {usdc(market!.amounts[entry])} USDC. <b>Who's the Mole?</b></> : <>Your call: <b style={{ color: SEAT_COLORS[myPick] }}>{room.names[myPick]}</b> · weight {room.tipWeight[entry]}</>}</p>
          <div className="tip-seats">
            {Array.from({ length: MAXP }, (_, s) => s).filter((s) => occupied(room, s)).map((s) => (
              <button key={s} className={`tip-seat ${myPick === s ? "on" : ""}`} disabled={!!busy || room.alivePub[s] !== 1} onClick={() => pick(s)} style={{ borderColor: SEAT_COLORS[s] }}>
                <i style={{ background: SEAT_COLORS[s] }} />{room.names[s]}{crowd[s] > 0 && <span className="tip-n">{crowd[s]}</span>}
              </button>
            ))}
          </div>
          <p className="tiny muted">Re-calling resets your weight to now. Dead seats are out.</p>
        </div>
      ))}
      {err && <div className="error inline small">{err}</div>}
    </div>
  );
}

/** After the heist: who called it, what each entry gets, claims. */
export function TipResults({ client, room, wallet, onConnectWallet }: { client: GameClient; room: RoomState; wallet: WalletState | null; onConnectWallet: () => Promise<WalletState> }) {
  const [market, setMarket] = useMarket(client, room, 3500);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [since] = useState(Date.now());
  if (market === undefined || market === null || market.n === 0) return null;
  const me = client.pubkey.toBase58();
  const mine = wallet?.pubkey.toBase58();
  const run = async (what: string, fn: (ws: WalletState) => Promise<unknown>) => {
    setErr(""); setBusy(what);
    try {
      const ws = wallet ?? (await onConnectWallet());
      await fn(ws);
      const m = await client.fetchMarket(room.roomId, room.matchNo);
      if (m) setMarket(m);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(""); }
  };
  const mint = new PublicKey(room.mint);
  const resolved = market.status === MARKET_RESOLVED || market.status === MARKET_REFUNDED;
  return (
    <div className="proofcard potpanel">
      <h3>📞 Tip Line: {usdc(market.amounts.slice(0, market.n).reduce((a, b) => a + b, 0))} USDC</h3>
      <div className={`check ${resolved ? "ok" : "wait"}`}>
        {market.status === MARKET_RESOLVED && <>✓ Resolved on Solana from the committed result: no oracle</>}
        {market.status === MARKET_REFUNDED && <>↩ Refunded (the heist never resolved)</>}
        {market.status === MARKET_OPEN && <>⏳ Result committed → Magic Action `record_tips` running…</>}
      </div>
      <div className="payouts">
        {Array.from({ length: market.n }, (_, e) => e).map((e) => {
          const seat = resolved ? market.seats[e] : room.tipSeat[e];
          const right = seat < MAXP && room.rolesPub[seat] === ROLE_MOLE;
          const delta = market.paid[e] - market.amounts[e];
          const isMe = market.sessions[e] === me || market.wallets[e] === mine;
          const claimed = (market.claimed & (1 << e)) !== 0;
          return (
            <div key={e} className={`payrow ${isMe ? "me" : ""}`}>
              <span className="dotc" style={{ background: seat < MAXP ? SEAT_COLORS[seat] : "#666" }} />
              <span>{seat < MAXP ? <>called <b>{room.names[seat]}</b> {right ? "✓" : "✗"}</> : "no call"}{isMe && <span className="tag">YOU</span>}</span>
              <span className={`mono ${!resolved ? "muted" : delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
                {resolved ? `${delta > 0 ? "+" : ""}${usdc(delta)}` : `staked ${usdc(market.amounts[e])}`}
                {resolved && market.paid[e] > 0 && (claimed ? " · paid" : (
                  <button className="btn sm" style={{ marginLeft: 6 }} disabled={!!busy} onClick={() => run(`c${e}`, (ws) => client.claimTip(ws.wallet, room.roomId, room.matchNo, e, new PublicKey(market.wallets[e]), mint))}>
                    {busy === `c${e}` ? "…" : "Claim"}
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="row">
        <a className="mono tiny" href={explorerBase(marketPda(room.roomId, room.matchNo).toBase58())} target="_blank" rel="noreferrer">Market on Explorer ↗</a>
        {market.status === MARKET_OPEN && Date.now() - since > 25_000 && (
          <button className="btn sm" disabled={!!busy} onClick={() => run("rec", (ws) => client.recordTips(ws.wallet, room.roomId, room.matchNo))}>{busy === "rec" ? "…" : "Resolve it myself"}</button>
        )}
      </div>
      {err && <div className="error inline">{err}</div>}
    </div>
  );
}
