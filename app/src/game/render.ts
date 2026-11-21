// Canvas renderer: a follow camera, a pre-rendered decorated map, soft fog computed with
// exactly the program's vision rule (map.ts mirrors sim.rs), animated characters,
// task arrows and a minimap. Everything here is drawn from what your View contains:
// nothing sealed ever reaches the client, so the renderer can't leak it either.
import { MAXP, ViewState, ROLE_MOLE, ROLE_CREW } from "../chain/decode";
import { BUTTON, MAP_H, MAP_W, ROOM_NAMES, STATIONS, TASK_TICKS, TILE, TILES, canSee } from "./map";
import { drawCuffed, drawRobber, shade, star } from "./sprites";
import { drawAnimated, getMap, LABELS } from "./mapart";

export const SEAT_COLORS = ["#ff4d6d", "#4dabff", "#3ddc97", "#ffd23f", "#b388ff", "#ff9f43", "#2de2e6", "#ff7ac6"];
export const COLOR_NAMES = ["Red", "Blue", "Green", "Yellow", "Violet", "Orange", "Cyan", "Pink"];

const MAP_PX_W = MAP_W * TILE;
const MAP_PX_H = MAP_H * TILE;

/** Centre of each room (minimap labels). */
const ROOM_CENTERS: { x: number; y: number }[] = (() => {
  const acc = ROOM_NAMES.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const a = acc[TILES[ty * MAP_W + tx]];
    if (a) { a.x += tx; a.y += ty; a.n++; }
  }
  return acc.map((a) => (a.n ? { x: (a.x / a.n + 0.5) * TILE, y: (a.y / a.n + 0.5) * TILE } : { x: 0, y: 0 }));
})();

export interface RenderInput {
  view: ViewState | null;
  me: { x: number; y: number } | null;
  names: string[];
  seat: number;
  showAll?: { x: number[]; y: number[]; role: number[]; alive: number[] } | null; // lights-on replay
  /** public alive flags (spectators: whole-map view) */
  t: number;
  follow: boolean;
  dpr?: number;
}

// ------------------------------------------------------------------ animation state

interface Anim { x: number; y: number; facing: number; walk: number; moving: boolean; last: number; still: number }
const anims = new Map<number, Anim>();
/**
 * Others arrive in 7 px hops once per tick: ease toward them. Your own robber is already
 * smooth (game/predict.ts), so `direct` draws it exactly where the predictor says and only
 * derives facing / walk cycle from its velocity; easing it again added ~90 ms of lag.
 */
function animate(key: number, tx: number, ty: number, now: number, direct = false): Anim {
  let a = anims.get(key);
  if (!a || (a.x - tx) ** 2 + (a.y - ty) ** 2 > 140 * 140) {
    a = { x: tx, y: ty, facing: 1, walk: 0, moving: false, last: now, still: 0 };
    anims.set(key, a);
    return a;
  }
  const dt = Math.min(0.1, Math.max(0, (now - a.last) / 1000));
  a.last = now;
  const k = direct ? 1 : 1 - Math.exp(-dt * 11);
  const dx = tx - a.x, dy = ty - a.y;
  a.x += dx * k;
  a.y += dy * k;
  // moving = real speed, held for a moment so the walk cycle doesn't flicker between frames
  const v = dt > 0 ? Math.hypot(dx, dy) * k / dt : 0;
  if (v > 12) a.still = 0; else a.still += dt;
  const moving = a.still < 0.12;
  if (Math.abs(dx) > (direct ? 0.05 : 0.8)) a.facing = dx > 0 ? 1 : -1;
  if (moving) a.walk += dt * 15;
  a.moving = moving;
  return a;
}
const cam = { x: MAP_PX_W / 2, y: MAP_PX_H / 2, s: 1, init: false, last: 0 };

let fogCanvas: HTMLCanvasElement | null = null;
let fogData: ImageData | null = null;

