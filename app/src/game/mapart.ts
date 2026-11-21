// The bank, drawn top-down: outlined walls with lit faces, a distinct floor per room and
// furniture everywhere, all procedural (no image assets). Purely cosmetic: collision and
// fog come from map.txt (mirrored on chain), so nothing here can change gameplay.
import { BUTTON, MAP_H, MAP_W, ROOM_NAMES, TILE, TILES } from "./map";

const PX_W = MAP_W * TILE;
const PX_H = MAP_H * TILE;
const PRE = 2; // pre-render pixel density
const INK = "#10141b";

const tile = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? 0 : TILES[ty * MAP_W + tx]);
const isFloor = (tx: number, ty: number) => tile(tx, ty) !== 0;

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Room nameplates: [room, x, y] in tiles. */
export const LABELS: [number, number, number][] = [[1, 5, 6.3], [2, 19, 5.9], [3, 34, 6.3], [4, 19, 14.5], [5, 5, 15.45], [6, 33, 15.55], [7, 20, 22.6]];

/** Wall-face height (px) on the wall tile directly above a floor tile. */
export const FACE_TOP = 8;

// ------------------------------------------------------------------ floors

function floorTile(g: CanvasRenderingContext2D, r: number, tx: number, ty: number) {
  const x = tx * TILE, y = ty * TILE;
  const n = hash(tx, ty);
  switch (r) {
    case 1: { // Security: teal linoleum
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j + tx + ty) % 2 ? "#3f7d6b" : "#3a7363";
        g.fillRect(x + i * 16, y + j * 16, 16, 16);
      }
      g.strokeStyle = "#336455"; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      break;
    }
    case 2: { // Server room: raised floor panels
      g.fillStyle = "#5d7189"; g.fillRect(x, y, TILE, TILE);
      g.fillStyle = "#6a7f98"; g.fillRect(x + 1, y + 1, TILE - 2, 2); g.fillRect(x + 1, y + 1, 2, TILE - 2);
      g.fillStyle = "#4b5d73"; g.fillRect(x, y + TILE - 1, TILE, 1); g.fillRect(x + TILE - 1, y, 1, TILE);
      g.fillStyle = "#51647b";
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 6 + i * 6, y + 6 + j * 6, 2, 2);
      break;
    }
    case 3: { // Vault: gold diamond plate
      g.fillStyle = "#b8995a"; g.fillRect(x, y, TILE, TILE);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = x + 4 + i * 8, cy = y + 4 + j * 8, up = (i + j) % 2;
        g.strokeStyle = "#a28444"; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx - 2.5, cy + (up ? 2 : -2)); g.lineTo(cx + 2.5, cy + (up ? -2 : 2)); g.stroke();
        g.strokeStyle = "#cfb472"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx - 2.5, cy + (up ? 1 : -3)); g.lineTo(cx + 2.5, cy + (up ? -3 : 1)); g.stroke();
      }
      g.strokeStyle = "#9c7f42"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      break;
    }
    case 4: { // Lobby: marble checker, red carpet runner down the middle
      const carpet = tx >= 17 && tx <= 21;
      if (carpet) {
        g.fillStyle = "#a12d3f"; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = "#b23a4c"; for (let k = 0; k < 4; k++) g.fillRect(x, y + k * 8 + 2, TILE, 2);
        if (tx === 17) { g.fillStyle = "#e0b74a"; g.fillRect(x + 3, y, 3, TILE); g.fillStyle = INK; g.fillRect(x, y, 2, TILE); }
        if (tx === 21) { g.fillStyle = "#e0b74a"; g.fillRect(x + TILE - 6, y, 3, TILE); g.fillStyle = INK; g.fillRect(x + TILE - 2, y, 2, TILE); }
      } else {
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? "#cfc9bb" : "#bdb7a8";
          g.fillRect(x + i * 16, y + j * 16, 16, 16);
        }
        g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + 2 + n * 12, y + 1); g.lineTo(x + 8 + n * 14, y + 15); g.stroke();
        g.strokeStyle = "#aaa496"; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
      break;
    }
    case 5: { // Laser gallery: polished violet stone
      g.fillStyle = (tx + ty) % 2 ? "#4a3e5e" : "#453a58"; g.fillRect(x, y, TILE, TILE);
      g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(x + 3, y + 3, 12, 2);
      g.strokeStyle = "#3a3049"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      break;
    }
    case 6: { // Deposit boxes: wood parquet
      g.fillStyle = (tx + ty) % 2 ? "#9a6a40" : "#8f6239"; g.fillRect(x, y, TILE, TILE);
      g.strokeStyle = "#6e4729"; g.lineWidth = 1;
      if ((tx + ty) % 2) for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 8 + 0.5, y); g.lineTo(x + k * 8 + 0.5, y + TILE); g.stroke(); }
      else for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x, y + k * 8 + 0.5); g.lineTo(x + TILE, y + k * 8 + 0.5); g.stroke(); }
      g.strokeStyle = "#6a4426"; g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      break;
    }
    case 7: { // Sewer: stone bricks around a water channel
      if (ty === 21) {
        g.fillStyle = "#2f8290"; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = "#3a97a5"; g.fillRect(x + ((tx * 7) % 20), y + 8, 10, 2); g.fillRect(x + ((tx * 13) % 22), y + 20, 8, 2);
        g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x, y, TILE, 4);
      } else {
        g.fillStyle = "#56665a"; g.fillRect(x, y, TILE, TILE);
        g.strokeStyle = "#45534a"; g.lineWidth = 1.5;
        const o = (ty % 2) * 8;
        g.strokeRect(x + o + 0.5, y + 0.5, 16, 15); g.strokeRect(x + 16.5 - o, y + 16.5, 16, 15);
        if (n > 0.78) { g.fillStyle = "#6f8a4e"; g.beginPath(); g.ellipse(x + 10, y + 21, 5, 3, 0, 0, 7); g.fill(); }
        if (ty === 20 || ty === 22) { g.fillStyle = "#6b7a6e"; g.fillRect(x, ty === 20 ? y + TILE - 4 : y, TILE, 4); }
      }
      break;
    }
    default: { // Corridor: light steel panels
      g.fillStyle = "#8d9aac"; g.fillRect(x, y, TILE, TILE);
      g.fillStyle = "#9eabbd"; g.fillRect(x + 2, y + 2, TILE - 4, 3);
      g.fillStyle = "#76839a"; g.fillRect(x, y + TILE - 2, TILE, 2); g.fillRect(x + TILE - 2, y, 2, TILE);
      g.fillStyle = "#6c788d";
      for (const [a, b] of [[5, 8], [TILE - 7, 8], [5, TILE - 7], [TILE - 7, TILE - 7]]) g.fillRect(x + a, y + b, 2, 2);
      // hazard stripes where a corridor meets a room
      const edge = (dx: number, dy: number) => { const t2 = tile(tx + dx, ty + dy); return t2 !== 0 && t2 !== 8; };
      const hz = (rx: number, ry: number, w: number, h: number) => {
        g.save();
        g.beginPath(); g.rect(rx, ry, w, h); g.clip();
        g.fillStyle = "#f0c419"; g.fillRect(rx, ry, w, h);
        g.fillStyle = "#1d2129";
        for (let k = -48; k < 48; k += 8) { g.beginPath(); g.moveTo(rx + k, ry); g.lineTo(rx + k + 4, ry); g.lineTo(rx + k + 4 + 6, ry + 6 + Math.max(w, h)); g.lineTo(rx + k + 6, ry + 6 + Math.max(w, h)); g.fill(); }
        g.restore();
        g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
      };
      if (edge(0, -1)) hz(x, y, TILE, 5);
      if (edge(0, 1)) hz(x, y + TILE - 5, TILE, 5);
      if (edge(-1, 0)) hz(x, y, 5, TILE);
      if (edge(1, 0)) hz(x + TILE - 5, y, 5, TILE);
    }
  }
}

