import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-sdk";
import { GameClient, loadSessionKey, randomNonce, TxEvent } from "./chain/client";
import { FAUCET_URL, ROOM_IDS, STAKED_ROOM_IDS, TEE_RPC, USDC_FAUCET_URL } from "./chain/config";
import { PublicKey } from "@solana/web3.js";
import { RoomState, PH, PHASE_NAME, occupied, MAXP, isEmptyKey } from "./chain/decode";
import Landing, { LandingStats } from "./ui/Landing";
import ChainLog from "./ui/ChainLog";
import Avatar from "./ui/Avatar";
import { sfx, isMuted, setMuted, onMute } from "./game/sfx";
import { short, usdc, useWallet, WalletState } from "./ui/wallet";
import { trackEvent } from "./analytics";
import { PhoneIntro, PhoneMenu } from "./ui/PhoneHome";
import { goLandscape, useMedia, usePhone } from "./ui/phone";

// the game screen (canvas renderer, minigames, cinematics) loads only when you sit down
const RoomScreen = lazy(() => import("./ui/RoomScreen"));

type Enclave = "checking" | "verified" | "unverified";
const ALL_IDS = [...ROOM_IDS, ...STAKED_ROOM_IDS];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Where a staked join is (shown as a 3-step tracker). */
interface StakeFlow { roomId: number; step: 0 | 1 | 2 | 3; note: string; err?: string }

