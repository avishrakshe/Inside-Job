// Canvas renderer: a follow camera, a pre-rendered decorated map, soft fog computed with
// exactly the program's vision rule (map.ts mirrors sim.rs), animated characters,
// task arrows and a minimap. Everything here is drawn from what your View contains:
// nothing sealed ever reaches the client, so the renderer can't leak it either.
import { MAXP, ViewState, ROLE_MOLE, ROLE_CREW } from "../chain/decode";
import { BUTTON, MAP_H, MAP_W, ROOM_NAMES, STATIONS, TASK_TICKS, TILE, TILES, canSee } from "./map";
import { drawCuffed, drawRobber, shade, star } from "./sprites";

export const SEAT_COLORS = ["#ff4d6d", "#4dabff", "#3ddc97", "#ffd23f", "#b388ff", "#ff9f43", "#2de2e6", "#ff7ac6"];
export const COLOR_NAMES = ["Red", "Blue", "Green", "Yellow", "Violet", "Orange", "Cyan", "Pink"];

const MAP_PX_W = MAP_W * TILE;
const MAP_PX_H = MAP_H * TILE;
const PRE = 2; // pre-render pixel density

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

// ------------------------------------------------------------------ static map

let mapCanvas: HTMLCanvasElement | null = null;
const tile = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? 0 : TILES[ty * MAP_W + tx]);
const isFloor = (tx: number, ty: number) => tile(tx, ty) !== 0;

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function floorTile(g: CanvasRenderingContext2D, r: number, tx: number, ty: number) {
  const x = tx * TILE, y = ty * TILE;
  const n = hash(tx, ty);
  switch (r) {
    case 1: { // Security: blue ceramic tiles
      g.fillStyle = "#1c2a40"; g.fillRect(x, y, TILE, TILE);
      g.fillStyle = "#22344f"; g.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      g.fillStyle = "rgba(255,255,255,0.03)"; g.fillRect(x + 2, y + 2, TILE - 4, 6);
      break;
    }
    case 2: { // Server room: perforated raised floor
      g.fillStyle = "#13242b"; g.fillRect(x, y, TILE, TILE);
      g.strokeStyle = "#0c181d"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      g.fillStyle = "#1b323b";
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 5 + i * 7, y + 5 + j * 7, 2, 2);
      break;
    }
    case 3: { // Vault: gold diamond plate
      g.fillStyle = "#2e2715"; g.fillRect(x, y, TILE, TILE);
      g.strokeStyle = "#3d331a"; g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = x + 4 + i * 8, cy = y + 4 + j * 8;
        g.beginPath(); g.moveTo(cx - 2, cy + (i + j) % 2 * 2 - 1); g.lineTo(cx + 2, cy - (i + j) % 2 * 2 + 1); g.stroke();
      }
      break;
    }
    case 4: { // Lobby: marble checker + red carpet down the middle
      const carpet = tx >= 17 && tx <= 21;
      if (carpet) {
        g.fillStyle = "#5c1a28"; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = "#6a2232"; for (let k = 0; k < 4; k++) g.fillRect(x, y + k * 8 + 3, TILE, 1);
        if (tx === 17) { g.fillStyle = "#c9a227"; g.fillRect(x + 2, y, 3, TILE); }
        if (tx === 21) { g.fillStyle = "#c9a227"; g.fillRect(x + TILE - 5, y, 3, TILE); }
      } else {
        g.fillStyle = (tx + ty) % 2 ? "#2b2e38" : "#22252e"; g.fillRect(x, y, TILE, TILE);
        g.strokeStyle = "rgba(255,255,255,0.05)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + n * 20, y); g.lineTo(x + 10 + n * 18, y + TILE); g.stroke();
      }
      break;
    }
    case 5: { // Laser hall: glossy black
      g.fillStyle = "#15101a"; g.fillRect(x, y, TILE, TILE);
      g.strokeStyle = "rgba(255,60,90,0.08)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      g.fillStyle = "rgba(255,255,255,0.025)"; g.fillRect(x + 4, y + 4, 10, 3);
      break;
    }
    case 6: { // Deposit boxes: wooden parquet
      g.fillStyle = "#3b2a1b"; g.fillRect(x, y, TILE, TILE);
      g.strokeStyle = "#2c1f13"; g.lineWidth = 1;
      if ((tx + ty) % 2) for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 8, y); g.lineTo(x + k * 8, y + TILE); g.stroke(); }
      else for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x, y + k * 8); g.lineTo(x + TILE, y + k * 8); g.stroke(); }
      break;
    }
    case 7: { // Sewer: wet stone with a water channel
      const water = ty === 21;
      g.fillStyle = water ? "#0f3a36" : "#1b2620"; g.fillRect(x, y, TILE, TILE);
      if (!water) {
        g.strokeStyle = "#141d18"; g.lineWidth = 1;
        g.strokeRect(x + 0.5 + (ty % 2) * 8, y + 0.5, 16, 15); g.strokeRect(x + 16.5 - (ty % 2) * 8, y + 16.5, 16, 15);
        if (n > 0.8) { g.fillStyle = "#2a3d22"; g.beginPath(); g.ellipse(x + 10, y + 20, 5, 3, 0, 0, 7); g.fill(); }
      }
      break;
    }
    default: { // Corridor: metal grate
      g.fillStyle = "#1a1f29"; g.fillRect(x, y, TILE, TILE);
      g.fillStyle = "#222836";
      for (let k = 0; k < 8; k++) g.fillRect(x + 1, y + k * 4 + 1, TILE - 2, 2);
      // hazard stripes at doorways
      const edge = (dx: number, dy: number) => { const t2 = tile(tx + dx, ty + dy); return t2 !== 0 && t2 !== 8; };
      g.save();
      g.beginPath(); g.rect(x, y, TILE, TILE); g.clip();
      const hz = (rx: number, ry: number, w: number, h: number) => {
        g.fillStyle = "#e0b31a"; g.fillRect(rx, ry, w, h);
        g.fillStyle = "#14161c";
        for (let k = -40; k < 40; k += 8) { g.beginPath(); g.moveTo(rx + k, ry); g.lineTo(rx + k + 4, ry); g.lineTo(rx + k + 4 + h, ry + h); g.lineTo(rx + k + h, ry + h); g.fill(); }
      };
      if (edge(0, -1)) hz(x, y, TILE, 4);
      if (edge(0, 1)) hz(x, y + TILE - 4, TILE, 4);
      if (edge(-1, 0)) hz(x, y, 4, TILE);
      if (edge(1, 0)) hz(x + TILE - 4, y, 4, TILE);
      g.restore();
    }
  }
}