// ------------------------------------------------------------------ walls

const FACE: Record<number, [string, string]> = {
  1: ["#7fa7a0", "#5f8780"], 2: ["#8ea2bd", "#6c809b"], 3: ["#c9b37a", "#a08a52"], 4: ["#d9cfb8", "#b3a88f"],
  5: ["#6b5a85", "#54456b"], 6: ["#b98a5a", "#946a40"], 7: ["#7d8f7f", "#5f6f61"], 8: ["#a9b5c6", "#8693a6"],
};

function wallTile(g: CanvasRenderingContext2D, tx: number, ty: number) {
  const x = tx * TILE, y = ty * TILE;
  let near = false;
  for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(tx + dx, ty + dy)) { near = true; break; }
  // wall body (near a floor) or hull void
  g.fillStyle = near ? "#424c5b" : "#262d37";
  g.fillRect(x, y, TILE, TILE);
  if (near) { g.fillStyle = "#4d5868"; g.fillRect(x, y, TILE, 3); }
  const below = tile(tx, ty + 1);
  if (below === 0) return;
  // the wall's front face, decorated for the room it faces
  const [lit, dark] = FACE[below] ?? FACE[8];
  const fy = y + FACE_TOP, fh = TILE - FACE_TOP;
  g.fillStyle = lit; g.fillRect(x, fy, TILE, fh);
  g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(x, fy, TILE, 2);
  g.fillStyle = dark; g.fillRect(x, y + TILE - 5, TILE, 5);
  g.fillStyle = INK; g.fillRect(x, fy - 2, TILE, 2);
  switch (below) {
    case 1: // monitor wall
      for (const k of [0, 1]) {
        g.fillStyle = INK; g.fillRect(x + 2 + k * 15, fy + 2, 13, 12);
        g.fillStyle = hash(tx, k) > 0.5 ? "#4fc3f7" : "#2f9be0"; g.fillRect(x + 3 + k * 15, fy + 3, 11, 10);
        g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 3 + k * 15, fy + 5, 11, 1);
      }
      break;
    case 2: // server racks
      g.fillStyle = "#2a3140"; g.fillRect(x + 2, fy + 1, TILE - 4, fh - 6);
      g.fillStyle = "#3a4356"; for (let k = 0; k < 3; k++) g.fillRect(x + 4, fy + 3 + k * 5, TILE - 8, 3);
      g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(x + 2.5, fy + 1.5, TILE - 5, fh - 7);
      break;
    case 3: // vault: riveted steel bands
      g.fillStyle = "#8a7440"; g.fillRect(x, fy + 6, TILE, 3); g.fillRect(x, fy + 13, TILE, 3);
      g.fillStyle = "#f2dc96"; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + 4 + k * 8, fy + 3, 1.3, 0, 7); g.fill(); }
      break;
    case 4: // lobby: framed paintings + sconces
      if (tx % 3 === 0) {
        g.fillStyle = INK; g.fillRect(x + 5, fy + 1, 22, 15);
        g.fillStyle = "#e0b74a"; g.fillRect(x + 6, fy + 2, 20, 13);
        g.fillStyle = ["#3d6fb0", "#a12d3f", "#3f8f6b"][(tx / 3) % 3]; g.fillRect(x + 8, fy + 4, 16, 9);
        g.fillStyle = "#f3e6b0"; g.beginPath(); g.arc(x + 19, fy + 7, 2, 0, 7); g.fill();
        g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.moveTo(x + 8, fy + 13); g.lineTo(x + 15, fy + 7); g.lineTo(x + 24, fy + 13); g.fill();
      } else if (tx % 3 === 1) {
        g.fillStyle = "#ffe9a8"; g.beginPath(); g.arc(x + 16, fy + 6, 3, 0, 7); g.fill();
        g.fillStyle = "rgba(255,233,168,0.25)"; g.beginPath(); g.arc(x + 16, fy + 7, 7, 0, 7); g.fill();
      }
      break;
    case 5: // laser emitters
      if (tx % 2 === 0) {
        g.fillStyle = INK; g.fillRect(x + 9, fy + 3, 14, 10);
        g.fillStyle = "#3a2232"; g.fillRect(x + 10, fy + 4, 12, 8);
        g.fillStyle = "#ff3355"; g.beginPath(); g.arc(x + 16, fy + 8, 2.4, 0, 7); g.fill();
      }
      break;
    case 6: // safe-deposit boxes
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        g.fillStyle = "#c7a76a"; g.fillRect(x + 1 + i * 10.3, fy + 1 + j * 8, 9.3, 7);
        g.strokeStyle = "#6a5228"; g.lineWidth = 1; g.strokeRect(x + 1.5 + i * 10.3, fy + 1.5 + j * 8, 8.3, 6);
        g.fillStyle = "#5a4320"; g.fillRect(x + 5 + i * 10.3, fy + 4 + j * 8, 2, 2);
      }
      break;
    case 7: // pipes
      g.fillStyle = "#5d6b55"; g.fillRect(x, fy + 5, TILE, 6);
      g.fillStyle = "#8a9a80"; g.fillRect(x, fy + 5, TILE, 2);
      g.fillStyle = INK; g.fillRect(x, fy + 11, TILE, 1);
      if (tx % 4 === 0) { g.fillStyle = "#5d6b55"; g.fillRect(x + 12, fy, 7, fh - 5); g.fillStyle = "#b5552f"; g.fillRect(x + 10, fy + 6, 11, 4); }
      break;
    default: // corridor: strip lights
      if (tx % 2 === 0) { g.fillStyle = "#fff4c2"; g.fillRect(x + 10, fy + 4, 12, 3); g.fillStyle = "rgba(255,244,194,0.3)"; g.fillRect(x + 7, fy + 2, 18, 7); }
  }
}

