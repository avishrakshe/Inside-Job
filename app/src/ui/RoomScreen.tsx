import { useCallback, useEffect, useRef, useState } from "react";
import { GameClient } from "../chain/client";
import { MAXP, PH, PHASE_NAME, ROLE_CREW, ROLE_MOLE, RoomState, ViewState, WorldState, isEmptyKey, occupied } from "../chain/decode";
import { draw, drawMinimap, SEAT_COLORS } from "../game/render";
import { dirFromKeys, GHOST_SPEED, HEIST_TICKS, ROOM_NAMES, SPEED, STATIONS, USE_R, step, dist2, tileAt } from "../game/map";
import { verifyDeal, VerifyReport } from "../chain/verify";
import { sfx, isMuted, setMuted, onMute } from "../game/sfx";
import { CuffedScreen, CuffFlash, Dealing, EjectScene, EndScreen, MeetingSplash, RoleReveal } from "./Cinematics";
import MeetingScreen from "./Meeting";
import TaskPanel from "./TaskPanel";
import { LobbyStage } from "./Scenes";
import { Chat, CheatConsole, SealMatrix, VerifyBox } from "./Proof";
import { PotPanel } from "./Pot";
import { WalletState, usdc } from "./wallet";
import { DealLock, ReplayCheck } from "./Trust";
import { TipLinePanel, TipResults } from "./TipLine";
import { trackEvent } from "../analytics";
import ChainLog from "./ChainLog";
import type { TxEvent } from "../chain/client";
import { FORCE_TOUCH, goLandscape, unrotate, useMedia } from "./phone";

/** Phone: a tap re-enters fullscreen landscape if the browser dropped out of it. */
const keepLandscape = () => { if (!document.fullscreenElement) goLandscape(); };

const IN_USE = 1 << 4, IN_CUFF = 1 << 5, IN_REPORT = 1 << 6, IN_EMERGENCY = 1 << 7;
const F_CAN_USE = 1, F_CAN_REPORT = 2, F_CAN_CUFF = 4, F_AT_BUTTON = 8;

interface Props {
  client: GameClient; roomId: number; spectate: boolean; wallet: WalletState | null; onConnectWallet: () => Promise<WalletState>; onExit: () => void;
  txs: TxEvent[]; txTotals: { all: number; acts: number };
  /** phone build: fullscreen landscape from the lobby on (the app shell handles rotation) */
  phone: boolean;
  /** bumps when the browser/phone Back gesture fires */
  backTick: number;
}