function wallTile(g: CanvasRenderingContext2D, tx: number, ty: number) {
  const x = tx * TILE, y = ty * TILE;
  const below = tile(tx, ty + 1);
  g.fillStyle = "#0b0f19"; g.fillRect(x, y, TILE, TILE);
  if (below !== 0) {
    // the wall's front face, decorated for the room it faces
    const FACE = ["", "#25324a", "#17262c", "#3a3220", "#2c2f3b", "#241626", "#4a3822", "#1e2b22", "#262d3b"];
    g.fillStyle = "#1a2234"; g.fillRect(x, y, TILE, 9);
    g.fillStyle = FACE[below] || "#262d3b"; g.fillRect(x, y + 9, TILE, TILE - 9);
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x, y + TILE - 3, TILE, 3);
    const fy = y + 9;
    switch (below) {
      case 1: // monitor wall
        for (const k of [0, 1]) {
          g.fillStyle = "#0b1220"; g.fillRect(x + 2 + k * 15, fy + 3, 13, 11);
          g.fillStyle = hash(tx, k) > 0.5 ? "#1e6fb8" : "#185a8a"; g.fillRect(x + 3 + k * 15, fy + 4, 11, 9);
          g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + 3 + k * 15, fy + 6, 11, 1);
        }
        break;
      case 2: // server racks
        g.fillStyle = "#0b1114"; g.fillRect(x + 2, fy + 1, TILE - 4, TILE - 12);
        g.fillStyle = "#18242a"; for (let k = 0; k < 4; k++) g.fillRect(x + 4, fy + 3 + k * 4, TILE - 8, 2);
        break;
      case 3: // vault: riveted steel
        g.fillStyle = "#5a4a24"; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + 4 + k * 8, fy + 3, 1.2, 0, 7); g.fill(); }
        g.fillStyle = "#4a3f22"; g.fillRect(x, fy + 8, TILE, 2);
        break;
      case 4: // lobby: framed paintings
        if (tx % 3 === 0) {
          g.fillStyle = "#c9a227"; g.fillRect(x + 6, fy + 2, 20, 15);
          g.fillStyle = ["#2a4a6a", "#5a2a3a", "#2a5a4a"][tx % 3 === 0 ? (tx / 3) % 3 : 0]; g.fillRect(x + 8, fy + 4, 16, 11);
          g.fillStyle = "rgba(255,255,255,0.2)"; g.beginPath(); g.arc(x + 19, fy + 8, 2, 0, 7); g.fill();
        }
        break;
      case 5: // laser emitters
        if (tx % 2 === 0) { g.fillStyle = "#3a2232"; g.fillRect(x + 10, fy + 4, 12, 8); g.fillStyle = "#ff3355"; g.beginPath(); g.arc(x + 16, fy + 8, 2, 0, 7); g.fill(); }
        break;
      case 6: // safe-deposit boxes
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          g.fillStyle = "#8a7448"; g.fillRect(x + 1 + i * 10.3, fy + 1 + j * 8, 9.3, 7);
          g.fillStyle = "#3b2f19"; g.fillRect(x + 5 + i * 10.3, fy + 4 + j * 8, 2, 2);
        }
        break;
      case 7: // pipes
        g.fillStyle = "#3d4a3a"; g.fillRect(x, fy + 5, TILE, 5);
        g.fillStyle = "#56664f"; g.fillRect(x, fy + 5, TILE, 1.5);
        if (tx % 4 === 0) { g.fillStyle = "#3d4a3a"; g.fillRect(x + 12, fy, 6, TILE - 9); }
        break;
      default:
        if (tx % 3 === 0) { g.fillStyle = "#ffe9a8"; g.fillRect(x + 12, fy + 3, 8, 3); }
    }
  } else {
    // wall tops: subtle rim where a floor touches
    g.strokeStyle = "#2a3550"; g.lineWidth = 2;
    g.beginPath();
    if (isFloor(tx, ty - 1)) { g.moveTo(x, y + 1); g.lineTo(x + TILE, y + 1); }
    if (isFloor(tx - 1, ty)) { g.moveTo(x + 1, y); g.lineTo(x + 1, y + TILE); }
    if (isFloor(tx + 1, ty)) { g.moveTo(x + TILE - 1, y); g.lineTo(x + TILE - 1, y + TILE); }
    g.stroke();
  }
}