/** Thick ink outline along every floor/wall boundary, plus soft wall shadows on the floor. */
function outlines(g: CanvasRenderingContext2D) {
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    if (!isFloor(tx, ty)) continue;
    const x = tx * TILE, y = ty * TILE;
    // shadows cast by the walls
    if (!isFloor(tx, ty - 1)) {
      const sh = g.createLinearGradient(0, y, 0, y + 12);
      sh.addColorStop(0, "rgba(0,0,0,0.32)"); sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh; g.fillRect(x, y, TILE, 12);
    }
    if (!isFloor(tx - 1, ty)) {
      const sh = g.createLinearGradient(x, 0, x + 7, 0);
      sh.addColorStop(0, "rgba(0,0,0,0.22)"); sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh; g.fillRect(x, y, 7, TILE);
    }
    if (!isFloor(tx + 1, ty)) {
      const sh = g.createLinearGradient(x + TILE, 0, x + TILE - 7, 0);
      sh.addColorStop(0, "rgba(0,0,0,0.22)"); sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh; g.fillRect(x + TILE - 7, y, 7, TILE);
    }
  }
  g.fillStyle = INK;
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    if (!isFloor(tx, ty)) continue;
    const x = tx * TILE, y = ty * TILE;
    if (!isFloor(tx, ty + 1)) g.fillRect(x - 1, y + TILE - 1, TILE + 2, 3);
    if (!isFloor(tx - 1, ty)) g.fillRect(x - 2, y - 1, 3, TILE + 2);
    if (!isFloor(tx + 1, ty)) g.fillRect(x + TILE - 1, y - 1, 3, TILE + 2);
  }
  // hull edge: where the wall body meets the void
  g.fillStyle = "#161b22";
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    if (isFloor(tx, ty)) continue;
    const near = (a: number, b: number) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(a + dx, b + dy)) return true; return false; };
    if (!near(tx, ty)) continue;
    const x = tx * TILE, y = ty * TILE;
    if (!isFloor(tx, ty - 1) && !near(tx, ty - 1) && ty > 0) g.fillRect(x, y, TILE, 2);
    if (!isFloor(tx, ty + 1) && !near(tx, ty + 1)) g.fillRect(x, y + TILE - 2, TILE, 2);
    if (!near(tx - 1, ty)) g.fillRect(x, y, 2, TILE);
    if (!near(tx + 1, ty)) g.fillRect(x + TILE - 2, y, 2, TILE);
  }
}

