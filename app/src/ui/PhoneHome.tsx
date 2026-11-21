// The phone build's front door: an intro that plays every time the app opens, then a
// game-style main menu. Landscape only (see phone.ts). Original art, drawn in code: the
// crew tumbling through the night sky over the city, searchlights sweeping from the bank.
import { ReactNode, useEffect, useMemo, useState } from "react";
import { drawRobber } from "../game/sprites";
import { SEAT_COLORS } from "../game/render";
import { useCanvas } from "./Scenes";

// ------------------------------------------------------------------ the sky

interface Drifter { x: number; y: number; vx: number; vy: number; rot: number; vr: number; s: number; seat: number; flip: number }
interface Bill { x: number; y: number; vx: number; vy: number; rot: number; vr: number }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function SkyStage({ dim }: { dim?: boolean }) {
  const state = useMemo(() => {
    const r = rng(7);
    const stars = Array.from({ length: 140 }, () => ({ x: r(), y: r() * 0.75, s: r() < 0.15 ? 2 : 1, p: r() * 6.28 }));
    const towers = Array.from({ length: 26 }, (_, i) => ({ x: i / 25, w: 0.03 + r() * 0.045, h: 0.1 + r() * 0.2, lit: Math.floor(r() * 1e6) }));
    const drift: Drifter[] = SEAT_COLORS.map((_, seat) => ({
      x: r(), y: 0.08 + r() * 0.62, vx: (0.018 + r() * 0.03) * (r() < 0.5 ? -1 : 1), vy: (r() - 0.5) * 0.012,
      rot: r() * 6.28, vr: (r() - 0.5) * 1.4, s: 0.75 + r() * 0.6, seat, flip: r() < 0.5 ? -1 : 1,
    }));
    const bills: Bill[] = Array.from({ length: 12 }, () => ({ x: r(), y: r() * 0.8, vx: (r() - 0.3) * 0.03, vy: 0.01 + r() * 0.02, rot: r() * 6.28, vr: (r() - 0.5) * 3 }));
    return { stars, towers, drift, bills, last: 0 };
  }, []);