function decor(g: CanvasRenderingContext2D) {
  // the vault door
  const vx = 34 * TILE + 16, vy = 30;
  g.fillStyle = "#1b160b"; g.beginPath(); g.arc(vx, vy, 28, 0, 7); g.fill();
  g.fillStyle = "#8f7a3f"; g.beginPath(); g.arc(vx, vy, 25, 0, 7); g.fill();
  g.fillStyle = "#b39a52"; g.beginPath(); g.arc(vx, vy, 19, 0, 7); g.fill();
  g.strokeStyle = "#5a4a24"; g.lineWidth = 2.5;
  for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; g.beginPath(); g.moveTo(vx, vy); g.lineTo(vx + Math.cos(a) * 15, vy + Math.sin(a) * 15); g.stroke(); }
  g.fillStyle = "#5a4a24"; g.beginPath(); g.arc(vx, vy, 5, 0, 7); g.fill();
  // gold bars in the vault corners
  const gold = (x: number, y: number) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) {
      const bx = x + c * 11 + r * 5.5, by = y - r * 6;
      g.fillStyle = "#c79a1e"; g.fillRect(bx, by, 10, 6);
      g.fillStyle = "#ffd75a"; g.fillRect(bx + 1, by + 1, 8, 2);
    }
  };
  gold(29 * TILE + 6, 6 * TILE + 18); gold(37 * TILE - 10, 6 * TILE + 18);
  // money carts in deposit boxes
  g.fillStyle = "#2e5e3a"; g.fillRect(34 * TILE, 15 * TILE + 6, 26, 16);
  g.fillStyle = "#3f7d4d"; for (let k = 0; k < 3; k++) g.fillRect(34 * TILE + 2 + k * 8, 15 * TILE + 8, 6, 12);
  // lobby: the emergency pedestal base
  g.fillStyle = "#3a3f4c"; g.beginPath(); g.ellipse(BUTTON.x, BUTTON.y + 6, 20, 10, 0, 0, 7); g.fill();
  g.fillStyle = "#4a5060"; g.beginPath(); g.ellipse(BUTTON.x, BUTTON.y + 3, 17, 8, 0, 0, 7); g.fill();
  // security desk + chair
  g.fillStyle = "#3a2e22"; g.fillRect(4 * TILE, 4 * TILE + 8, 64, 18);
  g.fillStyle = "#4a3c2c"; g.fillRect(4 * TILE, 4 * TILE + 8, 64, 4);
  // sewer: grates over the water
  for (const gx of [9, 19, 29]) {
    g.fillStyle = "#3a3f4c"; g.fillRect(gx * TILE, 21 * TILE, TILE, TILE);
    g.fillStyle = "#1b1f28"; for (let k = 0; k < 5; k++) g.fillRect(gx * TILE + 3 + k * 6, 21 * TILE + 2, 3, TILE - 4);
  }
}