// ------------------------------------------------------------------ frame

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, inp: RenderInput) {
  const v = inp.view;
  const me = inp.me;
  const reveal = !!inp.showAll;
  const ghost = v ? v.alive === 0 && v.role !== 255 : false;
  const follow = inp.follow && !!me && !reveal;
  const t = inp.t;
  const dpr = inp.dpr ?? 1;

  // camera
  const fit = Math.min(w / MAP_PX_W, h / MAP_PX_H);
  const tgtS = follow ? Math.max(fit, Math.min(3.2, Math.min(w, h) / (8.2 * TILE))) : fit;
  let tgtX = follow ? me!.x : MAP_PX_W / 2, tgtY = follow ? me!.y : MAP_PX_H / 2;
  if (follow) {
    const hw = w / 2 / tgtS, hh = h / 2 / tgtS;
    tgtX = MAP_PX_W <= hw * 2 ? MAP_PX_W / 2 : Math.max(hw, Math.min(MAP_PX_W - hw, tgtX));
    tgtY = MAP_PX_H <= hh * 2 ? MAP_PX_H / 2 : Math.max(hh, Math.min(MAP_PX_H - hh, tgtY));
  }
  // frame-rate independent follow (a fixed 0.18/frame felt twice as laggy at 30 fps)
  const cdt = cam.last ? Math.min(0.1, Math.max(0, (t - cam.last) / 1000)) : 0;
  cam.last = t;
  if (!cam.init || Math.abs(cam.s - tgtS) > 1.5 || (tgtX - cam.x) ** 2 + (tgtY - cam.y) ** 2 > 400 * 400) {
    cam.x = tgtX; cam.y = tgtY; cam.s = tgtS; cam.init = true;
  }
  const kp = 1 - Math.exp(-cdt * 14), ks = 1 - Math.exp(-cdt * 7);
  cam.x += (tgtX - cam.x) * kp;
  cam.y += (tgtY - cam.y) * kp;
  cam.s += (tgtS - cam.s) * ks;
  const s = cam.s;
  const ox = w / 2 - cam.x * s, oy = h / 2 - cam.y * s;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(getMap(), 0, 0, MAP_PX_W, MAP_PX_H);

  drawAnimated(ctx, t);
  drawStations(ctx, v, t);
  drawButton(ctx, t);

  // bodies
  if (v) for (let j = 0; j < MAXP; j++) if (v.bodyMask & (1 << j)) drawCuffed(ctx, v.bodyX[j], v.bodyY[j], SEAT_COLORS[j], t);

  // characters, depth-sorted
  type D = { seat: number; x: number; y: number; ghost: boolean; mole: boolean; me: boolean };
  const list: D[] = [];
  const seen = new Set<number>();
  if (inp.showAll) {
    const a = inp.showAll;
    for (let j = 0; j < MAXP; j++) {
      if (a.role[j] === 255) continue;
      list.push({ seat: j, x: a.x[j], y: a.y[j], ghost: a.alive[j] === 0, mole: a.role[j] === ROLE_MOLE, me: j === inp.seat });
    }
  } else if (v) {
    for (let j = 0; j < MAXP; j++) {
      if (j === inp.seat || !(v.visMask & (1 << j))) continue;
      list.push({ seat: j, x: v.visX[j], y: v.visY[j], ghost: (v.ghostMask & (1 << j)) !== 0, mole: (v.partnerMask & (1 << j)) !== 0, me: false });
    }
    if (me && inp.seat >= 0) list.push({ seat: inp.seat, x: me.x, y: me.y, ghost: v.alive === 0, mole: v.role === ROLE_MOLE, me: true });
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) {
    seen.add(d.seat);
    const an = animate(d.seat, d.x, d.y, t, d.me && !reveal);
    if (d.me) {
      // your own light
      const g = ctx.createRadialGradient(an.x, an.y, 4, an.x, an.y, 46);
      g.addColorStop(0, "rgba(255,240,200,0.10)");
      g.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(an.x, an.y, 46, 0, 7); ctx.fill();
    }
    drawRobber(ctx, an.x, an.y, { color: SEAT_COLORS[d.seat], facing: an.facing, walk: an.walk, moving: an.moving, ghost: d.ghost, mole: d.mole, t: t + d.seat * 777 });
    nameTag(ctx, an.x, an.y - 34, inp.names[d.seat] || (d.me ? "YOU" : "?"), d.mole && !d.me ? "#ff8fa3" : d.me ? "#ffe17a" : "#eef2f8");
  }
  for (const k of [...anims.keys()]) if (!seen.has(k)) anims.delete(k);

  // fog: the exact vision rule from sim.rs, blurred to a soft light falloff
  if (!reveal && !ghost) {
    if (!fogCanvas) {
      fogCanvas = document.createElement("canvas");
      fogCanvas.width = MAP_W; fogCanvas.height = MAP_H;
      fogData = fogCanvas.getContext("2d")!.createImageData(MAP_W, MAP_H);
    }
    const d = fogData!.data;
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
      const i = (ty * MAP_W + tx) * 4;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      const lit = me ? TILES[ty * MAP_W + tx] !== 0 && canSee(me.x, me.y, cx, cy) : false;
      d[i] = 6; d[i + 1] = 8; d[i + 2] = 16;
      d[i + 3] = lit ? 0 : me ? 212 : 140;
    }
    fogCanvas.getContext("2d")!.putImageData(fogData!, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCanvas, 0, 0, MAP_PX_W, MAP_PX_H);
  }

  // screen space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (ghost && !reveal) {
    ctx.fillStyle = "rgba(90,140,255,0.08)";
    ctx.fillRect(0, 0, w, h);
  }
  if (follow) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // task arrows
  if (v && me && v.role === ROLE_CREW && !reveal) {
    v.taskSt.forEach((st, k) => {
      if (v.taskProg[k] === 255 || !STATIONS[st]) return;
      const sx = STATIONS[st].x * s + ox, sy = STATIONS[st].y * s + oy;
      const pad = 34;
      if (sx > pad && sx < w - pad && sy > pad && sy < h - pad) {
        const b = Math.sin(t / 180) * 4;
        arrow(ctx, sx, sy - 26 * s - 6 + b, Math.PI / 2, "#ffd23f");
      } else {
        const ang = Math.atan2(sy - h / 2, sx - w / 2);
        const ex = Math.max(pad, Math.min(w - pad, w / 2 + Math.cos(ang) * w));
        const ey = Math.max(pad, Math.min(h - pad, h / 2 + Math.sin(ang) * h));
        arrow(ctx, ex, ey, ang, "#ffd23f");
      }
    });
  }
}

function nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, color: string) {
  ctx.save();
  ctx.font = "800 9px Nunito, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(5,7,12,0.9)";
  ctx.strokeText(name, x, y);
  ctx.fillStyle = color;
  ctx.fillText(name, x, y);
  ctx.restore();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#1a1405";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 0); ctx.lineTo(-6, -9); ctx.lineTo(-2, 0); ctx.lineTo(-6, 9);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawStations(ctx: CanvasRenderingContext2D, v: ViewState | null, t: number) {
  STATIONS.forEach((st, i) => {
    const mine = v ? v.taskSt.indexOf(i) : -1;
    const done = mine >= 0 && v!.taskProg[mine] === 255;
    const active = mine >= 0 && !done && v!.role === ROLE_CREW;
    const { x, y } = st;
    ctx.save();
    if (active) {
      // pulsing halo (layered fills; shadowBlur is a per-frame Gaussian blur on phones)
      const p = 0.5 + 0.5 * Math.sin(t / 200);
      ctx.fillStyle = `rgba(255,210,63,${0.10 + p * 0.10})`;
      ctx.beginPath(); ctx.roundRect(x - 17, y - 14, 34, 30, 9); ctx.fill();
      ctx.fillStyle = `rgba(255,210,63,${0.12 + p * 0.12})`;
      ctx.beginPath(); ctx.roundRect(x - 14, y - 11, 28, 24, 7); ctx.fill();
    }
    // console body
    ctx.fillStyle = "#2a3346";
    ctx.strokeStyle = active ? "#ffd23f" : "#0b0f18";
    ctx.lineWidth = active ? 2 : 1.5;
    ctx.beginPath(); ctx.roundRect(x - 11, y - 8, 22, 18, 4); ctx.fill(); ctx.stroke();
    // screen
    ctx.fillStyle = done ? "#1d6b4a" : active ? "#6b5a12" : "#1b3a5a";
    ctx.beginPath(); ctx.roundRect(x - 8, y - 6, 16, 9, 2); ctx.fill();
    if (done) {
      ctx.strokeStyle = "#3ddc97"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 2); ctx.lineTo(x - 1, y + 1); ctx.lineTo(x + 4, y - 4); ctx.stroke();
    } else {
      ctx.fillStyle = active ? "#ffe680" : "#4dabff";
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 300 + i);
      ctx.fillRect(x - 6, y - 4, 6 + ((t / 100 + i * 3) % 6), 1.5);
      ctx.fillRect(x - 6, y - 1, 9, 1.5);
      ctx.globalAlpha = 1;
    }
    // progress ring for your active task
    if (active) {
      const p = v!.taskProg[mine] / TASK_TICKS;
      if (p > 0) {
        ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y + 1, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); ctx.stroke();
      }
    }
    ctx.restore();
  });
}