export default function RoomScreen({ client, roomId, spectate, wallet, onConnectWallet, onExit, txs, txTotals, phone, backTick }: Props) {
  const touch = useMedia("(pointer: coarse)") || FORCE_TOUCH;
  const [room, setRoom] = useState<RoomState | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [drawer, setDrawer] = useState(false);
  const me = client.pubkey.toBase58();
  const seat = room ? room.players.indexOf(me) : -1;
  const seated = seat >= 0 && !spectate;
  const roomRef = useRef<RoomState | null>(null);
  roomRef.current = room;

  // ---- live subscriptions (TEE websocket, authenticated by the session key's token)
  useEffect(() => {
    let alive = true;
    client.fetchRoom(roomId).then((r) => alive && r && setRoom(r));
    const off = client.subscribeRoom(roomId, (r) => setRoom(r));
    const poll = setInterval(() => client.fetchRoom(roomId).then((r) => alive && r && setRoom(r)).catch(() => {}), 3000);
    return () => { alive = false; off(); clearInterval(poll); };
  }, [client, roomId]);

  useEffect(() => {
    if (!seated) return;
    let alive = true;
    let lastAt = Date.now();
    const got = (v: ViewState) => { lastAt = Date.now(); setView(v); };
    client.fetchView(roomId, seat).then((v) => alive && v && got(v)).catch(() => {});
    const off = client.subscribeView(roomId, seat, (v) => alive && got(v));
    // websocket stalled? (sleeping laptop, flaky Wi-Fi, token refresh) fall back to polling
    const iv = setInterval(() => {
      const r = roomRef.current;
      const live = r && r.phase >= PH.PLAY && r.phase <= PH.RESULT;
      if (live && Date.now() - lastAt > 1500) client.fetchView(roomId, seat).then((v) => alive && v && got(v)).catch(() => {});
    }, 700);
    return () => { alive = false; off(); clearInterval(iv); };
  }, [client, roomId, seat, seated]);

  // lobby presence: a heartbeat (with a fresh sealed salt) so idle-seat cleanup never kicks you
  const phaseNow = room?.phase ?? -1;
  useEffect(() => {
    if (!seated || phaseNow !== PH.LOBBY) return;
    const iv = setInterval(() => client.setSalt(roomId).catch(() => {}), 60_000);
    return () => clearInterval(iv);
  }, [seated, phaseNow, client, roomId]);

  // ---- lights on: anyone seated unseals; then the World is public for everyone
  const phase = room?.phase ?? -1;
  useEffect(() => {
    if (phase === PH.ENDED && seated) {
      const nonce = roomRef.current?.potNonce ?? 0n;
      const t = setTimeout(() => client.finish(roomId, nonce).catch(() => {}), 1500 + seat * 400);
      return () => clearTimeout(t);
    }
    if (phase === PH.REVEALED) {
      client.fetchWorld(roomId).then(async (w) => {
        setWorld(w);
        if (w && roomRef.current) setReport(await verifyDeal(roomRef.current, w));
      }).catch(() => {});
    } else {
      setWorld(null);
      setReport(null);
    }
  }, [phase, seated, seat, client, roomId]);

  // ---- once dealt, push the deal commitment to Solana (any seated client; first one wins)
  const dealCommitted = room?.dealCommitted ?? 1;
  useEffect(() => {
    if (!seated || phase !== PH.PLAY || dealCommitted) return;
    const t = setTimeout(() => client.commitDeal(roomId).catch(() => {}), 800 + seat * 900);
    return () => clearTimeout(t);
  }, [seated, phase, dealCommitted, seat, client, roomId]);

  // ---- fresh sealed salt each time we're back in the lobby
  const saltFor = useRef(-1);
  useEffect(() => {
    if (room && seated && room.phase === PH.LOBBY && saltFor.current !== room.matchNo) {
      saltFor.current = room.matchNo;
      if (room.matchNo > 0) client.setSalt(roomId).catch(() => {});
    }
  }, [room, seated, client, roomId]);

  // ---- liveness: if the crank stalls, a seated client ticks (slot-gated on chain)
  const lastTick = useRef({ tick: -1, at: Date.now() });
  useEffect(() => {
    if (!room) return;
    if (room.tick !== lastTick.current.tick || room.phase !== PH.PLAY) lastTick.current = { tick: room.tick, at: Date.now() };
  }, [room]);
  useEffect(() => {
    if (!seated) return;
    const iv = setInterval(() => {
      const r = roomRef.current;
      if (!r) return;
      const running = r.phase === PH.PLAY || r.phase === PH.MEETING || r.phase === PH.RESULT;
      const stale = Date.now() - lastTick.current.at > 1200 + seat * 150;
      if (running && (stale || r.phase !== PH.PLAY)) client.tick(roomId).catch(() => {});
    }, 700);
    return () => clearInterval(iv);
  }, [seated, seat, client, roomId]);

  // ---- cinematics, driven purely by public Room phase + your own View
  const [roleShow, setRoleShow] = useState(false);
  const [splash, setSplash] = useState(false);
  const [cuffed, setCuffed] = useState(false);
  const [flash, setFlash] = useState(false);
  const [resultSince, setResultSince] = useState(0);
  const [endHidden, setEndHidden] = useState(false);
  const prevPhase = useRef(-1);
  const roleFor = useRef(-1);

  useEffect(() => {
    if (!room) return;
    const p = room.phase, prev = prevPhase.current;
    prevPhase.current = p;
    if (prev === -1 || prev === p) return;
    if (p === PH.MEETING) {
      setSplash(true);
      room.reported !== 255 ? sfx.body() : sfx.alarm();
      setTimeout(() => setSplash(false), 2600);
    }
    if (p === PH.RESULT) { setResultSince(Date.now()); setTimeout(() => sfx.eject(), 2700); }
    if (p === PH.ENDED) {
      setEndHidden(false);
      const mine = seat >= 0 ? room.rolesPub[seat] : 255;
      const moleWin = room.winner === 1;
      const won = (moleWin && mine === ROLE_MOLE) || (!moleWin && mine === ROLE_CREW);
      seat >= 0 && !won ? sfx.lose() : sfx.win();
      trackEvent("heist_end", { room: room.roomId, winner: moleWin ? "mole" : "crew", staked: room.stake > 0, seated: seat >= 0, won: seat >= 0 && won, ticks: room.tick });
    }
    if (p === PH.LOBBY) { setEndHidden(false); setCuffed(false); }
  }, [room, seat]);

  useEffect(() => {
    if (!room || !view || !seated) return;
    if (room.phase === PH.PLAY && (view.role === ROLE_CREW || view.role === ROLE_MOLE) && roleFor.current !== room.matchNo) {
      roleFor.current = room.matchNo;
      if (view.tick < 60) {
        setRoleShow(true);
        view.role === ROLE_MOLE ? sfx.moleReveal() : sfx.reveal();
        setTimeout(() => setRoleShow(false), 3800);
      }
    }
  }, [room, view, seated]);

  const prevAlive = useRef<number | null>(null);
  const prevCd = useRef(0);
  useEffect(() => {
    if (!view || !room) return;
    if (prevAlive.current === 1 && view.alive === 0 && room.phase === PH.PLAY && view.role === ROLE_CREW) {
      setCuffed(true);
      sfx.cuffed();
      setTimeout(() => setCuffed(false), 3200);
    }
    if (view.role === ROLE_MOLE && view.killCd >= 280 && prevCd.current < 280 && room.phase === PH.PLAY) {
      setFlash(true);
      sfx.cuff();
      setTimeout(() => setFlash(false), 900);
    }
    prevAlive.current = view.alive;
    prevCd.current = view.killCd;
  }, [view, room]);

  // phones: the whole room is a fullscreen landscape game; tablets go fullscreen for the heist
  const inHeist = !!room && room.phase >= PH.PLAY && room.phase <= PH.RESULT;
  const full = phone || (touch && inHeist);

  const leaveRef = useRef<() => void>(() => onExit());
  const firstBack = useRef(backTick);
  useEffect(() => { if (backTick !== firstBack.current) leaveRef.current(); }, [backTick]);

  if (!room) return <div className="loading"><div className="spinner" />Reading crew #{roomId} from the rollup…</div>;

  const leave = async () => {
    if (seated && (room.phase === PH.LOBBY || room.phase === PH.REVEALED)) await client.leave(roomId, seat).catch(() => {});
    onExit();
  };
  leaveRef.current = leave;

  return (
    <div className="roomscreen">
      <div className={`stagewrap ${full ? "full" : ""}`} onPointerUp={phone ? keepLandscape : undefined}>
        {room.phase === PH.LOBBY && <LobbyScreen client={client} room={room} seat={seat} seated={seated} roomId={roomId} onLeave={leave} onProof={() => setDrawer(true)} touch={touch} />}
        {room.phase === PH.STARTING && <Dealing room={room} canFallback={seated} onFallback={() => client.fallbackDeal(roomId).catch(() => {})} />}
        {room.phase >= PH.PLAY && (
          <GameView client={client} room={room} view={view} seat={seat} seated={seated} roomId={roomId} world={world}
            onLeave={leave} onProof={() => setDrawer((d) => !d)} blocked={roleShow || splash || cuffed} isTouch={touch}
            wallet={wallet} onConnectWallet={onConnectWallet} />
        )}
        {room.phase === PH.MEETING && !splash && <MeetingScreen client={client} room={room} view={view} seat={seat} seated={seated} roomId={roomId} />}
        {room.phase === PH.RESULT && <EjectScene room={room} since={resultSince || Date.now()} />}
        {(room.phase === PH.ENDED || room.phase === PH.REVEALED) && !endHidden && (
          <EndScreen room={room} seat={seated ? seat : -1} phase={room.phase} onHide={() => setEndHidden(true)}>
            {room.phase === PH.REVEALED && (
              <div className="end-actions">
                <ReplayCheck client={client} room={room} />
                <VerifyBox room={room} report={report} />
                {room.stake > 0 && room.potNonce !== 0n && <PotPanel client={client} room={room} wallet={wallet} onConnectWallet={onConnectWallet} />}
                {room.tipN > 0 && <TipResults client={client} room={room} wallet={wallet} onConnectWallet={onConnectWallet} />}
                <div className="row center">
                  {seated && <NextHeist client={client} roomId={roomId} />}
                  <button className="btn ghost" onClick={leave}>Leave crew</button>
                </div>
              </div>
            )}
          </EndScreen>
        )}
                {(room.phase === PH.ENDED || room.phase === PH.REVEALED) && endHidden && (
          <button className="btn showres" onClick={() => setEndHidden(false)}>Show results</button>
        )}
        {roleShow && view && <RoleReveal room={room} view={view} seat={seat} />}
        {splash && room.phase === PH.MEETING && <MeetingSplash room={room} />}
        {cuffed && <CuffedScreen seat={seat} />}
        {flash && <CuffFlash />}
        {drawer && (
          <div className="drawer">
            <div className="drawer-head"><b>PROOF</b><button className="xbtn" onClick={() => setDrawer(false)}>✕</button></div>
            <SealMatrix />
            {room.phase >= PH.PLAY && room.phase < PH.REVEALED && <DealLock client={client} room={room} />}
            {room.phase === PH.REVEALED && <ReplayCheck client={client} room={room} />}
            <CheatConsole client={client} roomId={roomId} seat={seated ? seat : -1} />
            {room.phase === PH.REVEALED && <VerifyBox room={room} report={report} />}
            <ChainLog txs={txs} totals={txTotals} inline />
          </div>
        )}
      </div>
    </div>
  );
}