function prerender(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = MAP_PX_W * PRE;
  c.height = MAP_PX_H * PRE;
  const g = c.getContext("2d")!;
  g.scale(PRE, PRE);
  g.fillStyle = "#06080d";
  g.fillRect(0, 0, MAP_PX_W, MAP_PX_H);
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const r = TILES[ty * MAP_W + tx];
    if (r !== 0) floorTile(g, r, tx, ty);
  }
  decor(g);
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) if (TILES[ty * MAP_W + tx] === 0) wallTile(g, tx, ty);
  // room nameplates painted on the floor
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "16px Bungee, Impact, sans-serif";
  for (const [r, lx, ly] of LABELS) {
    g.fillStyle = "rgba(255,255,255,0.07)";
    g.fillText(ROOM_NAMES[r].toUpperCase(), lx * TILE, ly * TILE);
  }
  return c;
}

const LABELS: [number, number, number][] = [[1, 5, 5.6], [2, 19, 4.4], [3, 34, 4.6], [4, 15, 13.7], [5, 5, 12.5], [6, 34, 12.5], [7, 20, 20.2]];

export function getMap(): HTMLCanvasElement {
  if (!mapCanvas) mapCanvas = prerender();
  return mapCanvas;
}
/** Fonts load late: drop the cache once so nameplates use Bungee. */
if (typeof document !== "undefined" && (document as any).fonts?.ready) {
  (document as any).fonts.ready.then(() => { mapCanvas = null; });
}

// ------------------------------------------------------------------ animation state