// ------------------------------------------------------------------ furniture kit

function shadow(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill();
}

/** A box seen from above: lighter top, darker front, ink outline. */
function blk(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top: string, front: string, fh = 5, r = 3) {
  shadow(g, x + w / 2 + 2, y + h + 1, w / 2 + 2, 4);
  g.fillStyle = front;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  g.fillStyle = top;
  g.beginPath(); g.roundRect(x, y, w, h - fh, r); g.fill();
  g.fillStyle = "rgba(255,255,255,0.22)"; g.fillRect(x + 3, y + 2, w - 6, 2);
  g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke();
}

function chair(g: CanvasRenderingContext2D, cx: number, cy: number, c = "#3d6fb0") {
  shadow(g, cx + 1, cy + 6, 7, 3);
  g.fillStyle = c; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.roundRect(cx - 6, cy - 6, 12, 11, 4); g.fill(); g.stroke();
  g.beginPath(); g.roundRect(cx - 7, cy - 10, 14, 6, 3); g.fill(); g.stroke();
}

function plant(g: CanvasRenderingContext2D, cx: number, cy: number) {
  shadow(g, cx + 1, cy + 8, 9, 3);
  g.fillStyle = "#a8643a"; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx - 7, cy); g.lineTo(cx + 7, cy); g.lineTo(cx + 5, cy + 9); g.lineTo(cx - 5, cy + 9); g.closePath(); g.fill(); g.stroke();
  for (const [dx, dy, r, c] of [[-5, -4, 6, "#3e8d4f"], [5, -5, 6, "#3e8d4f"], [0, -10, 7, "#4fae62"], [0, -3, 5, "#5cc270"]] as [number, number, number, string][]) {
    g.fillStyle = c; g.beginPath(); g.arc(cx + dx, cy + dy, r, 0, 7); g.fill(); g.stroke();
  }
  g.fillStyle = "#5cc270"; g.beginPath(); g.arc(cx, cy - 4, 4, 0, 7); g.fill();
}

