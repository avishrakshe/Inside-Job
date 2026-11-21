import { useEffect, useState } from "react";
import { MAXP, NO_SEAT, ROLE_MOLE, RoomState, ViewState, VOTE_NONE, VOTE_SKIP, occupied } from "../chain/decode";
import { COLOR_NAMES, SEAT_COLORS } from "../game/render";
import Avatar from "./Avatar";

const seats = (room: RoomState) => Array.from({ length: MAXP }, (_, i) => i).filter((i) => occupied(room, i));

/** Shown once per heist when your sealed View first tells you your role. */
export function RoleReveal({ room, view, seat }: { room: RoomState; view: ViewState; seat: number }) {
  const mole = view.role === ROLE_MOLE;
  const partners = Array.from({ length: MAXP }, (_, i) => i).filter((i) => view.partnerMask & (1 << i));
  const behind = mole ? partners : seats(room).filter((i) => i !== seat);
  return (
    <div className={`cine role ${mole ? "is-mole" : "is-crew"}`}>
      <div className="cine-sub">{mole ? "your sealed View says…" : "your sealed View says…"}</div>
      <h1 className="cine-title">{mole ? "MOLE" : "CREW"}</h1>
      <div className="cine-line">
        {mole
          ? <>Cuff the crew when nobody's looking. {partners.length > 0 && <>Your partner: {partners.map((p) => <b key={p} style={{ color: SEAT_COLORS[p] }}>{room.names[p]} </b>)}</>}</>
          : <>There {room.nMoles === 1 ? "is" : "are"} <b className="mole">{room.nMoles} Mole{room.nMoles === 1 ? "" : "s"}</b> on this crew. Crack the vault. Trust no one.</>}
      </div>
      <div className="lineup">
        {behind.slice(0, 7).map((i, k, arr) => (
          <div key={i} className="lu back" style={{ ["--k" as any]: k < Math.ceil(arr.length / 2) ? k - Math.ceil(arr.length / 2) : k - Math.ceil(arr.length / 2) + 1 }}>
            <Avatar seat={i} size={84} mole={mole} animate />
          </div>
        ))}
        <div className="lu front"><Avatar seat={seat} size={150} mole={mole} animate /></div>
      </div>
      <div className="cine-foot mono">dealt by VRF ⊕ {room.nHumans} sealed player salt{room.nHumans === 1 ? "" : "s"} · nobody else can read this</div>
    </div>
  );
}

export function MeetingSplash({ room }: { room: RoomState }) {
  const body = room.reported !== NO_SEAT;
  return (
    <div className={`cine splash ${body ? "is-body" : "is-emergency"}`}>
      <div className="burst" />
      <div className="splash-row">
        {room.caller !== NO_SEAT && <Avatar seat={room.caller} size={130} />}
        {body && <Avatar seat={room.reported} size={110} ko />}
      </div>
      <h1 className="stamp">{body ? "BODY FOUND!" : "EMERGENCY MEETING!"}</h1>
      <div className="cine-line">{room.names[room.caller] ?? "Someone"} {body ? <>found <b style={{ color: SEAT_COLORS[room.reported] }}>{room.names[room.reported]}</b> in cuffs</> : "hit the alarm"}</div>
    </div>
  );
}

export function CuffedScreen({ seat }: { seat: number }) {
  return (
    <div className="cine cuffed">
      <div className="cuff-icon">⛓</div>
      <div className="lineup"><div className="lu front"><Avatar seat={seat} size={140} ko /></div></div>
      <h1 className="cine-title">CUFFED</h1>
      <div className="cine-line">Someone got you in the dark. You're a ghost now: walk through the vault, finish your tasks, help the crew.</div>
    </div>
  );
}

export function CuffFlash() {
  return <div className="cuffflash"><span>CUFFED!</span></div>;
}

/** The RESULT phase: votes flip public together, then someone drops through the trapdoor. */
export function EjectScene({ room, since }: { room: RoomState; since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 50); return () => clearInterval(t); }, []);
  const el = now - since;
  const e = room.ejected;
  const showVotes = el < 2600;
  const text = e === NO_SEAT
    ? "Nobody was dropped. (Tie or skipped.)"
    : `${room.names[e]} was ${room.ejectedRole === ROLE_MOLE ? "the Mole." : "not the Mole."}`;
  const typed = text.slice(0, Math.max(0, Math.floor((el - 3000) / 55)));
  const tail = e !== NO_SEAT && room.ejectedRole !== ROLE_MOLE ? "The Mole is still on the crew." : e !== NO_SEAT ? "One less traitor." : "";
  if (showVotes) return <VoteReveal room={room} />;
  return (
    <div className="cine eject">
      <div className="spot" />
      {e !== NO_SEAT && (
        <div className="drop" key={e}>
          <Avatar seat={e} size={120} ko={false} />
        </div>
      )}
      <div className={`trapdoor ${e !== NO_SEAT ? "open" : ""}`} />
      <h2 className="typed">{typed}<span className="caret">▌</span></h2>
      {typed.length >= text.length && tail && <div className="cine-line fade-in">{tail}</div>}
    </div>
  );
}