  const ref = useCanvas((ctx, w, h, t) => {
    const st = state;
    const dt = st.last ? Math.min(0.05, (t - st.last) / 1000) : 0;
    st.last = t;
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#05031a"); g.addColorStop(0.55, "#170d3f"); g.addColorStop(1, "#3a1856");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (const s of st.stars) {
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t / 900 + s.p));
      ctx.fillStyle = "#fff";
      ctx.fillRect(s.x * w, s.y * h, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // moon
    const mx = w * 0.86, my = h * 0.2, mr = Math.min(w, h) * 0.075;
    const mg = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3);
    mg.addColorStop(0, "rgba(255,240,190,0.25)"); mg.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 3, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff3c4"; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 7); ctx.fill();
    ctx.fillStyle = "#e9dca6";
    for (const [a, b, c] of [[-0.3, -0.2, 0.22], [0.3, 0.25, 0.16], [0.1, -0.45, 0.1]]) { ctx.beginPath(); ctx.arc(mx + a * mr, my + b * mr, c * mr, 0, 7); ctx.fill(); }
    // searchlights from the bank
    const bx = w * 0.5, base = h * 0.98;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const k of [0, 1]) {
      const a = -Math.PI / 2 + Math.sin(t / 2300 + k * 2.4) * 0.6;
      const len = h * 1.2, spread = 0.07;
      const lg = ctx.createLinearGradient(bx, base, bx + Math.cos(a) * len, base + Math.sin(a) * len);
      lg.addColorStop(0, "rgba(255,236,170,0.22)"); lg.addColorStop(1, "rgba(255,236,170,0)");
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(bx + (k ? 30 : -30), base - h * 0.2);
      ctx.lineTo(bx + Math.cos(a - spread) * len, base + Math.sin(a - spread) * len);
      ctx.lineTo(bx + Math.cos(a + spread) * len, base + Math.sin(a + spread) * len);
      ctx.fill();
    }
    ctx.restore();
    // skyline
    for (const tw of st.towers) {
      const x = tw.x * w - (tw.w * w) / 2, th = tw.h * h, y = h - th;
      ctx.fillStyle = "#0e0a26"; ctx.fillRect(x, y, tw.w * w, th);
      ctx.fillStyle = "#16103a"; ctx.fillRect(x, y, tw.w * w, 2);
      for (let j = 0; j < 14; j++) {
        const wx = x + 4 + (j % 3) * ((tw.w * w - 8) / 3), wy = y + 6 + Math.floor(j / 3) * 9;
        if (wy > h - 6) break;
        const on = ((tw.lit >> j) & 1) && Math.sin(t / 4000 + j + tw.lit) > -0.7;
        if (on) { ctx.fillStyle = "#ffd76a"; ctx.fillRect(wx, wy, 4, 4); }
      }
    }
    // the bank: pediment, columns, gold trim
    const bw = Math.min(w * 0.3, 260), bh = h * 0.24, bxl = bx - bw / 2, by = h - bh;
    ctx.fillStyle = "#130e33"; ctx.fillRect(bxl, by, bw, bh);
    ctx.beginPath(); ctx.moveTo(bxl - 10, by); ctx.lineTo(bx, by - bh * 0.42); ctx.lineTo(bxl + bw + 10, by); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#c9a227"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#1d1648";
    for (let k = 0; k < 6; k++) ctx.fillRect(bxl + 10 + k * ((bw - 30) / 5), by + 8, 10, bh - 8);
    ctx.fillStyle = "#c9a227"; ctx.font = `${Math.max(10, bh * 0.16)}px Bungee, Impact, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("$", bx, by - bh * 0.17);
    // drifting crew + cash
    const S = Math.min(w, h) / 150;
    for (const b of st.bills) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt;
      if (b.y > 1.05) { b.y = -0.05; b.x = Math.random(); }
      if (b.x > 1.05) b.x = -0.05; else if (b.x < -0.05) b.x = 1.05;
      ctx.save(); ctx.translate(b.x * w, b.y * h); ctx.rotate(b.rot); ctx.scale(1, Math.abs(Math.cos(b.rot * 1.3)) * 0.8 + 0.2);
      ctx.fillStyle = "#4caf6a"; ctx.strokeStyle = "#13361f"; ctx.lineWidth = 1.5;
      ctx.fillRect(-9 * S / 1.6, -5 * S / 1.6, 18 * S / 1.6, 10 * S / 1.6); ctx.strokeRect(-9 * S / 1.6, -5 * S / 1.6, 18 * S / 1.6, 10 * S / 1.6);
      ctx.fillStyle = "#c9f0d0"; ctx.beginPath(); ctx.arc(0, 0, 2.5 * S / 1.6, 0, 7); ctx.fill();
      ctx.restore();
    }
    for (const d of st.drift) {
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.y < 0.05 || d.y > 0.72) d.vy *= -1;
      if (d.x > 1.12) d.x = -0.12; else if (d.x < -0.12) d.x = 1.12;
      ctx.save();
      ctx.translate(d.x * w, d.y * h);
      ctx.rotate(d.rot);
      drawRobber(ctx, 0, 0, { color: SEAT_COLORS[d.seat], facing: d.flip, t: t + d.seat * 700, scale: S * d.s, ghost: false });
      ctx.restore();
    }
    if (dim) { ctx.fillStyle = "rgba(5,3,20,0.35)"; ctx.fillRect(0, 0, w, h); }
  }, [dim]);
  return <canvas ref={ref} className="skystage" />;
}

// ------------------------------------------------------------------ intro

export function PhoneIntro({ onStart }: { onStart: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const k = setTimeout(() => setReady(true), 1500); return () => clearTimeout(k); }, []);
  return (
    <div className="phoneintro" onClick={onStart}>
      <SkyStage />
      <div className="iris" />
      <div className="pi-center">
        <MaskMark />
        <h1 className="pi-logo">INSIDE <b>JOB</b></h1>
        <p className="pi-sub">Trust no one. One of the crew is the Mole.</p>
      </div>
      <div className={`pi-tap ${ready ? "on" : ""}`}>TAP TO START</div>
      <div className="pi-foot">Sealed inside a MagicBlock Private Ephemeral Rollup · Solana</div>
    </div>
  );
}

const MaskMark = () => (
  <svg viewBox="0 0 40 24" className="pi-mask" aria-hidden>
    <path d="M2 8c6-6 30-6 36 0 1 8-6 13-12 10l-6-4-6 4C8 21 1 16 2 8z" fill="#14171f" stroke="#ff4d6d" strokeWidth="2" />
    <ellipse cx="12" cy="10" rx="4" ry="3" fill="#f6f8fc" />
    <ellipse cx="28" cy="10" rx="4" ry="3" fill="#f6f8fc" />
    <circle cx="13" cy="10" r="1.5" fill="#ff2d55" />
    <circle cx="29" cy="10" r="1.5" fill="#ff2d55" />
  </svg>
);

// ------------------------------------------------------------------ main menu

type Panel = null | "crews" | "staked" | "chain";

export function PhoneMenu(p: {
  name: string; setName: (s: string) => void; busy: boolean;
  onPlayFree: () => void; onHow: () => void; onAbout: () => void;
  enclave: "checking" | "verified" | "unverified";
  walletButton: ReactNode; muteButton: ReactNode;
  freeTables: ReactNode; stakedTables: ReactNode; stakedNote?: ReactNode; chainLog: ReactNode;
  live: number; humans: number;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const titles: Record<Exclude<Panel, null>, string> = { crews: "FREE CREWS", staked: "STAKED TABLES", chain: "CHAIN LOG" };
  return (
    <div className="phonemenu">
      <SkyStage dim />
      <div className="pm-top">
        <label className="pm-name">
          <span>CODENAME</span>
          <input maxLength={12} placeholder="AGENT" value={p.name} onChange={(e) => p.setName(e.target.value.toUpperCase())} />
        </label>
        <div className="pm-badges">
          <span className={`pm-dot ${p.enclave}`} title="TEE attestation">{p.enclave === "verified" ? "● Enclave" : "○ Enclave"}</span>
          {p.walletButton}
          {p.muteButton}
        </div>
      </div>
      <div className="pm-center">
        <h1 className="pm-logo">INSIDE <b>JOB</b></h1>
        <div className="pm-grid">
          <button className="pmbtn go" onClick={p.onPlayFree} disabled={p.busy}>{p.busy ? "JOINING…" : "PLAY FREE"}</button>
          <button className="pmbtn" onClick={() => setPanel("crews")}>CREWS</button>
          <button className="pmbtn" onClick={p.onHow}>HOW TO PLAY</button>
          <button className="pmbtn gold" onClick={() => setPanel("staked")}>◎ STAKED</button>
        </div>
        <div className="pm-live">{p.live} heists live · {p.humans} agents online</div>
      </div>
      <div className="pm-icons">
        <button className="pmicon" onClick={() => setPanel("chain")} aria-label="Chain log">⛓</button>
        <button className="pmicon" onClick={p.onAbout} aria-label="About the game">ℹ</button>
      </div>
      {panel && (
        <div className="pm-panelwrap" onClick={() => setPanel(null)}>
          <div className="pm-panel" onClick={(e) => e.stopPropagation()}>
            <div className="pm-panelhead"><b>{titles[panel]}</b><button className="xbtn" onClick={() => setPanel(null)}>✕</button></div>
            <div className="pm-panelbody">
              {panel === "crews" && p.freeTables}
              {panel === "staked" && <>{p.stakedTables}{p.stakedNote}</>}
              {panel === "chain" && p.chainLog}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