/** A round bench ring around a low table (the lobby's waiting area). */
function lounge(g: CanvasRenderingContext2D, cx: number, cy: number) {
  shadow(g, cx + 2, cy + 6, 32, 14);
  g.strokeStyle = INK; g.lineWidth = 2;
  for (let k = 0; k < 4; k++) {
    const a0 = k * (Math.PI / 2) + 0.18, a1 = a0 + Math.PI / 2 - 0.36;
    g.fillStyle = "#3d6fb0";
    g.beginPath(); g.arc(cx, cy, 30, a0, a1); g.arc(cx, cy, 21, a1, a0, true); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#5a8fd6";
    g.beginPath(); g.arc(cx, cy, 28, a0 + 0.05, a1 - 0.05); g.arc(cx, cy, 25, a1 - 0.05, a0 + 0.05, true); g.closePath(); g.fill();
  }
  g.fillStyle = "#e7e2d6"; g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#d3ccbc"; g.beginPath(); g.arc(cx, cy + 2, 11, 0, Math.PI); g.fill();
  // a magazine and a cup
  g.fillStyle = "#ff4d6d"; g.fillRect(cx - 7, cy - 6, 8, 6); g.strokeRect(cx - 7, cy - 6, 8, 6);
  g.fillStyle = "#fff"; g.beginPath(); g.arc(cx + 5, cy + 3, 2.5, 0, 7); g.fill(); g.stroke();
}

function rack(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  shadow(g, x + w / 2 + 2, y + h + 1, w / 2 + 3, 4);
  g.fillStyle = "#2a3140"; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.roundRect(x, y, w, h, 3); g.fill(); g.stroke();
  g.fillStyle = "#3a4356";
  for (let k = 0; k < Math.floor((w - 4) / 10); k++) { g.fillRect(x + 3 + k * 10, y + 3, 8, h - 11); }
  g.fillStyle = "#1c2230"; g.fillRect(x + 2, y + h - 7, w - 4, 5);
}

function crate(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  blk(g, x, y, s, s, "#c9955a", "#9c6e3b", 5, 2);
  g.strokeStyle = "#7a5228"; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + s - 3, y + s - 8); g.moveTo(x + s - 3, y + 3); g.lineTo(x + 3, y + s - 8); g.stroke();
}

function barrel(g: CanvasRenderingContext2D, cx: number, cy: number, c = "#3f6d9e") {
  shadow(g, cx + 2, cy + 8, 9, 3);
  g.fillStyle = c; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(cx, cy, 9, 9, 0, 0, 7); g.fill(); g.stroke();
  g.strokeStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.arc(cx, cy, 5.5, 0, 7); g.stroke();
  g.fillStyle = "rgba(255,255,255,0.3)"; g.beginPath(); g.arc(cx - 3, cy - 3, 2, 0, 7); g.fill();
}

function displayCase(g: CanvasRenderingContext2D, cx: number, cy: number, gem: string) {
  shadow(g, cx + 2, cy + 12, 14, 4);
  g.fillStyle = "#2b2236"; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.roundRect(cx - 12, cy, 24, 12, 2); g.fill(); g.stroke();
  g.fillStyle = "#e0b74a"; g.fillRect(cx - 12, cy, 24, 3);
  g.fillStyle = gem; g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 5, cy - 4); g.lineTo(cx, cy + 1); g.lineTo(cx - 5, cy - 4); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = "rgba(200,235,255,0.22)"; g.strokeStyle = "rgba(220,240,255,0.75)"; g.lineWidth = 1.5;
  g.beginPath(); g.roundRect(cx - 10, cy - 16, 20, 17, [7, 7, 0, 0]); g.fill(); g.stroke();
  g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(cx - 7, cy - 13, 2, 7);
}

function stanchions(g: CanvasRenderingContext2D, pts: [number, number][]) {
  g.strokeStyle = "#a12d3f"; g.lineWidth = 3;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.quadraticCurveTo((pts[i - 1][0] + x) / 2, (pts[i - 1][1] + y) / 2 + 6, x, y) : g.moveTo(x, y)));
  g.stroke();
  for (const [x, y] of pts) {
    shadow(g, x + 1, y + 4, 4, 2);
    g.fillStyle = "#e0b74a"; g.strokeStyle = INK; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke();
  }
}

function goldStack(g: CanvasRenderingContext2D, x: number, y: number) {
  shadow(g, x + 18, y + 8, 20, 4);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) {
    const bx = x + c * 12 + r * 6, by = y - r * 7;
    g.fillStyle = "#c79a1e"; g.strokeStyle = INK; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(bx, by, 11, 7, 1); g.fill(); g.stroke();
    g.fillStyle = "#ffe07a"; g.fillRect(bx + 2, by + 1.5, 7, 2);
  }
}

