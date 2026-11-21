import { useEffect, useRef } from "react";
import { drawRobber } from "../game/sprites";
import { SEAT_COLORS } from "../game/render";

function useCanvas(paint: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;
  useEffect(() => {
    let raf = 0;
    const frame = (t: number) => {
      const c = ref.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintRef.current(ctx, w, h, t);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** The safehouse: the crew gathers around the blueprints before the heist. */
export function LobbyStage({ names, occupied, me, max }: { names: string[]; occupied: boolean[]; me: number; max: number }) {
  const ref = useCanvas((ctx, w, h, t) => {
    // back wall
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1b1530"); g.addColorStop(0.55, "#251d3a"); g.addColorStop(0.551, "#2a2030"); g.addColorStop(1, "#16111d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // pinned blueprints + a hanging lamp
    ctx.fillStyle = "#1d3b66"; ctx.fillRect(w * 0.08, h * 0.1, w * 0.22, h * 0.28);
    ctx.strokeStyle = "#7fb2ff55"; ctx.lineWidth = 1;
    for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(w * 0.08, h * 0.1 + k * h * 0.047); ctx.lineTo(w * 0.3, h * 0.1 + k * h * 0.047); ctx.stroke(); }
    ctx.strokeStyle = "#cfe2ff"; ctx.lineWidth = 2; ctx.strokeRect(w * 0.12, h * 0.15, w * 0.08, h * 0.12); ctx.strokeRect(w * 0.2, h * 0.2, w * 0.07, h * 0.12);
    ctx.fillStyle = "#e8e0c8"; ctx.fillRect(w * 0.72, h * 0.12, w * 0.15, h * 0.2);
    ctx.fillStyle = "#c33"; ctx.font = `bold ${Math.max(10, h * 0.05)}px Bungee, Impact, sans-serif`; ctx.textAlign = "center";
    ctx.fillText("$$$", w * 0.795, h * 0.25);
    const lx = w / 2, sw = Math.sin(t / 1400) * 0.04;
    ctx.strokeStyle = "#555"; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx + sw * h, h * 0.12); ctx.stroke();
    const lg = ctx.createRadialGradient(lx, h * 0.15, 4, lx, h * 0.6, h * 0.7);
    lg.addColorStop(0, "rgba(255,225,150,0.35)"); lg.addColorStop(1, "rgba(255,225,150,0)");
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(lx - 14, h * 0.13); ctx.lineTo(lx + 14, h * 0.13); ctx.lineTo(lx + w * 0.4, h); ctx.lineTo(lx - w * 0.4, h); ctx.fill();
    ctx.fillStyle = "#ffd88a"; ctx.beginPath(); ctx.ellipse(lx + sw * h, h * 0.13, 16, 7, 0, Math.PI, 0); ctx.fill();
    // table
    ctx.fillStyle = "#4a3424"; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.74, w * 0.2, h * 0.07, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#2d5f9a"; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.73, w * 0.12, h * 0.035, 0, 0, 7); ctx.fill();
    // the crew in an arc
    const n = max;
    const scale = Math.max(1.1, Math.min(w / (n * 42), h / 170));
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.1 + (0.8 * i) / Math.max(1, n - 1));
      const x = w / 2 - Math.cos(a) * w * 0.36;
      const y = h * 0.58 + Math.sin(a) * h * 0.2;
      if (occupied[i]) {
        const hop = i === me ? Math.abs(Math.sin(t / 260)) * -3 : 0;
        drawRobber(ctx, x, y + hop, { color: SEAT_COLORS[i], facing: x < w / 2 ? 1 : -1, t: t + i * 600, scale });
        ctx.font = `800 ${Math.max(10, scale * 6)}px Nunito, sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = "#0b0f18";
        ctx.strokeText(names[i] || "AGENT", x, y - 32 * scale);
        ctx.fillStyle = i === me ? "#ffe17a" : "#fff";
        ctx.fillText(names[i] || "AGENT", x, y - 32 * scale);
      } else {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(x - 10 * scale, y - 20 * scale, 20 * scale, 28 * scale, 9 * scale); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = `700 ${Math.max(9, scale * 5)}px Nunito, sans-serif`; ctx.textAlign = "center";
        ctx.fillText("open", x, y + 18 * scale);
      }
    }
  }, [names.join("|"), occupied.join("|"), me, max]);
  return <canvas ref={ref} className="lobbystage" />;
}

/** Home hero: a crew sneaking along the vault corridor at night. One of them isn't who they say. */
export function HeroStage() {
  const ref = useCanvas((ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    // floor strip
    const fy = h * 0.78;
    ctx.fillStyle = "#121726"; ctx.fillRect(0, fy, w, h - fy);
    ctx.fillStyle = "#1b2133"; for (let x = -((t / 20) % 40); x < w; x += 40) ctx.fillRect(x, fy + 6, 24, 3);
    // searchlight
    const sx = w * (0.5 + 0.45 * Math.sin(t / 2600));
    const g = ctx.createRadialGradient(sx, fy, 4, sx, fy, h * 0.5);
    g.addColorStop(0, "rgba(255,240,190,0.22)"); g.addColorStop(1, "rgba(255,240,190,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, fy, h * 0.5, h * 0.18, 0, 0, 7); ctx.fill();
    const scale = Math.max(1.6, Math.min(3.2, h / 60));
    const span = w + 260;
    for (let i = 0; i < 6; i++) {
      const x = ((t / 14 + i * (span / 6)) % span) - 130;
      const walk = t / 70 + i;
      const mole = i === 3;
      drawRobber(ctx, x, fy - 6 * scale, { color: SEAT_COLORS[(i * 3) % 8], facing: 1, moving: true, walk, t, scale, mole: mole && Math.sin(t / 700) > 0.6 });
    }
  }, []);
  return <canvas ref={ref} className="herostage" />;
}