function VoteReveal({ room }: { room: RoomState }) {
  const voters = seats(room).filter((i) => room.lastVotes[i] !== VOTE_NONE);
  const skip = voters.filter((i) => room.lastVotes[i] === VOTE_SKIP || room.lastVotes[i] >= MAXP);
  return (
    <div className="cine votes">
      <h2>The ballots flip — all at once</h2>
      <div className="vr-grid">
        {seats(room).map((i) => {
          const got = voters.filter((v) => room.lastVotes[v] === i);
          return (
            <div key={i} className={`vr-card ${room.ejected === i ? "out" : ""}`} style={{ borderColor: SEAT_COLORS[i] }}>
              <Avatar seat={i} size={44} ghost={room.alivePub[i] === 0 && room.ejected !== i} />
              <b>{room.names[i]}</b>
              <div className="chips">{got.map((v, k) => <span key={v} className="vchip" style={{ background: SEAT_COLORS[v], animationDelay: `${k * 0.15}s` }} />)}</div>
            </div>
          );
        })}
      </div>
      <div className="skiprow">SKIPPED: {skip.map((v, k) => <span key={v} className="vchip" style={{ background: SEAT_COLORS[v], animationDelay: `${k * 0.15}s` }} />)}</div>
    </div>
  );
}

export function EndScreen({ room, seat, phase, children, onHide }: { room: RoomState; seat: number; phase: number; children?: React.ReactNode; onHide: () => void }) {
  const moleWin = room.winner === 1;
  const mine = seat >= 0 ? room.rolesPub[seat] : 255;
  const won = seat >= 0 && ((moleWin && mine === ROLE_MOLE) || (!moleWin && mine !== ROLE_MOLE && mine !== 255));
  const winners = seats(room).filter((i) => (moleWin ? room.rolesPub[i] === ROLE_MOLE : room.rolesPub[i] !== ROLE_MOLE));
  const title = seat >= 0 ? (won ? "VICTORY" : "DEFEAT") : moleWin ? "MOLE WINS" : "CREW WINS";
  return (
    <div className={`cine end ${moleWin ? "is-mole" : "is-crew"} ${won ? "won" : ""}`}>
      {!moleWin && <div className="coins">{Array.from({ length: 26 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 0.27}s`, animationDuration: `${2.2 + (i % 5) * 0.35}s` }} />)}</div>}
      <h1 className="cine-title">{title}</h1>
      <div className="cine-line">{moleWin ? "The Mole sold the crew out." : "The vault is cracked. The crew walks out rich."}</div>
      <div className="lineup winners">
        {winners.map((i) => (
          <div key={i} className="lu-end">
            <Avatar seat={i} size={96} mole={room.rolesPub[i] === ROLE_MOLE} ghost={room.alivePub[i] === 0} animate />
            <span style={{ color: SEAT_COLORS[i] }}>{room.names[i]}</span>
          </div>
        ))}
      </div>
      <div className="rolesrow">
        {seats(room).map((i) => (
          <span key={i} className={`chip ${room.rolesPub[i] === ROLE_MOLE ? "mole" : ""}`} style={{ borderColor: SEAT_COLORS[i] }}>
            {room.names[i]} · {room.rolesPub[i] === ROLE_MOLE ? "MOLE" : "crew"}
          </span>
        ))}
      </div>
      <div className="mono small muted">{phase === 5 ? "unsealing the World inside the enclave…" : "lights on: the World is public, check the deal yourself ↓"}</div>
      {children}
      <button className="btn ghost sm" onClick={onHide}>See the whole map</button>
    </div>
  );
}

export function Dealing({ room, canFallback, onFallback }: { room: RoomState; canFallback: boolean; onFallback: () => void }) {
  const [waited, setWaited] = useState(0);
  useEffect(() => { const t = setInterval(() => setWaited((w) => w + 1), 1000); return () => clearInterval(t); }, []);
  const n = seats(room).length;
  return (
    <div className="cine dealing">
      <div className="cards">
        {Array.from({ length: n }, (_, i) => <div key={i} className="card-flip" style={{ animationDelay: `${i * 0.12}s`, background: SEAT_COLORS[i] }}>?</div>)}
      </div>
      <h1 className="cine-title small">SHUFFLING ROLES</h1>
      <div className="cine-line">MagicBlock VRF is rolling. Its output gets hashed with every player's <b>sealed salt</b> inside the enclave, so not even the oracle can know the Mole.</div>
      {canFallback && waited > 7 && <button className="ghost" onClick={onFallback}>Oracle slow? Deal from rollup state (flagged)</button>}
      <div className="mono small muted">heist #{room.matchNo} · {COLOR_NAMES.slice(0, n).join(" · ")}</div>
    </div>
  );
}