function InviteButton({ roomId }: { roomId: number }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const url = `${location.origin}${location.pathname}?crew=${roomId}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Invite link", url); }
    trackEvent("invite_copied", { room: roomId });
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  };
  return <button className="btn ghost sm" onClick={copy} title="Copy a link that drops friends straight into this crew" aria-label="Invite">{done ? "✓" : "🔗"}<span className="lbl">{done ? " Copied" : " Invite"}</span></button>;
}

function NextHeist({ client, roomId }: { client: GameClient; roomId: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn big" disabled={busy} onClick={async () => { setBusy(true); await client.reset(roomId).catch(() => {}); setBusy(false); }}>
      {busy ? "Re-sealing…" : "NEXT HEIST"}
    </button>
  );
}

// ------------------------------------------------------------------ lobby

function LobbyScreen({ client, room, seat, seated, roomId, onLeave, onProof, touch }: {
  client: GameClient; room: RoomState; seat: number; seated: boolean; roomId: number; onLeave: () => void; onProof: () => void; touch: boolean;
}) {
  const [fill, setFill] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isHost = seated && room.host === client.pubkey.toBase58();
  const occ = Array.from({ length: MAXP }, (_, i) => occupied(room, i));
  const count = occ.filter(Boolean).length;
  const host = Array.from({ length: MAXP }, (_, i) => i).find((i) => room.players[i] === room.host && !isEmptyKey(room.host));
  const start = async () => {
    setBusy(true); setErr("");
    try { await client.startMatch(room.roomId, fill); trackEvent("heist_start", { room: room.roomId, fill, humans: room.nHumans, staked: room.stake > 0 }); } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="lobbyscreen">
      <div className="lobby-main">
        <div className="hud-row">
          <button className="btn ghost sm" onClick={onLeave} aria-label={seated ? "Leave" : "Back"}>←<span className="lbl"> {seated ? "Leave" : "Back"}</span></button>
          <div className="crewtag">CREW #{roomId} <span className="pill">{PHASE_NAME[room.phase]}</span></div>
          <span className="row">
            <InviteButton roomId={roomId} />
            <button className="btn ghost sm" onClick={onProof} aria-label="Proof">🔒<span className="lbl"> Proof</span></button>
          </span>
        </div>
        <LobbyStage names={room.names} occupied={occ} me={seated ? seat : -1} max={room.maxPlayers} />
        <div className="lobby-bar">
          <div className="count"><b>{count}</b>/{room.maxPlayers}</div>
          {room.stake > 0 && (
            <div className="potbadge" title="Every human seat staked this into the Pot on Solana. Winners split it at lights-on.">
              $ POT <b>{usdc(room.stake * room.nHumans)}</b> USDC<small>{usdc(room.stake)} / seat</small>
            </div>
          )}
          {isHost ? (
            <>
              <label className="fill">Bots fill to
                <select value={fill} onChange={(e) => setFill(+e.target.value)}>
                  {[4, 5, 6, 7, 8].filter((n) => n <= room.maxPlayers).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button className="btn big go" disabled={busy} onClick={start}>{busy ? "ROLLING VRF…" : "START HEIST"}</button>
            </>
          ) : (
            <div className="muted">{seated ? <>Waiting for <b style={{ color: host !== undefined ? SEAT_COLORS[host] : undefined }}>{host !== undefined ? room.names[host] : "the host"}</b> to start…</> : "Watching. The host starts the heist."}</div>
          )}
        </div>
        {err && <div className="error inline">{err}</div>}
      </div>
      <div className="lobby-side">
        <div className="panel grow">
          <h3>CREW CHAT</h3>
          <Chat client={client} room={room} roomId={roomId} seat={seat} seated={seated} canTalk />
        </div>
        <div className="panel">
          <h3>HOW TO PLAY</h3>
          {touch ? (
            <ul className="howlist">
              <li><span className="k">STICK</span> sneak around the bank</li>
              <li><span className="k">USE</span> work your station (crew) / fake it (Mole)</li>
              <li><span className="k">CUFF</span> Mole only, when nobody's watching</li>
              <li><span className="k">REPORT</span> a cuffed body</li>
              <li><span className="k">ALARM</span> at the button in the lobby</li>
              <li><span className="k">🗺</span> map</li>
            </ul>
          ) : (
            <ul className="howlist">
              <li><span className="k">WASD</span> sneak around the bank</li>
              <li><span className="k">E</span> work your station (crew) / fake it (Mole)</li>
              <li><span className="k">Q</span> cuff someone. Mole only, nobody watching</li>
              <li><span className="k">R</span> report a cuffed body</li>
              <li><span className="k">F</span> hit the alarm button in the lobby</li>
              <li><span className="k">M</span> map</li>
            </ul>
          )}
          <p className="muted small">1 Mole with 4–6 players, 2 with 7–8. Empty seats become on-chain bots that obey the same fog.</p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the heist

function GameView({ client, room, view, seat, seated, roomId, world, onLeave, onProof, blocked, isTouch, wallet, onConnectWallet }: {
  client: GameClient; room: RoomState; view: ViewState | null; seat: number; seated: boolean; roomId: number; world: WorldState | null;
  onLeave: () => void; onProof: () => void; blocked: boolean; isTouch: boolean;
  wallet: WalletState | null; onConnectWallet: () => Promise<WalletState>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keys = useRef<Record<string, boolean>>({});
  const edges = useRef(0);
  const pred = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const roomRef = useRef(room);
  roomRef.current = room;
  const [touch, setTouch] = useState({ dx: 0, dy: 0 });
  const touchRef = useRef(touch);
  touchRef.current = touch;
  const [task, setTask] = useState<{ st: number; slot: number; fake: boolean } | null>(null);
  const taskRef = useRef(task);
  taskRef.current = task;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const [mapOpen, setMapOpen] = useState(false);
  const [muted, setM] = useState(isMuted());
  useEffect(() => onMute(setM), []);
  const [banner, setBanner] = useState("");
  const [toast, setToast] = useState("");
  const [hintOff, setHintOff] = useState(() => { try { return localStorage.getItem("ij.hints") === "off"; } catch { return false; } });
  const dismissHints = () => { setHintOff(true); try { localStorage.setItem("ij.hints", "off"); } catch { /* ignore */ } };

  const currentDir = useCallback(() => {
    const k = keys.current;
    const t = touchRef.current;
    return dirFromKeys(k.w || k.arrowup || t.dy < -0.4, k.s || k.arrowdown || t.dy > 0.4, k.a || k.arrowleft || t.dx < -0.4, k.d || k.arrowright || t.dx > 0.4);
  }, []);

  /** Open the station mini-game: real task for crew, a convincing fake for the Mole. */
  const tryUse = useCallback(() => {
    const v = viewRef.current, p = pred.current;
    if (!v || !p || roomRef.current.phase !== PH.PLAY) return;
    let best: { st: number; slot: number } | null = null;
    v.taskSt.forEach((st, k) => {
      const S = STATIONS[st];
      if (!S || (v.role === ROLE_CREW && v.taskProg[k] === 255)) return;
      if (dist2(p.x, p.y, S.x, S.y) <= (USE_R + 6) * (USE_R + 6) && !best) best = { st, slot: k };
    });
    if (!best && v.role === ROLE_CREW && v.flags & F_CAN_USE) {
      const k = v.taskSt.findIndex((st, i) => st === v.nearStation && v.taskProg[i] !== 255);
      if (k >= 0) best = { st: v.taskSt[k], slot: k };
    }
    if (best) { sfx.click(); setTask({ ...(best as any), fake: v.role === ROLE_MOLE }); }
  }, []);

  // keyboard
  useEffect(() => {
    if (!seated) return;
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      keys.current[k] = true;
      if (k === "q") edges.current |= IN_CUFF;
      if (k === "r") edges.current |= IN_REPORT;
      if (k === "f") edges.current |= IN_EMERGENCY;
      if ((k === "e" || k === " ") && !e.repeat) { e.preventDefault(); if (!taskRef.current) tryUse(); }
      if (k === "m" && !e.repeat) setMapOpen((o) => !o);
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    const blur = () => { keys.current = {}; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [seated, tryUse]);

  // constant-rate input: one `act` every 100 ms whether or not you moved (timing leaks nothing)
  useEffect(() => {
    if (!seated) return;
    let n = 0;
    const iv = setInterval(() => {
      if (roomRef.current.phase !== PH.PLAY) return;
      const working = !!taskRef.current;
      const dir = working || blockedRef.current ? 0 : currentDir();
      const input = dir | (working ? IN_USE : 0) | edges.current;
      edges.current = 0;
      client.act(roomId, input).catch(() => {});
      const v = viewRef.current;
      if (v && pred.current) {
        const [nx, ny] = step(pred.current.x, pred.current.y, input, v.alive ? SPEED : GHOST_SPEED);
        pred.current = { x: nx, y: ny };
        if (dir && v.alive && ++n % 3 === 0) sfx.step();
      }
    }, 100);
    return () => clearInterval(iv);
  }, [seated, client, roomId, currentDir]);

  // reconcile prediction with the sealed truth
  useEffect(() => {
    if (!view) return;
    const p = pred.current;
    if (!p || dist2(p.x, p.y, view.meX, view.meY) > 40 * 40 || room.phase !== PH.PLAY) pred.current = { x: view.meX, y: view.meY };
    else pred.current = { x: p.x + (view.meX - p.x) * 0.35, y: p.y + (view.meY - p.y) * 0.35 };
  }, [view, room.phase]);

  // close the task screen when the heist pauses or the task is done
  useEffect(() => { if (room.phase !== PH.PLAY) setTask(null); }, [room.phase]);

  // room-name banner when you walk into a new room
  const lastRoom = useRef(-1);
  useEffect(() => {
    if (!view || room.phase !== PH.PLAY) return;
    const r = tileAt(view.meX, view.meY);
    if (r !== lastRoom.current && r !== 0 && r !== 8) {
      if (lastRoom.current !== -1) { setBanner(ROOM_NAMES[r]); setTimeout(() => setBanner(""), 1600); }
      lastRoom.current = r;
    }
  }, [view, room.phase]);

  // you saw someone cuff a crew member
  const seenWitness = useRef(0);
  useEffect(() => {
    if (view && view.witness && view.witness !== seenWitness.current) {
      seenWitness.current = view.witness;
      const k = view.witness - 1;
      setToast(`👁 You saw ${room.names[k] || "someone"} cuff a crew member!`);
      setTimeout(() => setToast(""), 5000);
    }
    if (view && !view.witness) seenWitness.current = 0;
  }, [view, room]);

  // render loop
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      const c = canvasRef.current;
      if (c) {
        // crisp on every screen, capped so big phones don't burn the GPU
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const ctx = c.getContext("2d")!;
        ctx.save();
        const r = roomRef.current;
        const showAll = r.phase === PH.REVEALED && world ? { x: world.x, y: world.y, role: world.role, alive: world.alive } : null;
        draw(ctx, w, h, { view: seated ? viewRef.current : null, me: seated ? pred.current : null, names: r.names, seat: seated ? seat : -1, showAll, t, follow: seated, dpr });
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [seated, seat, world]);

  const flags = view?.flags ?? 0;
  const press = (bit: number) => { edges.current |= bit; };
  /** Fire on touch-down (not click) so a button works while the other thumb is on the joystick. */
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); fn(); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") fn(); },
  });
  const mole = view?.role === ROLE_MOLE;
  const alive = view?.alive === 1;
  const nearMine = !!view && !!pred.current && view.taskSt.some((st, k) => {
    const S = STATIONS[st];
    return S && (mole || view.taskProg[k] !== 255) && dist2(pred.current!.x, pred.current!.y, S.x, S.y) <= (USE_R + 6) ** 2;
  });
  const canUse = (flags & F_CAN_USE) !== 0 || (mole && nearMine);
  const taskP = task && view ? (view.taskProg[task.slot] === 255 ? 1 : view.taskProg[task.slot] / 80) : 0;
  const taskDone = !!task && !!view && view.taskProg[task.slot] === 255;

  return (
    <div className="gamewrap">
      <canvas ref={canvasRef} className="game" />

      {/* top HUD */}
      <div className="hud-tl">
        <button className="btn ghost sm backbtn" onClick={onLeave} aria-label="Leave">←</button>
        <div className="hud-col">
          <VaultBar room={room} />
          {seated && view && (view.role === ROLE_CREW || view.role === ROLE_MOLE) && <TaskList view={view} room={room} />}
          {!seated && <div className="hudcard"><b>SPECTATING</b><div className="muted small">Positions are sealed in the enclave until lights-on. You see only the public Room.</div></div>}
          {!seated && <TipLinePanel client={client} room={room} wallet={wallet} onConnectWallet={onConnectWallet} />}
        </div>
      </div>
      <div className="hud-tr">
        <span className={`phase-pill p${room.phase}`}>{PHASE_NAME[room.phase]}</span>
        <button className="iconbtn" title="Map (M)" onClick={() => setMapOpen((o) => !o)}>🗺</button>
        <button className="iconbtn" title="Sound" onClick={() => setMuted(!muted)}>{muted ? "🔇" : "🔊"}</button>
        <button className="iconbtn" title="Proof: try to cheat" onClick={onProof}>🔒</button>
      </div>
      {!seated && <Roster room={room} />}

      {banner && <div className="roombanner" key={banner}>{banner}</div>}
      {toast && <div className="toast">{toast}</div>}
      {seated && room.phase === PH.PLAY && view && view.tick < 260 && !hintOff && (view.role === ROLE_CREW || view.role === ROLE_MOLE) && (
        <div className="hintbar">
          {view.alive === 0 ? <span>You're a ghost: float through walls and finish your tasks.</span>
            : isTouch ? (view.role === ROLE_MOLE
              ? <span>Stand at a console + <span className="k">USE</span> to fake it · <span className="k">CUFF</span> when nobody's watching</span>
              : <span>Follow the <b style={{ color: "var(--gold)" }}>yellow arrows</b> · tap <span className="k">USE</span> at a glowing console</span>)
            : view.role === ROLE_MOLE ? <span>Stand at a console + <span className="k">E</span> to fake it · <span className="k">Q</span> cuffs crew when nobody's watching</span>
            : <span>Follow the <b style={{ color: "var(--gold)" }}>yellow arrows</b> · <span className="k">E</span> at a glowing console · <span className="k">R</span> reports a body</span>}
          <button onClick={dismissHints} aria-label="hide hints">✕</button>
        </div>
      )}

      {seated && room.phase === PH.PLAY && view && (
        <div className="actions">
          {mole && alive && (
            <button className={`abtn cuff ${flags & F_CAN_CUFF ? "ready" : ""}`} {...tap(() => press(IN_CUFF))} style={{ ["--cd" as any]: Math.min(1, view.killCd / 380) }}>
              <IconCuff />{view.killCd > 0 && <span className="cdnum">{Math.ceil(view.killCd / 10)}</span>}<small>CUFF · Q</small>
            </button>
          )}
          {alive && (
            <button className={`abtn report ${flags & F_CAN_REPORT ? "ready" : ""}`} {...tap(() => press(IN_REPORT))}>
              <IconMega /><small>REPORT · R</small>
            </button>
          )}
          {alive && (
            <button className={`abtn alarm ${flags & F_AT_BUTTON ? "ready" : ""}`} {...tap(() => press(IN_EMERGENCY))}>
              <IconBell /><small>ALARM · F</small>
            </button>
          )}
          <button className={`abtn use ${canUse ? "ready" : ""}`} {...tap(tryUse)}>
            <IconHand /><small>USE · E</small>
          </button>
        </div>
      )}
      {seated && room.phase === PH.PLAY && <Joystick onChange={setTouch} />}

      {mapOpen && <MiniMap view={view} me={pred.current} seat={seated ? seat : -1} onClose={() => setMapOpen(false)} />}
      {task && room.phase === PH.PLAY && (
        <TaskPanel name={STATIONS[task.st]?.name ?? "Station"} chainP={taskP} done={taskDone} fake={task.fake} onClose={() => setTask(null)} />
      )}
    </div>
  );
}

function VaultBar({ room }: { room: RoomState }) {
  if (room.phase < PH.PLAY || room.taskTotal === 0) return null;
  const p = Math.min(1, room.taskDone / room.taskTotal);
  const left = Math.max(0, Math.ceil((HEIST_TICKS - room.tick) / 10));
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  return (
    <div className="vaultbar" title="Crew-wide progress. Per-player progress stays sealed: it would reveal who's faking. The time lock: if it hits zero, the alarm wins it for the Mole.">
      <span>VAULT</span>
      <div className="bar"><div style={{ width: `${p * 100}%` }} /></div>
      <span className="mono">{room.taskDone}/{room.taskTotal}</span>
      <span className={`timelock ${left <= 60 ? "hot" : ""}`}>⏱ {mm}:{ss}</span>
    </div>
  );
}

function TaskList({ view, room }: { view: ViewState; room: RoomState }) {
  const mole = view.role === ROLE_MOLE;
  const partners = Array.from({ length: MAXP }, (_, i) => i).filter((i) => view.partnerMask & (1 << i));
  const [open, setOpen] = useState(true);
  const left = view.taskProg.filter((p) => p !== 255).length;
  return (
    <div className={`hudcard tasklist ${mole ? "mole" : ""} ${open ? "" : "shut"}`}>
      <button className="tl-role" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {mole ? "MOLE" : "CREW"}{view.alive === 0 && <span className="tag ghost">{mole ? "caught" : "ghost"}</span>}
        <span className="tl-count">{mole ? "fake tasks" : `${left} left`} {open ? "▴" : "▾"}</span>
      </button>
      {open && (mole ? (
        <div className="small">
          <div className="mole">Cuff the crew when nobody's watching.</div>
          {partners.length > 0 && <div>Partner: {partners.map((p) => <b key={p} style={{ color: SEAT_COLORS[p] }}>{room.names[p]} </b>)}</div>}
          <div className="muted">Fake tasks:</div>
        </div>
      ) : view.alive === 0 ? <div className="small muted">You're a ghost. Finish your tasks!</div> : null)}
      {open && view.taskSt.map((st, k) => {
        const done = view.taskProg[k] === 255;
        return (
          <div key={k} className={`tl-task ${done && !mole ? "done" : ""}`}>
            <span>{STATIONS[st]?.name ?? `Station ${st}`}</span>
            {!mole && !done && view.taskProg[k] > 0 && <span className="mono small">{Math.round((view.taskProg[k] / 80) * 100)}%</span>}
            {!mole && done && <span>✓</span>}
          </div>
        );
      })}
    </div>
  );
}

function Roster({ room }: { room: RoomState }) {
  return (
    <div className="roster">
      {Array.from({ length: MAXP }, (_, i) => i).filter((i) => occupied(room, i)).map((i) => (
        <span key={i} className={`rchip ${room.alivePub[i] ? "" : "dead"}`} style={{ borderColor: SEAT_COLORS[i] }}>
          <i style={{ background: SEAT_COLORS[i] }} />{room.names[i]}
        </span>
      ))}
    </div>
  );
}

function MiniMap({ view, me, seat, onClose }: { view: ViewState | null; me: { x: number; y: number } | null; seat: number; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    let raf = 0;
    const f = (t: number) => {
      const c = ref.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        drawMinimap(c.getContext("2d")!, c.width, c.height, viewRef.current, meRef.current, t, seat);
      }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [seat]);
  return (
    <div className="minimap-wrap" onClick={onClose}>
      <div className="minimap" onClick={(e) => e.stopPropagation()}>
        <button className="xbtn" onClick={onClose}>✕</button>
        <canvas ref={ref} />
        <div className="muted small center">Yellow: your stations · red star: the alarm button</div>
      </div>
    </div>
  );
}

function Joystick({ onChange }: { onChange: (v: { dx: number; dy: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const handle = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const sy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    // app rotated 90° clockwise (portrait phone): screen → game axes
    const [dx, dy] = unrotate(ref.current!, sx, sy);
    const m = Math.min(1, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    setKnob({ x: Math.cos(a) * m * 34, y: Math.sin(a) * m * 34 });
    onChange({ dx: Math.cos(a) * m, dy: Math.sin(a) * m });
  };
  const end = () => { setKnob({ x: 0, y: 0 }); onChange({ dx: 0, dy: 0 }); };
  return (
    <div ref={ref} className="joystick" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); handle(e); }} onPointerMove={(e) => e.buttons && handle(e)} onPointerUp={end} onPointerCancel={end}>
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

// ------------------------------------------------------------------ icons (inline SVG, original)

const IconHand = () => (
  <svg viewBox="0 0 40 40" width="38" height="38"><path d="M12 22V11a2.5 2.5 0 015 0v8-11a2.5 2.5 0 015 0v11-9a2.5 2.5 0 015 0v10-6a2.5 2.5 0 015 0v11c0 7-5 12-11 12h-1c-5 0-7-2-10-6l-5-7a2.5 2.5 0 014-3z" fill="currentColor" stroke="#0b0f18" strokeWidth="2" strokeLinejoin="round" /></svg>
);
const IconCuff = () => (
  <svg viewBox="0 0 40 40" width="38" height="38"><g fill="none" stroke="currentColor" strokeWidth="4"><circle cx="12" cy="24" r="8" /><circle cx="28" cy="24" r="8" /><path d="M16 12h8" /></g><path d="M14 10h12v5H14z" fill="currentColor" /></svg>
);
const IconMega = () => (
  <svg viewBox="0 0 40 40" width="38" height="38"><path d="M6 16h7l15-8v24l-15-8H6z" fill="currentColor" stroke="#0b0f18" strokeWidth="2" strokeLinejoin="round" /><path d="M12 24l3 9h5l-3-9" fill="currentColor" stroke="#0b0f18" strokeWidth="2" /><path d="M32 14c3 3 3 9 0 12" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>
);
const IconBell = () => (
  <svg viewBox="0 0 40 40" width="38" height="38"><path d="M20 5c-6 0-10 5-10 11v7l-4 5h28l-4-5v-7c0-6-4-11-10-11z" fill="currentColor" stroke="#0b0f18" strokeWidth="2" strokeLinejoin="round" /><circle cx="20" cy="32" r="4" fill="currentColor" stroke="#0b0f18" strokeWidth="2" /></svg>
);