function drawButton(ctx: CanvasRenderingContext2D, t: number) {
  const { x, y } = BUTTON;
  ctx.save();
  const p = 0.5 + 0.5 * Math.sin(t / 250);
  ctx.fillStyle = `rgba(255,45,85,${0.12 + p * 0.14})`;
  ctx.beginPath(); ctx.ellipse(x, y - 1, 17 + p * 3, 12 + p * 2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#c81e3c";
  ctx.beginPath(); ctx.ellipse(x, y, 10, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#ff4d6d";
  ctx.beginPath(); ctx.ellipse(x, y - 3, 9, 5.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(200,230,255,0.22)";
  ctx.strokeStyle = "rgba(220,240,255,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y - 4, 12, Math.PI, 0); ctx.lineTo(x + 12, y - 1); ctx.lineTo(x - 12, y - 1); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillRect(x - 6, y - 12, 3, 4);
  ctx.restore();
}

// ------------------------------------------------------------------ minimap

export function drawMinimap(ctx: CanvasRenderingContext2D, w: number, h: number, v: ViewState | null, me: { x: number; y: number } | null, t: number, seat: number) {
  const s = Math.min(w / MAP_PX_W, h / MAP_PX_H);
  const ox = (w - MAP_PX_W * s) / 2, oy = (h - MAP_PX_H * s) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(getMap(), 0, 0, MAP_PX_W, MAP_PX_H);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(10,20,40,0.35)";
  ctx.fillRect(0, 0, MAP_PX_W, MAP_PX_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "24px Bungee, Impact, sans-serif";
  ctx.lineJoin = "round";
  for (const [r] of LABELS) {
    const c = { x: ROOM_CENTERS[r].x, y: ROOM_CENTERS[r].y - (r === 4 ? 56 : 0) }; // keep the lobby name off the alarm star
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#0b0f18";
    ctx.strokeText(ROOM_NAMES[r].toUpperCase(), c.x, c.y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ROOM_NAMES[r].toUpperCase(), c.x, c.y);
  }
  if (v && v.role !== 255) {
    v.taskSt.forEach((st, k) => {
      const S = STATIONS[st];
      if (!S) return;
      const done = v.taskProg[k] === 255;
      ctx.fillStyle = done ? "#3ddc97" : v.role === ROLE_CREW ? "#ffd23f" : "#ff8fa3";
      ctx.beginPath(); ctx.arc(S.x, S.y, 10, 0, 7); ctx.fill();
      ctx.strokeStyle = "#0b0f18"; ctx.lineWidth = 3; ctx.stroke();
    });
  }
  star(ctx, BUTTON.x, BUTTON.y, 12, "#ff4d6d");
  if (me && seat >= 0) {
    const r = 14 + Math.sin(t / 200) * 3;
    ctx.fillStyle = SEAT_COLORS[seat];
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(me.x, me.y, r, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Draws a single character centred in a small canvas (avatars in DOM UI). */
export function drawAvatar(ctx: CanvasRenderingContext2D, w: number, h: number, seat: number, o: { ghost?: boolean; ko?: boolean; mole?: boolean; facing?: number; t?: number }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const sc = Math.min(w, h) / 40;
  ctx.setTransform(sc, 0, 0, sc, w / 2, h / 2 + 4 * sc);
  drawRobber(ctx, 0, 0, { color: SEAT_COLORS[seat] ?? "#888", ghost: o.ghost, ko: o.ko, mole: o.mole, facing: o.facing ?? 1, t: o.t ?? 0, shadow: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export { shade };