export default function App() {
  const session = useMemo(() => loadSessionKey(), []);
  const [client, setClient] = useState<GameClient | null>(null);
  const [err, setErr] = useState("");
  const [enclave, setEnclave] = useState<Enclave>("checking");
  const [rooms, setRooms] = useState<Record<number, RoomState | null>>({});
  const [name, setName] = useState(() => { try { return localStorage.getItem("ij.name") || ""; } catch { return ""; } });
  const [active, setActive] = useState<{ id: number; spectate: boolean } | null>(null);
  const [txs, setTxs] = useState<TxEvent[]>([]);
  const txTotals = useRef({ all: 0, acts: 0 });
  const [busy, setBusy] = useState<number | null>(null);
  const [how, setHow] = useState(false);
  const [flow, setFlow] = useState<StakeFlow | null>(null);
  const [muted, setM] = useState(isMuted());
  useEffect(() => onMute(setM), []);
  const w = useWallet();
  // phones: the whole app is a landscape game, opening on an intro every launch
  const phone = usePhone();
  const portrait = useMedia("(orientation: portrait)");
  const [started, setStarted] = useState(false);
  const [about, setAbout] = useState(false);
  const start = () => { goLandscape(); sfx.join(); setStarted(true); };

  useEffect(() => {
    const c = new GameClient(session);
    c.connect().then(() => setClient(c)).catch((e) => setErr(`Could not reach the TEE rollup: ${e?.message ?? e}`));
    verifyTeeRpcIntegrity(TEE_RPC).then(() => setEnclave("verified")).catch(() => setEnclave("unverified"));
  }, [session]);

  useEffect(() => {
    if (!client) return;
    const off = client.onTx((e) => setTxs((prev) => {
      const i = prev.findIndex((p) => p.sig === e.sig);
      if (i >= 0) { const n = [...prev]; n[i] = { ...n[i], ...e }; return n; }
      txTotals.current.all++;
      if (e.label === "act") txTotals.current.acts++;
      // moves stream at 10/s: cap them, but never let them push joins/chats/votes out of the log
      let acts = 0;
      return [e, ...prev].filter((t) => t.label !== "act" || ++acts <= 120).slice(0, 220);
    }));
    return off;
  }, [client]);

  // live network numbers for the landing page: TEE round trip + measured crank rate
  const [net, setNet] = useState<{ teeMs: number | null; tickRate: number | null }>({ teeMs: null, tickRate: null });
  const tickSeen = useRef<Record<number, { tick: number; at: number }>>({});

  // the room list is only polled outside a room, so it is stale right after you leave one
  const roomsFresh = useRef(false);
  useEffect(() => {
    if (!client || active) return;
    roomsFresh.current = false;
    let stop = false;
    const poll = async () => {
      try {
        const t0 = performance.now();
        const r = await client.fetchRooms(ALL_IDS);
        const ms = Math.round(performance.now() - t0);
        if (stop) return;
        roomsFresh.current = true;
        setRooms(Object.fromEntries(ALL_IDS.map((id, k) => [id, r[k]])));
        let rate: number | null = null;
        for (const room of r) {
          if (!room || room.phase !== PH.PLAY) continue;
          const prev = tickSeen.current[room.roomId];
          const now = Date.now();
          if (prev && room.tick > prev.tick && now > prev.at) rate = ((room.tick - prev.tick) * 1000) / (now - prev.at);
          tickSeen.current[room.roomId] = { tick: room.tick, at: now };
        }
        setNet((n) => ({ teeMs: n.teeMs === null ? ms : Math.round(n.teeMs * 0.7 + ms * 0.3), tickRate: rate ?? n.tickRate }));
        // self-healing: any visitor's browser nudges stuck rooms forward (all permissionless)
        heal(client, r).catch(() => {});
      } catch { /* retry */ }
      if (!stop) setTimeout(poll, 2500);
    };
    poll();
    return () => { stop = true; };
  }, [client, active]);

  // rejoin automatically if this browser already holds a seat somewhere
  // (skip a room you just left: the cached list still shows your seat until the next poll)
  const justLeft = useRef({ id: 0, at: 0 });
  useEffect(() => {
    if (!client || active || !roomsFresh.current) return;
    const me = client.pubkey.toBase58();
    const recent = Date.now() - justLeft.current.at < 15_000;
    const r = Object.values(rooms).find((x) => x && x.players.includes(me) && !(recent && x.roomId === justLeft.current.id));
    if (r) setActive({ id: r.roomId, spectate: false });
  }, [rooms, client, active]);

  // the phone's back gesture / browser Back leaves the room instead of the site
  const [backTick, setBackTick] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!active) return;
    if (history.state?.ij !== "room") history.pushState({ ij: "room" }, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  useEffect(() => {
    const onPop = () => { if (activeRef.current) setBackTick((n) => n + 1); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const exitRoom = () => {
    if (active) justLeft.current = { id: active.id, at: Date.now() };
    setActive(null);
    if (history.state?.ij === "room") history.back();
  };

  // invite links: ?crew=11 drops you into that crew (free tables) or its lobby view (staked)
  const [invite, setInvite] = useState(() => Number(new URLSearchParams(location.search).get("crew") || 0));
  useEffect(() => {
    if (!client || active || !invite) return;
    const r = rooms[invite];
    if (r === undefined) return;
    setInvite(0);
    history.replaceState(null, "", location.pathname);
    if (!r) return;
    if (r.players.includes(client.pubkey.toBase58())) return;
    if (r.stake === 0 && r.phase === PH.LOBBY) join(r);
    else setActive({ id: r.roomId, spectate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, client, active, invite]);

  const codename = () => {
    const nm = (name.trim() || "AGENT").toUpperCase();
    try { localStorage.setItem("ij.name", nm); } catch { /* ignore */ }
    return nm;
  };
  const freeSeat = (r: RoomState) => Array.from({ length: r.maxPlayers }, (_, i) => i).find((i) => !occupied(r, i));

  const join = async (r: RoomState) => {
    if (!client) return;
    if (r.stake > 0) return joinStaked(r);
    const seat = freeSeat(r);
    if (seat === undefined) { setErr("That crew is full."); return; }
    setBusy(r.roomId);
    setErr("");
    try {
      await client.join(r.roomId, seat, codename());
      trackEvent("join", { room: r.roomId, table: "free" });
      sfx.join();
      setActive({ id: r.roomId, spectate: false });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Staked: 1) wallet  2) ticket on Solana (stake → Pot)  3) seat in the TEE rollup. */
  const joinStaked = async (r: RoomState) => {
    if (!client) return;
    const seat = freeSeat(r);
    if (seat === undefined) { setErr("That table is full."); return; }
    const id = r.roomId;
    setErr("");
    setBusy(id);
    try {
      setFlow({ roomId: id, step: 0, note: "Connect a Devnet wallet" });
      let ws: WalletState | null = w.wallet;
      if (!ws) ws = await w.connect();
      const nonce = r.potNonce || randomNonce();
      const pot = await client.fetchPot(id, nonce);
      const mine = pot && pot.wallets.slice(0, pot.n).indexOf(ws.pubkey.toBase58());
      if (pot && mine !== null && mine >= 0 && pot.sessions[mine] !== client.pubkey.toBase58()) {
        throw new Error("This wallet already holds a ticket for this pot from another browser. Play from there.");
      }
      if (!pot || mine === null || mine < 0) {
        setFlow({ roomId: id, step: 1, note: `Approve ${usdc(r.stake)} USDC into the Pot (Solana devnet)` });
        if ((await client.tokenUnits(ws.pubkey, new PublicKey(r.mint))) < r.stake) throw new Error(`This table needs ${usdc(r.stake)} devnet USDC. Get some at faucet.circle.com (Solana Devnet), then try again.`);
        await client.buyTicket(ws.wallet, id, nonce, new PublicKey(r.mint));
        w.refresh();
      }
      setFlow({ roomId: id, step: 2, note: "Taking your seat inside the TEE rollup…" });
      let last: unknown = null;
      for (let k = 0; k < 8; k++) {
        try {
          await client.join(id, seat, codename(), ws.pubkey, nonce);
          last = null;
          break;
        } catch (e: any) {
          last = e;
          // the rollup may not have cloned the fresh Pot yet; give it a moment
          if (!/ticket|NoTicket|retry/i.test(String(e?.message ?? e))) break;
          await sleep(1500);
        }
      }
      if (last) throw last;
      setFlow({ roomId: id, step: 3, note: "Seated. Good luck." });
      trackEvent("join", { room: id, table: "staked", stake: r.stake });
      sfx.join();
      setTimeout(() => setFlow(null), 900);
      setActive({ id, spectate: false });
    } catch (e: any) {
      const m = e?.message ?? String(e);
      setFlow((f) => { if (f) trackEvent("stake_failed", { room: id, step: f.step }); return f ? { ...f, err: m } : f; });
    } finally {
      setBusy(null);
    }
  };

  const humansOf = (r: RoomState) => Array.from({ length: MAXP }, (_, i) => i).filter((i) => !isEmptyKey(r.players[i])).length;
  const quickPlay = () => {
    const open = ROOM_IDS.map((id) => rooms[id]).filter((r): r is RoomState => !!r && r.phase === PH.LOBBY && humansOf(r) < r.maxPlayers);
    if (!open.length) { setErr("Every crew is mid-heist right now. Watch one, or try again in a minute."); return; }
    open.sort((a, b) => humansOf(b) - humansOf(a));
    trackEvent("play_free_click", { room: open[0].roomId });
    join(open[0]);
  };

  const walletButton = w.wallet ? (
    <button className="badge walletbtn on" title="Devnet wallet (staked tables). Click to disconnect." onClick={() => w.disconnect()}>
      ◎ {w.wallet.balance === null ? "…" : w.wallet.balance.toFixed(2)} · ${w.wallet.usdc === null ? "…" : w.wallet.usdc.toFixed(2)} · {short(w.wallet.pubkey.toBase58())}
    </button>
  ) : (
    <button className="badge walletbtn" onClick={() => w.connect().then((s) => trackEvent("wallet_connect", { wallet: s.name })).catch((e) => setErr(e?.message ?? String(e)))} title="Only needed for staked tables">
      ◎ {w.available ? `Connect ${w.available}` : "Connect wallet"}
    </button>
  );
  const muteButton = <button className="iconbtn" onClick={() => setMuted(!muted)} title="Sound">{muted ? "🔇" : "🔊"}</button>;
  const stats: LandingStats = {
    tables: Object.values(rooms).filter(Boolean).length || ALL_IDS.length,
    live: Object.values(rooms).filter((r) => r && r.phase >= PH.STARTING && r.phase <= PH.RESULT).length,
    humans: Object.values(rooms).reduce((n, r) => n + (r ? humansOf(r) : 0), 0),
    tickRate: net.tickRate,
    teeMs: net.teeMs,
  };

  const freeTables = (
    <div className="roomgrid">
      {ROOM_IDS.map((id) => <CrewCard key={id} id={id} r={client ? rooms[id] : undefined} busy={busy} onJoin={join} onWatch={() => setActive({ id, spectate: true })} />)}
    </div>
  );
  const stakedTables = (
    <div className="roomgrid">
      {STAKED_ROOM_IDS.map((id) => <CrewCard key={id} id={id} r={client ? rooms[id] : undefined} busy={busy} onJoin={join} onWatch={() => setActive({ id, spectate: true })} />)}
    </div>
  );
  const stakedNote = (
    <>
      {!w.available && <p className="muted small">No wallet detected. Install Phantom or Solflare and switch it to <b>Devnet</b>. Need test SOL? <a href={FAUCET_URL} target="_blank" rel="noreferrer">faucet.solana.com</a></p>}
      {w.wallet && (w.wallet.balance ?? 1) < 0.02 && <p className="muted small">Low on devnet SOL for fees. Top up at <a href={FAUCET_URL} target="_blank" rel="noreferrer">faucet.solana.com</a> (wallet {short(w.wallet.pubkey.toBase58())}).</p>}
      <p className="muted small">Stakes are <b>devnet USDC</b> (free test tokens): <a href={USDC_FAUCET_URL} target="_blank" rel="noreferrer">faucet.circle.com</a> → Solana Devnet{w.wallet ? <> → {short(w.wallet.pubkey.toBase58())}</> : null}.</p>
    </>
  );

  return (
    <div className={`shell ${phone ? "phone" : ""} ${phone && portrait ? "rot" : ""}`}>
      {phone && !started && <PhoneIntro onStart={start} />}
      {phone && !active && !about && (
        <PhoneMenu
          name={name} setName={setName} busy={busy !== null || !client}
          onPlayFree={quickPlay} onHow={() => setHow(true)} onAbout={() => setAbout(true)}
          enclave={enclave} walletButton={walletButton} muteButton={muteButton}
          freeTables={freeTables} stakedTables={stakedTables} stakedNote={stakedNote}
          chainLog={<ChainLog txs={txs} totals={txTotals.current} inline />}
          live={stats.live} humans={stats.humans}
        />
      )}
      {phone && !active && about && <button className="btn sm aboutback" onClick={() => setAbout(false)}>← Game</button>}
      {active && !phone && (
        <header className="topbar">
          <div className="brand" onClick={() => setActive(null)}>
            <MaskLogo /> INSIDE <b>JOB</b>
          </div>
          <div className="topright">
            <span className={`badge enclave ${enclave}`} title="verifyTeeRpcIntegrity: checks the Intel TDX attestation of MagicBlock's TEE RPC">
              {enclave === "verified" ? "● Enclave verified" : enclave === "checking" ? "○ Verifying enclave…" : "○ Attestation unavailable"}
            </span>
            <span className="badge mono hide-sm" title="your in-browser session key: signs every move, no wallet popups">
              🔑 {short(session.publicKey.toBase58())}
            </span>
            {walletButton}
            {muteButton}
          </div>
        </header>
      )}

      {err && <div className="error floaterr" onClick={() => setErr("")}>{err} <span className="muted">(tap to dismiss)</span></div>}

      {!active && (!phone || about) && (
        <Landing
          stats={stats}
          enclave={enclave}
          busy={busy !== null || !client}
          onPlayFree={quickPlay}
          onHow={() => setHow(true)}
          name={name}
          setName={setName}
          walletButton={walletButton}
          muteButton={muteButton}
          freeTables={freeTables}
          stakedTables={stakedTables}
          stakedNote={stakedNote}
        />
      )}

      {client && active && (
        <Suspense fallback={<div className="loading"><div className="spinner" />Loading the heist…</div>}>
          <RoomScreen client={client} roomId={active.id} spectate={active.spectate} wallet={w.wallet} onConnectWallet={w.connect} onExit={exitRoom} txs={txs} txTotals={txTotals.current} phone={phone} backTick={backTick} />
        </Suspense>
      )}

      {how && <HowTo onClose={() => setHow(false)} touch={phone} />}
      {flow && <StakeFlowModal flow={flow} onClose={() => setFlow(null)} />}
      {/* in a room the log lives in the 🔒 drawer; on phones it's the ⛓ menu button, so it never covers the game */}
      {!active && !phone && <ChainLog txs={txs} totals={txTotals.current} />}
    </div>
  );
}

/**
 * Keeper duties any browser can perform, so a room never stays stuck for the next visitor:
 *  - ENDED for a while (its players left before lights-on) → `finish` (unseal, commit, settle)
 *  - REVEALED for a while → `reset` (re-seal, back to the lobby; staked tables free their seats)
 *  - a lobby seat idle for 3+ minutes → `leave` clears it (the program allows anyone to)
 * Each room is nudged at most once a minute per browser, and only after a grace period,
 * so live players always get to act first.
 */
const healed: Record<string, number> = {};
const seenPhase: Record<number, { phase: number; since: number }> = {};
async function heal(client: GameClient, rooms: (RoomState | null)[]) {
  const now = Date.now();
  for (const r of rooms) {
    if (!r) continue;
    const sp = seenPhase[r.roomId];
    if (!sp || sp.phase !== r.phase) { seenPhase[r.roomId] = { phase: r.phase, since: now }; continue; }
    const age = (now - sp.since) / 1000;
    const once = (key: string, fn: () => Promise<unknown>) => {
      const k = `${r.roomId}:${key}`;
      if (healed[k] && now - healed[k] < 60_000) return;
      healed[k] = now;
      fn().catch(() => {});
    };
    if (r.phase === PH.ENDED && age > 20) once("finish", () => client.finish(r.roomId, r.potNonce));
    if (r.phase === PH.REVEALED && age > 120) once("reset", () => client.reset(r.roomId));
    if (r.phase === PH.LOBBY || r.phase === PH.REVEALED) {
      const unix = now / 1000;
      for (let s = 0; s < MAXP; s++) {
        if (isEmptyKey(r.players[s]) || r.isBot[s]) continue;
        if (r.lastSeen[s] && unix - r.lastSeen[s] > 200) once(`leave${s}`, () => client.leave(r.roomId, s));
      }
    }
  }
}

function CrewCard({ id, r, busy, onJoin, onWatch }: { id: number; r: RoomState | null | undefined; busy: number | null; onJoin: (r: RoomState) => void; onWatch: () => void }) {
  if (!r) return <div className="crewcard dim"><div className="cc-head"><b>{id >= 20 ? "TABLE" : "CREW"} #{id}</b></div><div className="muted">{r === undefined ? "connecting…" : "offline"}</div></div>;
  const humans = Array.from({ length: MAXP }, (_, i) => i).filter((i) => !isEmptyKey(r.players[i])).length;
  const open = r.phase === PH.LOBBY && humans < r.maxPlayers;
  const seated = Array.from({ length: MAXP }, (_, i) => i).filter((i) => occupied(r, i));
  const staked = r.stake > 0;
  return (
    <div className={`crewcard ${open ? "open" : "busy"} ${staked ? "stakedcard" : ""}`}>
      <div className="cc-head">
        <b>{staked ? "TABLE" : "CREW"} #{id}</b>
        <span className={`phase-pill p${r.phase}`}>{PHASE_NAME[r.phase]}</span>
      </div>
      {staked && <div className="stakechip">$ {usdc(r.stake)} USDC / seat{humans > 0 ? ` · pot ${usdc(r.stake * humans)}` : ""}</div>}
      <div className="cc-avatars">
        {seated.length === 0 && <span className="muted small">empty: be the first in</span>}
        {seated.map((i) => <Avatar key={i} seat={i} size={38} />)}
      </div>
      <div className="muted small">{humans}/{r.maxPlayers} agents · heist #{r.matchNo}</div>
      <div className="row">
        <button className={`btn ${staked ? "gold" : ""}`} disabled={!open || busy !== null} onClick={() => onJoin(r)}>
          {busy === id ? "…" : open ? (staked ? `STAKE ${usdc(r.stake)} USDC & JOIN` : "JOIN") : "IN PROGRESS"}
        </button>
        <button className="btn ghost" onClick={onWatch}>WATCH</button>
      </div>
    </div>
  );
}

function StakeFlowModal({ flow, onClose }: { flow: StakeFlow; onClose: () => void }) {
  const steps = ["Wallet", "Ticket on Solana", "Seat in the TEE"];
  return (
    <div className="modalwrap" onClick={flow.err ? onClose : undefined}>
      <div className="stakeflow" onClick={(e) => e.stopPropagation()}>
        {flow.err && <button className="xbtn" onClick={onClose}>✕</button>}
        <h2>TABLE #{flow.roomId}</h2>
        <div className="steps3">
          {steps.map((s, i) => (
            <div key={s} className={`st ${flow.step > i ? "done" : flow.step === i ? (flow.err ? "bad" : "now") : ""}`}>
              <span className="dotn">{flow.step > i ? "✓" : i + 1}</span>{s}
            </div>
          ))}
        </div>
        <p className={flow.err ? "error inline" : "muted"}>{flow.err ?? flow.note}</p>
        {!flow.err && flow.step < 3 && <div className="spinner" />}
      </div>
    </div>
  );
}

function HowTo({ onClose, touch }: { onClose: () => void; touch?: boolean }) {
  const steps: [number, string, string][] = touch ? [
    [2, "CREW", "Steer with the joystick, follow the yellow arrows and tap USE at each station. Fill the vault bar to win."],
    [0, "MOLE", "You look like everyone else. Tap CUFF on crew when nobody's watching. Fake your tasks."],
    [3, "REPORT", "Found someone in cuffs? Tap REPORT. Or tap ALARM at the button in the lobby."],
    [4, "VOTE", "Argue in chat, then cast a sealed ballot. Ballots flip public all at once."],
  ] : [
    [2, "CREW", "Follow the yellow arrows to your stations and press E to work them. Fill the vault bar to win."],
    [0, "MOLE", "You look like everyone else. Press Q to cuff crew when nobody's watching. Fake your tasks."],
    [3, "REPORT", "Found someone in cuffs? Press R. Or hit the alarm button in the lobby with F."],
    [4, "VOTE", "Argue in chat, then cast a sealed ballot. Ballots flip public all at once."],
  ];
  return (
    <div className="modalwrap" onClick={onClose}>
      <div className="howto" onClick={(e) => e.stopPropagation()}>
        <button className="xbtn" onClick={onClose}>✕</button>
        <h2>HOW TO PLAY</h2>
        <div className="steps">
          {steps.map(([seat, t, d], i) => (
            <div key={t} className="step">
              <Avatar seat={seat} size={64} mole={i === 1} ko={i === 2} animate />
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
        <p className="muted small center">Crew wins by finishing every task or dropping every Mole before the time lock. Moles win when they equal the crew, or when the time lock runs out.</p>
        <button className="btn big go" onClick={onClose}>GOT IT</button>
      </div>
    </div>
  );
}

const MaskLogo = () => (
  <svg viewBox="0 0 40 24" width="34" height="20" className="masklogo">
    <path d="M2 8c6-6 30-6 36 0 1 8-6 13-12 10l-6-4-6 4C8 21 1 16 2 8z" fill="#14171f" stroke="#ff4d6d" strokeWidth="2" />
    <ellipse cx="12" cy="10" rx="4" ry="3" fill="#f6f8fc" />
    <ellipse cx="28" cy="10" rx="4" ry="3" fill="#f6f8fc" />
    <circle cx="13" cy="10" r="1.5" fill="#ff2d55" />
    <circle cx="29" cy="10" r="1.5" fill="#ff2d55" />
  </svg>
);