interface Anim { x: number; y: number; facing: number; walk: number; moving: boolean; last: number }
const anims = new Map<number, Anim>();
function animate(key: number, tx: number, ty: number, now: number): Anim {
  let a = anims.get(key);
  if (!a || (a.x - tx) ** 2 + (a.y - ty) ** 2 > 140 * 140) {
    a = { x: tx, y: ty, facing: 1, walk: 0, moving: false, last: now };
    anims.set(key, a);
    return a;
  }
  const dt = Math.min(0.1, Math.max(0, (now - a.last) / 1000));
  a.last = now;
  const k = 1 - Math.exp(-dt * 11);
  const dx = tx - a.x, dy = ty - a.y;
  a.x += dx * k;
  a.y += dy * k;
  const moving = Math.abs(dx) + Math.abs(dy) > 1.2;
  if (Math.abs(dx) > 0.8) a.facing = dx > 0 ? 1 : -1;
  if (moving) a.walk += dt * 15;
  a.moving = moving;
  return a;
}
const cam = { x: MAP_PX_W / 2, y: MAP_PX_H / 2, s: 1, init: false };

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
  if (!cam.init || Math.abs(cam.s - tgtS) > 1.5) { cam.x = tgtX; cam.y = tgtY; cam.s = tgtS; cam.init = true; }
  cam.x += (tgtX - cam.x) * 0.18;
  cam.y += (tgtY - cam.y) * 0.18;
  cam.s += (tgtS - cam.s) * 0.12;
  const s = cam.s;
  const ox = w / 2 - cam.x * s, oy = h / 2 - cam.y * s;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(getMap(), 0, 0, MAP_PX_W, MAP_PX_H);

  animatedDecor(ctx, t);
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
    const an = animate(d.seat, d.x, d.y, t);
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
      d[i] = 2; d[i + 1] = 3; d[i + 2] = 8;
      d[i + 3] = lit ? 0 : me ? 228 : 150;
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

function animatedDecor(ctx: CanvasRenderingContext2D, t: number) {
  // laser grid sweeping the laser hall
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 3; k++) {
    const y = (9.4 + 2.4 * k + Math.sin(t / 900 + k * 2.1) * 0.9) * TILE;
    ctx.strokeStyle = "rgba(255,40,80,0.18)"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(1 * TILE, y); ctx.lineTo(10 * TILE, y); ctx.stroke();
    ctx.strokeStyle = "rgba(255,90,120,0.75)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(1 * TILE, y); ctx.lineTo(10 * TILE, y); ctx.stroke();
  }
  // server LEDs
  for (let tx = 13; tx <= 25; tx++) for (let k = 0; k < 4; k++) {
    const on = Math.sin(t / (140 + ((tx * 7 + k * 13) % 9) * 40) + tx * k) > 0.2;
    if (!on) continue;
    ctx.fillStyle = (tx + k) % 3 === 0 ? "#3ddc97" : (tx + k) % 3 === 1 ? "#4dabff" : "#ffd23f";
    ctx.fillRect(tx * TILE + 6 + ((k * 7) % 18), 9 + 3 + k * 4, 2, 1.5);
  }
  // security monitors flicker
  for (let tx = 1; tx <= 9; tx++) {
    const f = 0.06 + 0.06 * Math.sin(t / 90 + tx * 3);
    ctx.fillStyle = `rgba(120,200,255,${f})`;
    ctx.fillRect(tx * TILE + 3, 13, 26, 9);
  }
  // sewer water shimmer
  for (let k = 0; k < 14; k++) {
    const x = 5 * TILE + ((t / 30 + k * 71) % (30 * TILE));
    ctx.fillStyle = "rgba(120,255,220,0.12)";
    ctx.fillRect(x, 21 * TILE + 6 + (k % 4) * 6, 14, 1.5);
  }
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
      ctx.shadowColor = "#ffd23f";
      ctx.shadowBlur = 10 + Math.sin(t / 200) * 5;
    }
    // console body
    ctx.fillStyle = "#2a3346";
    ctx.strokeStyle = active ? "#ffd23f" : "#0b0f18";
    ctx.lineWidth = active ? 2 : 1.5;
    ctx.beginPath(); ctx.roundRect(x - 11, y - 8, 22, 18, 4); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
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
  ctx.shadowColor = "#ff2d55";
  ctx.shadowBlur = 8 + Math.sin(t / 250) * 6;
  ctx.fillStyle = "#c81e3c";
  ctx.beginPath(); ctx.ellipse(x, y, 10, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#ff4d6d";
  ctx.beginPath(); ctx.ellipse(x, y - 3, 9, 5.5, 0, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
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
  ctx.fillStyle = "rgba(10,20,40,0.45)";
  ctx.fillRect(0, 0, MAP_PX_W, MAP_PX_H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "22px Bungee, Impact, sans-serif";
  for (const [r, lx, ly] of LABELS) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(ROOM_NAMES[r].toUpperCase(), lx * TILE, (ly - 0.6) * TILE);
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
