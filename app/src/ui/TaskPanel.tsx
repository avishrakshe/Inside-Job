import { useEffect, useRef, useState } from "react";
import { sfx } from "../game/sfx";
import { trackEvent } from "../analytics";

type Kind = "dial" | "wires" | "upload" | "cash" | "lasers" | "charge";
const KIND: Record<string, Kind> = {
  "Crack Dial": "dial", "Pick Lock": "dial",
  "Splice Wires": "wires", "Cut Power": "wires",
  "Upload Worm": "upload", "Keycard Clone": "upload", "Camera Loop": "upload",
  "Bag Cash": "cash",
  "Map Lasers": "lasers", "Disable Sensor": "lasers",
  "Plant Charge": "charge", "Prep Getaway": "charge",
};

/**
 * The station mini-game. While it's open your client holds USE; the TEE counts your
 * progress tick by tick (the bar below is your View's sealed progress, not a local timer).
 * A Mole gets the same screen with a fake bar, so faking looks exactly like working.
 */
export default function TaskPanel({ name, chainP, done, fake, onClose }: {
  name: string; chainP: number; done: boolean; fake: boolean; onClose: () => void;
}) {
  const kind = KIND[name] ?? "upload";
  const [p, setP] = useState(fake ? 0 : chainP);
  const [finished, setFinished] = useState(false);
  const target = useRef(chainP);
  target.current = done ? 1 : chainP;

  useEffect(() => {
    let raf = 0, last = performance.now(), beep = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setP((cur) => {
        if (fake) return Math.min(1, cur + dt / 8);
        // ease toward the sealed progress, never run ahead of it by more than a hair
        const tg = target.current;
        return cur + (tg - cur) * Math.min(1, dt * 8);
      });
      beep += dt;
      if (beep > 0.45) { beep = 0; sfx.taskTick(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fake]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!finished && ((fake && p >= 0.999) || (!fake && done))) {
      setFinished(true);
      sfx.taskDone();
      trackEvent("task_done", { station: name, fake });
    }
  }, [p, done, fake, finished]);
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => closeRef.current(), 900);
    return () => clearTimeout(t);
  }, [finished]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <div className="taskpanel-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`taskpanel k-${kind}`}>
        <button className="xbtn" onClick={onClose} aria-label="close">✕</button>
        <div className="tp-title">{name}</div>
        <div className="tp-stage">
          {kind === "dial" && <Dial p={p} />}
          {kind === "wires" && <Wires p={p} />}
          {kind === "upload" && <Upload p={p} name={name} />}
          {kind === "cash" && <Cash p={p} />}
          {kind === "lasers" && <Lasers p={p} />}
          {kind === "charge" && <Charge p={p} name={name} />}
          {finished && <div className="tp-done">{fake ? "LOOKS LEGIT" : "TASK COMPLETE"}</div>}
        </div>
        <div className="tp-bar"><div style={{ width: `${Math.round(p * 100)}%` }} /></div>
        <div className="tp-note">
          {fake ? <><b className="mole">Faking it.</b> Nothing happens on chain, but nobody can tell from outside.</> : <>Stay at the console. The enclave counts your progress every 100 ms tick.</>}
        </div>
      </div>
    </div>
  );
}

function Dial({ p }: { p: number }) {
  const rot = p * 900 + Math.sin(p * 40) * 8;
  const pins = [0.33, 0.66, 0.98];
  return (
    <div className="dial">
      <svg viewBox="-60 -60 120 120" width="200" height="200">
        <circle r="56" fill="#3b3220" stroke="#0b0f18" strokeWidth="3" />
        <circle r="48" fill="#8f7a3f" />
        <g transform={`rotate(${rot})`}>
          <circle r="40" fill="#b39a52" stroke="#5a4a24" strokeWidth="2" />
          {Array.from({ length: 40 }, (_, i) => (
            <line key={i} x1="0" y1="-38" x2="0" y2={i % 5 ? -34 : -30} stroke="#3b3220" strokeWidth={i % 5 ? 1 : 2} transform={`rotate(${i * 9})`} />
          ))}
          <circle r="12" fill="#5a4a24" />
          <rect x="-3" y="-30" width="6" height="18" rx="3" fill="#3b3220" />
        </g>
        <polygon points="0,-58 -6,-48 6,-48" fill="#ff4d6d" />
      </svg>
      <div className="pins">{pins.map((t, i) => <span key={i} className={p >= t ? "on" : ""} />)}</div>
    </div>
  );
}