function cashPallet(g: CanvasRenderingContext2D, x: number, y: number) {
  blk(g, x, y, 40, 26, "#8a6a3a", "#6a4f28", 4, 2);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = "#4caf6a"; g.strokeStyle = "#1d4a2a"; g.lineWidth = 1;
    g.fillRect(x + 3 + i * 12, y + 3 + j * 9, 10, 7); g.strokeRect(x + 3.5 + i * 12, y + 3.5 + j * 9, 9, 6);
    g.fillStyle = "#e7f5d8"; g.fillRect(x + 6 + i * 12, y + 5.5 + j * 9, 4, 2);
  }
}

// ------------------------------------------------------------------ rooms

function decor(g: CanvasRenderingContext2D) {
  const T = TILE;
  g.lineJoin = "round";

  // ---- Security: console desk under the monitor wall, lockers, a rug
  g.fillStyle = "#2f5f53"; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.roundRect(4.2 * T, 3.5 * T, 3.8 * T, 1.8 * T, 8); g.fill(); g.stroke();
  g.strokeStyle = "#4f9a86"; g.lineWidth = 2; g.beginPath(); g.roundRect(4.4 * T, 3.7 * T, 3.4 * T, 1.4 * T, 6); g.stroke();
  blk(g, 4.6 * T, 1.15 * T, 4.2 * T, 18, "#5b6b7d", "#3e4b5a");
  for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? "#4fc3f7" : "#7cf2c3"; g.fillRect(4.6 * T + 8 + k * 30, 1.15 * T + 4, 16, 5); }
  chair(g, 5.4 * T, 2.35 * T); chair(g, 7.6 * T, 2.35 * T);
  for (let k = 0; k < 4; k++) blk(g, 1.08 * T, 3.6 * T + k * 15, 18, 15, "#7a8aa0", "#5b6a80", 3, 1);
  plant(g, 9.3 * T, 1.55 * T);

  // ---- Server room: two rack islands, an AC unit, floor cables
  g.strokeStyle = "#f0c419"; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(17.5 * T, 4.8 * T); g.quadraticCurveTo(19 * T, 5.8 * T, 20.5 * T, 4.8 * T); g.stroke();
  g.strokeStyle = "#4dabff";
  g.beginPath(); g.moveTo(16.2 * T, 4.8 * T); g.quadraticCurveTo(15.5 * T, 6 * T, 14 * T, 5.6 * T); g.stroke();
  rack(g, 16.1 * T, 3.3 * T, 2.6 * T, 1.5 * T);
  rack(g, 20.3 * T, 3.3 * T, 2.6 * T, 1.5 * T);
  blk(g, 24.3 * T, 1.15 * T, 1.5 * T, 1.3 * T, "#c3ccd8", "#8e99a8");
  g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(25.05 * T, 1.65 * T, 10, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(25.05 * T - 9, 1.65 * T); g.lineTo(25.05 * T + 9, 1.65 * T); g.moveTo(25.05 * T, 1.65 * T - 9); g.lineTo(25.05 * T, 1.65 * T + 9); g.stroke();

  // ---- The Vault: the round door, gold, cash pallets
  const vx = 34 * T + 16, vy = 30;
  g.fillStyle = INK; g.beginPath(); g.arc(vx, vy, 29, 0, 7); g.fill();
  g.fillStyle = "#8f7a3f"; g.beginPath(); g.arc(vx, vy, 26, 0, 7); g.fill();
  g.fillStyle = "#c9ad62"; g.beginPath(); g.arc(vx, vy, 20, 0, 7); g.fill();
  g.strokeStyle = "#5a4a24"; g.lineWidth = 3;
  for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; g.beginPath(); g.moveTo(vx, vy); g.lineTo(vx + Math.cos(a) * 16, vy + Math.sin(a) * 16); g.stroke(); }
  g.fillStyle = "#5a4a24"; g.beginPath(); g.arc(vx, vy, 6, 0, 7); g.fill();
  g.fillStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.arc(vx - 8, vy - 8, 4, 0, 7); g.fill();
  goldStack(g, 29.2 * T, 6.55 * T); goldStack(g, 36.6 * T, 6.55 * T);
  cashPallet(g, 37 * T, 1.4 * T); cashPallet(g, 37 * T, 2.6 * T);
  cashPallet(g, 29.2 * T, 1.4 * T);

  // ---- Lobby: teller counter, lounges, plants, the alarm pedestal
  for (const [a, b] of [[13.3, 16.6], [21.4, 24.7]]) {
    blk(g, a * T, 9.15 * T, (b - a) * T, 20, "#7a4f2e", "#5a3a20", 6, 3);
    g.fillStyle = "#e7e2d6"; g.fillRect(a * T + 3, 9.15 * T + 3, (b - a) * T - 6, 5);
    for (let k = 0; k < 2; k++) { g.fillStyle = "#4fc3f7"; g.strokeStyle = INK; g.lineWidth = 1.5; g.fillRect(a * T + 14 + k * 50, 9.15 * T + 2, 12, 7); g.strokeRect(a * T + 14 + k * 50, 9.15 * T + 2, 12, 7); }
  }
  lounge(g, 15 * T, 13.1 * T);
  lounge(g, 24 * T, 13.1 * T);
  plant(g, 13.55 * T, 14.45 * T); plant(g, 25.45 * T, 14.45 * T);
  plant(g, 16.5 * T, 10.6 * T); plant(g, 22.5 * T, 10.6 * T);
  shadow(g, BUTTON.x + 2, BUTTON.y + 9, 24, 9);
  g.fillStyle = "#3a3f4c"; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(BUTTON.x, BUTTON.y + 5, 21, 11, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#5a6072"; g.beginPath(); g.ellipse(BUTTON.x, BUTTON.y + 2, 17, 8, 0, 0, 7); g.fill();

  // ---- Laser gallery: jewel cases on a velvet-roped path, a fuse box
  displayCase(g, 3.2 * T, 12.2 * T, "#4dabff");
  displayCase(g, 7.2 * T, 11.2 * T, "#ff4d6d");
  displayCase(g, 3.4 * T, 14.6 * T, "#3ddc97");
  stanchions(g, [[1.6 * T, 13.4 * T], [3.2 * T, 13.4 * T], [4.6 * T, 13.4 * T]]);
  stanchions(g, [[6.2 * T, 12.4 * T], [7.6 * T, 12.4 * T], [9.2 * T, 12.4 * T]]);
  blk(g, 9.3 * T, 13.4 * T, 18, 40, "#6d7a8c", "#4f5b6c", 4, 2);
  g.fillStyle = "#f0c419"; g.fillRect(9.3 * T + 4, 13.4 * T + 6, 10, 3);
  g.fillStyle = "#ff4d6d"; g.fillRect(9.3 * T + 6, 13.4 * T + 16, 6, 6);

  // ---- Deposit boxes: counting table, money carts, crates
  blk(g, 34.4 * T, 13.05 * T, 2.6 * T, 1.2 * T, "#5d3a22", "#43291a", 5, 4);
  g.fillStyle = "#3f8f6b"; g.fillRect(34.4 * T + 6, 13.05 * T + 5, 2.6 * T - 12, 1.2 * T - 16);
  for (let k = 0; k < 4; k++) { g.fillStyle = "#4caf6a"; g.strokeStyle = "#1d4a2a"; g.lineWidth = 1; g.fillRect(34.6 * T + 6 + k * 17, 13.05 * T + 9, 12, 8); g.strokeRect(34.6 * T + 6 + k * 17, 13.05 * T + 9, 12, 8); }
  chair(g, 35 * T, 14.8 * T, "#a12d3f"); chair(g, 36.4 * T, 14.8 * T, "#a12d3f");
  for (const cx of [29.5, 37.4]) {
    blk(g, cx * T, 15.05 * T, 28, 20, "#2e5e3a", "#1f4428", 5, 3);
    for (let k = 0; k < 3; k++) { g.fillStyle = "#6fcf8a"; g.fillRect(cx * T + 3 + k * 8, 15.05 * T + 3, 6, 8); }
  }
  crate(g, 37.6 * T, 10.2 * T, 22);

  // ---- Sewer: grates over the water, barrels, the getaway dinghy
  for (const gx of [8, 9, 19, 29]) {
    g.fillStyle = "#4a5160"; g.fillRect(gx * T, 21 * T, T, T);
    g.fillStyle = "#1b1f28"; for (let k = 0; k < 5; k++) g.fillRect(gx * T + 3 + k * 6, 21 * T + 3, 3, T - 6);
    g.strokeStyle = INK; g.lineWidth = 1.5; g.strokeRect(gx * T + 0.5, 21 * T + 0.5, T - 1, T - 1);
  }
  barrel(g, 6.7 * T, 19.6 * T); barrel(g, 7.4 * T, 19.5 * T, "#b5552f"); barrel(g, 13.5 * T, 22.4 * T, "#6f8a4e");
  barrel(g, 25.5 * T, 19.6 * T, "#b5552f"); crate(g, 26.1 * T, 19.2 * T, 20);
  barrel(g, 33.3 * T, 22.4 * T);
  // dinghy in the channel
  const bx = 32.2 * T, by = 21.5 * T;
  shadow(g, bx + 2, by + 6, 28, 7);
  g.fillStyle = "#ff9f43"; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(bx, by, 28, 11, 0, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#3a2a1a"; g.beginPath(); g.ellipse(bx, by, 21, 6.5, 0, 0, 7); g.fill();
  g.fillStyle = "#c9a36b"; g.beginPath(); g.arc(bx - 6, by, 5, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#4caf6a"; g.fillRect(bx + 5, by - 4, 9, 7); g.strokeRect(bx + 5, by - 4, 9, 7);
}

function prerender(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = PX_W * PRE;
  c.height = PX_H * PRE;
  const g = c.getContext("2d")!;
  g.scale(PRE, PRE);
  // hull void with a faint diagonal hatch
  g.fillStyle = "#262d37";
  g.fillRect(0, 0, PX_W, PX_H);
  g.strokeStyle = "#2b333e"; g.lineWidth = 6;
  for (let k = -PX_H; k < PX_W; k += 28) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + PX_H, PX_H); g.stroke(); }
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const r = TILES[ty * MAP_W + tx];
    if (r !== 0) floorTile(g, r, tx, ty);
  }
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) if (TILES[ty * MAP_W + tx] === 0) wallTile(g, tx, ty);
  outlines(g);
  // room nameplates, painted on the floor
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "15px Bungee, Impact, sans-serif";
  for (const [r, lx, ly] of LABELS) {
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillText(ROOM_NAMES[r].toUpperCase(), lx * TILE + 1, ly * TILE + 1.5);
    g.fillStyle = "rgba(255,255,255,0.33)";
    g.fillText(ROOM_NAMES[r].toUpperCase(), lx * TILE, ly * TILE);
  }
  decor(g);
  return c;
}