const WIRE_COLORS = ["#ff4d6d", "#4dabff", "#ffd23f", "#3ddc97"];
const WIRE_TO = [2, 0, 3, 1];
function Wires({ p }: { p: number }) {
  return (
    <svg viewBox="0 0 220 160" width="260" height="190" className="wires">
      <rect x="0" y="0" width="220" height="160" rx="10" fill="#141b2b" />
      {WIRE_COLORS.map((c, i) => {
        const y1 = 25 + i * 37, y2 = 25 + WIRE_TO[i] * 37;
        const on = p >= (i + 1) / 4.2;
        const part = Math.max(0, Math.min(1, (p - i / 4.2) * 4.2));
        const x2 = 20 + 180 * (on ? 1 : part);
        const y = y1 + (y2 - y1) * (on ? 1 : part);
        return (
          <g key={i}>
            <rect x="4" y={y1 - 8} width="18" height="16" rx="3" fill={c} />
            <rect x="198" y={y2 - 8} width="18" height="16" rx="3" fill={c} opacity={on ? 1 : 0.35} />
            {part > 0 && <path d={`M22 ${y1} C 90 ${y1}, 120 ${y}, ${x2} ${y}`} stroke={c} strokeWidth="7" fill="none" strokeLinecap="round" />}
            {on && <circle cx="207" cy={y2} r="3" fill="#fff" />}
          </g>
        );
      })}
    </svg>
  );
}

function Upload({ p, name }: { p: number; name: string }) {
  const lines = Math.floor(p * 14);
  const file = name === "Upload Worm" ? "worm.bin" : name === "Keycard Clone" ? "badge_0451.key" : "loop_cam03.mp4";
  return (
    <div className="term">
      <div className="mono small">$ inject {file} --target vault-net</div>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="mono small dim">{(((i + 7) * 2654435761) >>> 0).toString(16).padStart(8, "0")} {(((i + 3) * 40503) >>> 0).toString(16).padStart(6, "0")} ok</div>
      ))}
      <div className="mono small">{Math.round(p * 100)}% {p >= 1 ? "— done" : "▌"}</div>
    </div>
  );
}

function Cash({ p }: { p: number }) {
  const n = Math.floor(p * 12);
  return (
    <div className="cash">
      <div className="bills">{Array.from({ length: 12 }, (_, i) => <span key={i} className={i < n ? "in" : ""} style={{ ["--i" as any]: i }}>$</span>)}</div>
      <div className="bag">$</div>
      <div className="mono">${(Math.floor(p * 250) * 100).toLocaleString()}</div>
    </div>
  );
}

function Lasers({ p }: { p: number }) {
  return (
    <svg viewBox="0 0 220 150" width="260" height="180" className="lasers">
      <rect width="220" height="150" rx="10" fill="#140d16" />
      {Array.from({ length: 5 }, (_, i) => {
        const off = p >= (i + 1) / 5.2;
        const y = 20 + i * 27;
        return (
          <g key={i}>
            <rect x="6" y={y - 6} width="10" height="12" rx="2" fill="#3a2232" />
            <rect x="204" y={y - 6} width="10" height="12" rx="2" fill="#3a2232" />
            {!off && <line x1="16" y1={y} x2="204" y2={y} stroke="#ff3355" strokeWidth="2.5" className="beam" />}
            <circle cx="11" cy={y} r="3" fill={off ? "#3ddc97" : "#ff3355"} />
          </g>
        );
      })}
    </svg>
  );
}

function Charge({ p, name }: { p: number; name: string }) {
  const getaway = name === "Prep Getaway";
  return (
    <div className="charge">
      <svg viewBox="-60 -40 120 60" width="240" height="120">
        <path d="M-50 10 A 50 50 0 0 1 50 10" stroke="#222c42" strokeWidth="10" fill="none" />
        <path d="M-50 10 A 50 50 0 0 1 50 10" stroke={getaway ? "#4dabff" : "#ff9f43"} strokeWidth="10" fill="none" pathLength={1} strokeDasharray={`${p} 1`} />
        <line x1="0" y1="10" x2={Math.cos(Math.PI - p * Math.PI) * 40} y2={10 - Math.sin(p * Math.PI) * 40} stroke="#e8ecf3" strokeWidth="3" strokeLinecap="round" />
        <circle cx="0" cy="10" r="5" fill="#e8ecf3" />
      </svg>
      <div className="mono">{getaway ? `ENGINE ${Math.round(p * 7000)} RPM` : `CHARGE ${Math.round(p * 100)}%`}</div>
    </div>
  );
}