let mapCanvas: HTMLCanvasElement | null = null;
export function getMap(): HTMLCanvasElement {
  if (!mapCanvas) mapCanvas = prerender();
  return mapCanvas;
}
/** Fonts load late: drop the cache once so nameplates use Bungee. */
if (typeof document !== "undefined" && (document as any).fonts?.ready) {
  (document as any).fonts.ready.then(() => { mapCanvas = null; });
}

// ------------------------------------------------------------------ animated layer

export function drawAnimated(ctx: CanvasRenderingContext2D, t: number) {
  const T = TILE;
  ctx.save();
  // laser grid sweeping the gallery
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 3; k++) {
    const y = (9.6 + 2.2 * k + Math.sin(t / 900 + k * 2.1) * 0.8) * T;
    ctx.strokeStyle = "rgba(255,40,80,0.2)"; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(1 * T, y); ctx.lineTo(10 * T, y); ctx.stroke();
    ctx.strokeStyle = "rgba(255,90,120,0.85)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(1 * T, y); ctx.lineTo(10 * T, y); ctx.stroke();
  }
  // server LEDs: wall racks and the two islands
  const led = (x: number, y: number, seed: number) => {
    if (Math.sin(t / (140 + (seed % 9) * 40) + seed) < 0.15) return;
    ctx.fillStyle = seed % 3 === 0 ? "#3ddc97" : seed % 3 === 1 ? "#4dabff" : "#ffd23f";
    ctx.fillRect(x, y, 2.5, 2);
  };
  for (let tx = 13; tx <= 25; tx++) for (let k = 0; k < 3; k++) led(tx * T + 6 + ((k * 9 + tx * 5) % 18), FACE_TOP + 4 + k * 5, tx * 7 + k * 13);
  for (const ix of [16.1, 20.3]) for (let k = 0; k < 7; k++) for (let j = 0; j < 3; j++) led(ix * T + 5 + k * 10, 3.3 * T + 6 + j * 10, Math.round(ix) * 11 + k * 5 + j * 17);
  ctx.globalCompositeOperation = "source-over";
  // security monitors flicker
  for (let tx = 1; tx <= 9; tx++) {
    const f = 0.08 + 0.08 * Math.sin(t / 90 + tx * 3);
    ctx.fillStyle = `rgba(200,240,255,${f})`;
    ctx.fillRect(tx * T + 3, FACE_TOP + 3, 26, 10);
  }
  // sewer water shimmer
  for (let k = 0; k < 18; k++) {
    const x = 5 * T + ((t / 30 + k * 71) % (30 * T));
    ctx.fillStyle = "rgba(190,255,250,0.28)";
    ctx.fillRect(x, 21 * T + 6 + (k % 4) * 6, 12, 1.5);
  }
  // the vault door's dial creeps round
  const vx = 34 * T + 16, vy = 30, a = t / 2400;
  ctx.strokeStyle = "#f2dc96"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx + Math.cos(a) * 10, vy + Math.sin(a) * 10); ctx.stroke();
  ctx.restore();
}
