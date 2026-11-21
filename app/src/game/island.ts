// INSIDE JOB's landing-page diorama: a floating bank-castle island, authored as pixel art
// in code. Everything is rasterised onto a hard pixel grid (no anti-aliasing), outlined,
// cached per lighting level, then composed with the animated bits (water, crew, flags,
// smoke, clouds, searchlight) every frame. Original art.
import { SEAT_COLORS } from "./render";

// ------------------------------------------------------------------ colour + time of day

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const sh = (c: RGB, k: number): string => css([Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)]);

interface Sky { top: RGB; mid: RGB; low: RGB; cloud: RGB; cloudShade: RGB; light: number; sun: RGB; tint: RGB }
const KEYS: [number, Sky][] = [
  [0.0, { top: hex("#0b0a24"), mid: hex("#1b1846"), low: hex("#2e2a63"), cloud: hex("#3c3a7c"), cloudShade: hex("#28265c"), light: 0.42, sun: hex("#e8ecff"), tint: hex("#2a2a70") }],
  [0.24, { top: hex("#3a2a6e"), mid: hex("#a0577e"), low: hex("#f2a274"), cloud: hex("#f8cfae"), cloudShade: hex("#c98e9a"), light: 0.82, sun: hex("#ffd27a"), tint: hex("#ff9a6a") }],
  [0.42, { top: hex("#3d6fd1"), mid: hex("#6f9be6"), low: hex("#a9c8f2"), cloud: hex("#f4f8ff"), cloudShade: hex("#b9cdea"), light: 1, sun: hex("#fff6c8"), tint: hex("#ffffff") }],
  [0.62, { top: hex("#4a78d6"), mid: hex("#80a6e8"), low: hex("#bcd4f4"), cloud: hex("#ffffff"), cloudShade: hex("#c3d3ec"), light: 1, sun: hex("#fff3c0"), tint: hex("#ffffff") }],
  [0.76, { top: hex("#3b2a6a"), mid: hex("#b15a73"), low: hex("#f4a35f"), cloud: hex("#f9cba0"), cloudShade: hex("#b8728a"), light: 0.8, sun: hex("#ffb35c"), tint: hex("#ff9050") }],
  [0.86, { top: hex("#171338"), mid: hex("#3a2a66"), low: hex("#6a3c6e"), cloud: hex("#5c4a84"), cloudShade: hex("#3a2f62"), light: 0.56, sun: hex("#ffd9a0"), tint: hex("#5a4aa0") }],
  [1.0, { top: hex("#0b0a24"), mid: hex("#1b1846"), low: hex("#2e2a63"), cloud: hex("#3c3a7c"), cloudShade: hex("#28265c"), light: 0.42, sun: hex("#e8ecff"), tint: hex("#2a2a70") }],
];
function skyAt(t: number): Sky {
  t = ((t % 1) + 1) % 1;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a, A] = KEYS[i], [b, B] = KEYS[i + 1];
    if (t >= a && t <= b) {
      const k = (t - a) / (b - a);
      return {
        top: mix(A.top, B.top, k), mid: mix(A.mid, B.mid, k), low: mix(A.low, B.low, k), cloud: mix(A.cloud, B.cloud, k),
        cloudShade: mix(A.cloudShade, B.cloudShade, k), light: A.light + (B.light - A.light) * k, sun: mix(A.sun, B.sun, k), tint: mix(A.tint, B.tint, k),
      };
    }
  }
  return KEYS[0][1];
}
export function phaseName(t: number) {
  t = ((t % 1) + 1) % 1;
  if (t < 0.2 || t >= 0.88) return "NIGHT";
  if (t < 0.34) return "DAWN";
  if (t < 0.48) return "MORNING";
  if (t < 0.62) return "NOON";
  if (t < 0.8) return "DUSK";
  return "EVENING";
}

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ------------------------------------------------------------------ pixel rasteriser

type Pt = [number, number];
/** Fill a convex polygon on the hard pixel grid (no anti-aliasing). */
function fillConvex(g: CanvasRenderingContext2D, pts: Pt[], color: string) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  g.fillStyle = color;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const yc = y + 0.5;
    let xl = Infinity, xr = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((yc >= a[1] && yc < b[1]) || (yc >= b[1] && yc < a[1])) {
        const x = a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
    }
    if (xl <= xr) {
      const x0 = Math.round(xl), x1 = Math.round(xr);
      if (x1 > x0) g.fillRect(x0, y, x1 - x0, 1);
    }
  }
}
/** Point inside a quad (A,B,C,D) at bilinear (s,t). */
const quadAt = (q: Pt[], s: number, t: number): Pt => {
  const ax = q[0][0] + (q[1][0] - q[0][0]) * s, ay = q[0][1] + (q[1][1] - q[0][1]) * s;
  const bx = q[3][0] + (q[2][0] - q[3][0]) * s, by = q[3][1] + (q[2][1] - q[3][1]) * s;
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
};
function speckle(g: CanvasRenderingContext2D, q: Pt[], n: number, colors: string[], r: () => number, size = 1) {
  for (let k = 0; k < n; k++) {
    const [x, y] = quadAt(q, r(), r());
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(Math.floor(x), Math.floor(y), size, size);
  }
}
/** Lines across a quad along t (roof tiles, stone courses, planks). */
function stripes(g: CanvasRenderingContext2D, q: Pt[], n: number, color: string) {
  g.fillStyle = color;
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const a = quadAt(q, 0, t), b = quadAt(q, 1, t);
    const steps = Math.max(1, Math.round(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let i = 0; i <= steps; i++) g.fillRect(Math.floor(a[0] + ((b[0] - a[0]) * i) / steps), Math.floor(a[1] + ((b[1] - a[1]) * i) / steps), 1, 1);
  }
}

// ------------------------------------------------------------------ iso geometry

const U = 8; // half tile width (px); a tile is 16 x 8
const ZH = 8; // px per unit of height
const N = 14; // the island is N x N tiles
const SPR_W = 280, SPR_H = 360;
const OX = SPR_W / 2, OY = 96; // where iso (0,0,0) lands in the sprite
const P = (x: number, y: number, z = 0): Pt => [Math.round(OX + (x - y) * U), Math.round(OY + (x + y) * (U / 2) - z * ZH)];

interface Face { q: Pt[]; base: RGB; k: number }
function drawBox(g: CanvasRenderingContext2D, x: number, y: number, z: number, w: number, d: number, h: number, top: RGB, side: RGB, tex?: (f: Face, which: "top" | "left" | "right") => void) {
  const faces: [Face, "top" | "left" | "right"][] = [
    [{ q: [P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)], base: side, k: 0.7 }, "left"],
    [{ q: [P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)], base: side, k: 0.92 }, "right"],
    [{ q: [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], base: top, k: 1.06 }, "top"],
  ];
  for (const [face, which] of faces) {
    fillConvex(g, face.q, sh(face.base, face.k));
    tex?.(face, which);
  }
}

/** Gable roof with tile courses; the ridge runs along x (alongX) or along y. */
function gableRoof(g: CanvasRenderingContext2D, x: number, y: number, z: number, w: number, d: number, h: number, c: RGB, alongX: boolean) {
  const dark = sh(c, 0.6), mid = sh(c, 0.84), light = sh(c, 1.1), line = sh(c, 0.48);
  if (alongX) {
    const ra = P(x, y + d / 2, z + h), rb = P(x + w, y + d / 2, z + h);
    const back: Pt[] = [P(x, y, z), P(x + w, y, z), rb, ra];
    const front: Pt[] = [ra, rb, P(x + w, y + d, z), P(x, y + d, z)];
    fillConvex(g, back, light);
    stripes(g, back, 4, mid);
    fillConvex(g, front, mid);
    stripes(g, front, 4, dark);
    fillConvex(g, [P(x + w, y, z), rb, P(x + w, y + d, z)], dark);
    g.fillStyle = line;
    const steps = Math.max(1, rb[0] - ra[0]);
    for (let i = 0; i <= steps; i++) g.fillRect(Math.round(ra[0] + ((rb[0] - ra[0]) * i) / steps), Math.round(ra[1] + ((rb[1] - ra[1]) * i) / steps), 1, 1);
  } else {
    const ra = P(x + w / 2, y, z + h), rb = P(x + w / 2, y + d, z + h);
    const left: Pt[] = [P(x, y, z), ra, rb, P(x, y + d, z)];
    const right: Pt[] = [ra, P(x + w, y, z), P(x + w, y + d, z), rb];
    fillConvex(g, left, light);
    stripes(g, left, 4, mid);
    fillConvex(g, right, mid);
    stripes(g, right, 4, dark);
    fillConvex(g, [P(x, y + d, z), rb, P(x + w, y + d, z)], dark);
  }
}

/** Conical tower roof (12 facets, front half visible) with a gold finial. */
function coneRoof(g: CanvasRenderingContext2D, cx: number, cy: number, z: number, r: number, h: number, c: RGB) {
  const apex = P(cx, cy, z + h);
  const ring: Pt[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ring.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
  }
  const centre = P(cx, cy, z);
  for (let k = 0; k < 12; k++) {
    const a = ring[k], b = ring[(k + 1) % 12];
    if ((a[1] + b[1]) / 2 < centre[1] - 1) continue; // back facets hidden
    const left = (a[0] + b[0]) / 2 < apex[0];
    fillConvex(g, [apex, a, b], sh(c, (left ? 0.72 : 0.98) + (k % 2) * 0.07));
  }
  g.fillStyle = sh(c, 0.42);
  for (const p of ring) if (p[1] >= centre[1] - 1) g.fillRect(p[0], p[1], 2, 1);
  g.fillStyle = "#ffd95a";
  g.fillRect(apex[0], apex[1] - 5, 1, 5);
  g.fillStyle = "#c9a227";
  g.fillRect(apex[0] - 1, apex[1] - 1, 3, 1);
}

function tower(g: CanvasRenderingContext2D, cx: number, cy: number, z: number, r: number, h: number, wall: RGB, roofC: RGB, r0: () => number) {
  drawBox(g, cx - r, cy - r, z, r * 2, r * 2, h, hex("#cfc6b6"), wall, (f, which) => {
    if (which === "top") return;
    stripes(g, f.q, Math.round(h * 1.5), sh(f.base, f.k * 0.88));
    speckle(g, f.q, 18, [sh(f.base, f.k * 0.8), sh(f.base, f.k * 1.12)], r0);
    for (let k = 0; k < 2; k++) {
      const [wx, wy] = quadAt(f.q, 0.5, 0.3 + k * 0.3);
      g.fillStyle = "#2a2440";
      g.fillRect(Math.floor(wx), Math.floor(wy), 1, 3);
    }
  });
  for (let k = 0; k < 4; k++) {
    const t = k / 3;
    const a = P(cx - r + t * r * 2, cy + r, z + h), b = P(cx + r, cy - r + t * r * 2, z + h);
    g.fillStyle = sh(wall, 0.7); g.fillRect(a[0], a[1] - 2, 2, 2);
    g.fillStyle = sh(wall, 0.98); g.fillRect(b[0] - 1, b[1] - 2, 2, 2);
  }
  coneRoof(g, cx, cy, z + h, r * 1.35, h * 0.42 + 2.2, roofC);
}

function blob(g: CanvasRenderingContext2D, bx: number, by: number, rr: number, col: string) {
  g.fillStyle = col;
  for (let yy = -rr; yy <= rr; yy++) {
    const span = Math.floor(Math.sqrt(rr * rr - yy * yy) + 0.3);
    g.fillRect(bx - span, by + yy, span * 2 + 1, 1);
  }
}

function treeAt(g: CanvasRenderingContext2D, x: number, y: number, z: number, s: number, r0: () => number) {
  const [px, py] = P(x, y, z);
  g.fillStyle = "#5a3a22";
  g.fillRect(px, py - 4, 2, 4);
  const R = Math.round(4 * s);
  blob(g, px + 1, py - 4 - R, R + 1, "#245c33");
  blob(g, px - 1, py - 5 - R, R, "#2f7a3e");
  blob(g, px + 2, py - 7 - R, R - 1, "#3f9a4a");
  blob(g, px, py - 8 - R, Math.max(1, R - 3), "#6cc35e");
  for (let k = 0; k < 4; k++) { g.fillStyle = "#8ad46a"; g.fillRect(px - R + Math.floor(r0() * R * 2), py - 4 - R * 2 + Math.floor(r0() * R), 1, 1); }
}

// ------------------------------------------------------------------ the static island (cached)

/** Layers: 0 towers & roofs (Room), 1 streets, walls, trees (View), 2 ground & water (World), 3 rock (Pot). */
const LAYER_COUNT = 4;
const cache = new Map<string, HTMLCanvasElement>();
const windowsLit: Pt[] = [];
const chimneys: Pt[] = [];
let waterfallTop: Pt = [0, 0];
let canalPts: Pt[] = [];
let flags: Pt[] = [];
const STREET_A: [number, number] = [1.2, 11], STREET_B: [number, number] = [12.8, 11];

function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function paintLayer(layer: number): HTMLCanvasElement {
  const c = newCanvas(SPR_W, SPR_H);
  const g = c.getContext("2d")!;
  const r0 = rnd(1000 + layer);
  if (layer === 3) paintRock(g, r0);
  if (layer === 2) paintGround(g, r0);
  if (layer === 1) paintStreets(g, r0);
  if (layer === 0) paintBuildings(g, r0);
  outline(g, SPR_W, SPR_H, [27, 21, 48]);
  return c;
}

function paintRock(g: CanvasRenderingContext2D, r: () => number) {
  const left = P(0, N, 0), front = P(N, N, 0), right = P(N, 0, 0);
  const rimH = 4;
  const deepest = 128;
  for (let x = left[0]; x <= right[0]; x++) {
    const topY = x <= front[0]
      ? left[1] + ((x - left[0]) * (front[1] - left[1])) / (front[0] - left[0])
      : front[1] + ((x - front[0]) * (right[1] - front[1])) / (right[0] - front[0]);
    const u = (x - left[0]) / (right[0] - left[0]);
    const bell = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.03) / 0.94))), 1.5);
    const jag = (Math.floor(x / 3) * 7919) % 13;
    const depth = Math.round(8 + bell * deepest * (0.8 + ((jag % 7) / 7) * 0.26)) + (Math.floor(x / 2) % 3 === 0 ? 5 : 0);
    const y0 = Math.round(topY);
    const leftFace = x < front[0];
    for (let y = 0; y < depth; y++) {
      let col: RGB;
      if (y < rimH) col = y < 1 ? hex("#3f8a3a") : hex("#7a4e2c");
      else {
        const k = (y - rimH) / depth;
        col = mix(hex("#948a9a"), hex("#3a3248"), Math.min(1, k * 1.2));
        const band = Math.floor((y + (x % 5)) / 7) % 3 === 0 ? 0.86 : 1;
        const face = leftFace ? 0.76 : 1.0;
        const n = 0.92 + ((x * 13 + y * 7) % 5) * 0.035;
        const m = band * face * n;
        col = [col[0] * m, col[1] * m, col[2] * m];
      }
      g.fillStyle = css(col);
      g.fillRect(x, y0 + y, 1, 1);
    }
    if (r() > 0.78) { g.fillStyle = "#3f8a3a"; g.fillRect(x, y0 + rimH, 1, 1 + Math.floor(r() * 3)); }
    if (r() > 0.93) { g.fillStyle = "#5a3a24"; g.fillRect(x, y0 + depth, 1, 3 + Math.floor(r() * 10)); }
    if (r() > 0.965) { g.fillStyle = "#4f9a3c"; g.fillRect(x, y0 + rimH, 1, 6 + Math.floor(r() * 14)); }
  }
  for (let k = 0; k < 30; k++) {
    const x = Math.floor(left[0] + 12 + r() * (right[0] - left[0] - 24));
    const y = Math.floor(left[1] + 12 + r() * 70);
    g.fillStyle = "rgba(30,24,44,0.5)";
    g.fillRect(x, y, 3 + Math.floor(r() * 6), 1);
  }
}

function paintGround(g: CanvasRenderingContext2D, r: () => number) {
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const q: Pt[] = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
    fillConvex(g, q, (i + j) % 2 ? "#5fb34c" : "#58aa46");
    speckle(g, q, 4, ["#6fc35a", "#4c9a40", "#7bd064"], r);
    if (r() > 0.88) speckle(g, q, 1, ["#ffe27a", "#ff8fb0", "#ffffff"], r);
  }
  // wheat field
  const field: Pt[] = [P(1, 7.4), P(4.2, 7.4), P(4.2, 9.9), P(1, 9.9)];
  fillConvex(g, field, "#e6c34a");
  stripes(g, field, 7, "#c9a227");
  speckle(g, field, 24, ["#fff09a", "#b8901e"], r);
  // the plateau the bank stands on: stone retaining wall, grass top
  drawBox(g, 3, 1.2, 0, 8.4, 5.8, 1.4, hex("#5fb34c"), hex("#a49a90"), (f, which) => {
    if (which === "top") { speckle(g, f.q, 50, ["#6fc35a", "#4c9a40"], r); return; }
    stripes(g, f.q, 3, sh(f.base, f.k * 0.78));
    speckle(g, f.q, 36, [sh(f.base, f.k * 0.82), sh(f.base, f.k * 1.14)], r, 2);
  });
  // the canal running to the edge (and over it, as the waterfall)
  canalPts = [];
  for (let j = 7; j < N; j++) {
    const q: Pt[] = [P(10.6, j), P(11.6, j), P(11.6, j + 1), P(10.6, j + 1)];
    fillConvex(g, q, "#3f93cf");
    speckle(g, q, 3, ["#7cc6f0", "#2f7ab4"], r);
    canalPts.push(quadAt(q, 0.5, 0.5));
  }
  fillConvex(g, [P(10.4, 7), P(10.6, 7), P(10.6, N), P(10.4, N)], "#c9b38a");
  waterfallTop = P(11.1, N, 0);
}

function paintStreets(g: CanvasRenderingContext2D, r: () => number) {
  const street: Pt[] = [P(0.6, 10.4), P(13.4, 10.4), P(13.4, 11.6), P(0.6, 11.6)];
  fillConvex(g, street, "#d9c49a");
  speckle(g, street, 90, ["#bda67a", "#efdcb0", "#a8916a"], r);
  const lane: Pt[] = [P(6.6, 7), P(7.6, 7), P(7.6, 10.4), P(6.6, 10.4)];
  fillConvex(g, lane, "#d9c49a");
  speckle(g, lane, 24, ["#bda67a", "#efdcb0"], r);
  drawBox(g, 10.4, 10.3, 0, 1.4, 1.4, 0.25, hex("#a8743f"), hex("#7a4e2c"), (f) => stripes(g, f.q, 3, "#6a4220"));
  for (let k = 0; k < 4; k++) drawBox(g, 6.6, 6.9 - k * 0.3, 0, 1, 0.3, (k + 1) * 0.35, hex("#cbbfae"), hex("#a49a90"));
  drawBox(g, 0.4, 12.6, 0, 5, 0.3, 0.4, hex("#cbbfae"), hex("#a49a90"));
  drawBox(g, 12.8, 0.6, 0, 0.3, 6.2, 0.4, hex("#cbbfae"), hex("#a49a90"));
  const trees: [number, number, number][] = [
    [1.2, 1.2, 1.1], [2.2, 3.6, 0.9], [0.9, 5.8, 1.2], [12.4, 8.2, 1], [13, 12.4, 1.1], [9.4, 12.8, 0.9],
    [4.6, 13, 1], [1.6, 12.8, 0.8], [12.2, 2.2, 0.9], [8.4, 13.1, 0.8], [2.6, 6.6, 0.8],
  ];
  trees.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [x, y, s] of trees) treeAt(g, x, y, 0, s, r);
  for (const x of [3.4, 8.6, 12.2]) {
    const [px, py] = P(x, 10.3, 0);
    g.fillStyle = "#2a2440"; g.fillRect(px, py - 9, 1, 9);
    g.fillStyle = "#ffd95a"; g.fillRect(px - 1, py - 11, 3, 2);
  }
}

function paintBuildings(g: CanvasRenderingContext2D, r: () => number) {
  windowsLit.length = 0;
  chimneys.length = 0;
  flags = [];
  const Z = 1.4;
  const wallC = hex("#efe4cf"), stone = hex("#d8cdb8"), teal = hex("#2f9c8f");
  // ---- the bank-castle (back to front)
  tower(g, 4, 2, Z, 0.95, 6, stone, teal, r);
  tower(g, 10.4, 2, Z, 0.95, 5.6, stone, teal, r);
  drawBox(g, 4.4, 2.6, Z, 5.8, 3.4, 3.4, hex("#e9dfca"), hex("#e4d8c0"), (f, which) => {
    if (which === "top") return;
    stripes(g, f.q, 6, sh(f.base, f.k * 0.92));
    speckle(g, f.q, 30, [sh(f.base, f.k * 0.88), sh(f.base, f.k * 1.06)], r);
    if (which === "left") {
      for (let k = 0; k < 7; k++) {
        const top = quadAt(f.q, 0.08 + k * 0.14, 0.12), bot = quadAt(f.q, 0.08 + k * 0.14, 0.94);
        g.fillStyle = "#fffaf0"; g.fillRect(Math.floor(top[0]), Math.floor(top[1]), 2, Math.floor(bot[1] - top[1]));
        g.fillStyle = sh(f.base, 0.55); g.fillRect(Math.floor(top[0]) + 2, Math.floor(top[1]), 1, Math.floor(bot[1] - top[1]));
      }
      const d = quadAt(f.q, 0.5, 0.56);
      g.fillStyle = "#8f6b12"; g.fillRect(Math.floor(d[0]) - 4, Math.floor(d[1]) - 2, 9, 11);
      g.fillStyle = "#ffd23f"; g.fillRect(Math.floor(d[0]) - 3, Math.floor(d[1]) - 1, 7, 9);
      g.fillStyle = "#c9a227"; g.fillRect(Math.floor(d[0]), Math.floor(d[1]) + 1, 1, 5); g.fillRect(Math.floor(d[0]) - 2, Math.floor(d[1]) + 3, 5, 1);
    } else {
      for (let k = 0; k < 3; k++) for (let m = 0; m < 2; m++) {
        const p = quadAt(f.q, 0.22 + k * 0.28, 0.3 + m * 0.36);
        g.fillStyle = "#2a2440"; g.fillRect(Math.floor(p[0]), Math.floor(p[1]), 2, 3);
        windowsLit.push([Math.floor(p[0]), Math.floor(p[1])]);
      }
    }
  });
  gableRoof(g, 4.2, 2.4, Z + 3.4, 6.2, 3.8, 2.6, teal, true);
  for (let k = 0; k < 9; k++) {
    const p = P(4.4 + k * 0.72, 6, Z + 3.4);
    g.fillStyle = "#cfc6b6"; g.fillRect(p[0], p[1] - 2, 2, 2);
  }
  tower(g, 4.1, 6.2, Z, 0.85, 4.6, stone, teal, r);
  tower(g, 10.5, 6.2, Z, 0.85, 4.8, stone, teal, r);
  flags.push(P(4, 2, Z + 6 + 4.9), P(10.4, 2, Z + 5.6 + 4.75));

  // ---- the town below (back to front)
  const houses: [number, number, number, number, string, boolean][] = [
    [0.6, 0.6, 2, 1.6, "#c8573c", true], [0.8, 2.8, 1.6, 2, "#3f6fb8", false], [11.8, 7.8, 1.6, 1.8, "#8a4fb2", false],
    [0.6, 7.6, 1.8, 2.2, "#3f6fb8", false], [8.2, 7.6, 2, 1.6, "#c8573c", true], [12.6, 4.2, 1.2, 1.8, "#c8573c", false],
    [5, 12, 2, 1.4, "#c8573c", true], [1.8, 12.9, 1.8, 0.9, "#3f6fb8", true], [10.6, 12.2, 1.8, 1.4, "#8a4fb2", true], [7.6, 12.2, 2, 1.4, "#3f6fb8", true],
  ];
  houses.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [x, y, w, d, roofC, alongX] of houses) {
    const h = 1.3;
    drawBox(g, x, y, 0, w, d, h, wallC, wallC, (f, which) => {
      if (which === "top") return;
      g.fillStyle = sh(hex("#8a5a34"), f.k);
      const a = quadAt(f.q, 0, 0.08), b = quadAt(f.q, 1, 0.08);
      const steps = Math.max(1, Math.round(Math.abs(b[0] - a[0])));
      for (let i = 0; i <= steps; i++) g.fillRect(Math.floor(a[0] + ((b[0] - a[0]) * i) / steps), Math.floor(a[1] + ((b[1] - a[1]) * i) / steps), 1, 1);
      const win = quadAt(f.q, 0.3, 0.45), door = quadAt(f.q, 0.72, 0.5);
      g.fillStyle = "#2a2440"; g.fillRect(Math.floor(win[0]), Math.floor(win[1]), 2, 2);
      windowsLit.push([Math.floor(win[0]), Math.floor(win[1])]);
      if (which === "left") { g.fillStyle = "#6a4220"; g.fillRect(Math.floor(door[0]), Math.floor(door[1]), 2, 4); }
    });
    gableRoof(g, x - 0.15, y - 0.15, h, w + 0.3, d + 0.3, 1.25, hex(roofC), alongX);
    if (Math.floor(x * 7 + y * 3) % 2 === 0) {
      const c = P(x + w * 0.75, y + d * 0.3, h + 0.9);
      g.fillStyle = "#8a5a44"; g.fillRect(c[0], c[1] - 4, 3, 5);
      g.fillStyle = "#5a3a2a"; g.fillRect(c[0], c[1] - 4, 3, 1);
      chimneys.push([c[0] + 1, c[1] - 5]);
    }
  }
}

/** 1-px dark outline around everything opaque (the pixel-art finish). */
function outline(g: CanvasRenderingContext2D, w: number, h: number, c: RGB) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const out = new Uint8ClampedArray(d);
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] > 0) continue;
    if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) {
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
  }
  img.data.set(out);
  g.putImageData(img, 0, 0);
}

/** A layer lit for the time of day (cached by light level and tint). */
function litLayer(layer: number, sky: Sky): HTMLCanvasElement {
  const key = `${layer}|${Math.round(sky.light * 16)}|${sky.tint.map((v) => Math.round(v / 32)).join(",")}`;
  let c = cache.get(key);
  if (c) return c;
  let base = cache.get(`base${layer}`);
  if (!base) { base = paintLayer(layer); cache.set(`base${layer}`, base); }
  c = newCanvas(SPR_W, SPR_H);
  const g = c.getContext("2d")!;
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = "source-atop";
  if (sky.light < 0.999) {
    g.fillStyle = `rgba(14,10,40,${(1 - sky.light) * 0.85})`;
    g.fillRect(0, 0, SPR_W, SPR_H);
  }
  g.fillStyle = css(sky.tint, 0.12);
  g.fillRect(0, 0, SPR_W, SPR_H);
  if (cache.size > 160) { const keep = [0, 1, 2, 3].map((l) => [`base${l}`, cache.get(`base${l}`)] as const); cache.clear(); keep.forEach(([k, v]) => v && cache.set(k, v)); }
  cache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ frame

export interface IslandOpts {
  t: number; // ms
  dayT: number; // 0..1 time of day
  explode?: number; // 0..1 lift the layers apart (the "under the hood" section)
  active?: number; // highlighted layer 0..3 (roofs, streets, ground, rock)
  showSky?: boolean;
  /** 0..1 intro: the island rises out of the clouds on first load */
  intro?: number;
  /** id of a hotspot to light up (hover the town: every building is a page) */
  highlight?: string | null;
  /** override where the sprite's top sits (fraction of h) */
  topFrac?: number;
}

// ------------------------------------------------------------------ hotspots: every building is a page

export interface Hotspot { id: string; title: string; kicker: string; text: string; href: string; box: [number, number, number, number] }
/** Screen-space bounding box (sprite px) of an iso box. */
function isoBox(x: number, y: number, z: number, w: number, d: number, h: number): [number, number, number, number] {
  const pts = [P(x, y, z), P(x + w, y, z), P(x, y + d, z), P(x + w, y + d, z), P(x, y, z + h), P(x + w, y, z + h), P(x, y + d, z + h), P(x + w, y + d, z + h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
export const HOTSPOTS: Hotspot[] = [
  { id: "vault", title: "The Vault", kicker: "THE WORLD · ZERO READERS", text: "Every role, position and ballot, sealed in the TEE.", href: "#hood", box: isoBox(3.4, 1.2, 1.4, 7.8, 5.8, 9.5) },
  { id: "tower", title: "Guard Tower", kicker: "THE CRANK · 10 HZ", text: "Ticks the heist every 100 ms inside the enclave.", href: "#clock", box: isoBox(9.6, 5.3, 1.4, 1.8, 1.8, 8.6) },
  { id: "town", title: "The Town", kicker: "YOUR VIEW · ONE READER", text: "What your light reveals. Only your key can read it.", href: "#sealed", box: isoBox(4.6, 11.8, 0, 5.4, 1.9, 2.8) },
  { id: "falls", title: "The Falls", kicker: "THE PAYOUT · MAGIC ACTION", text: "Lights-on commits the result; Solana pays the winners.", href: "#stakes", box: [P(10.4, N, 0)[0] - 10, P(11.6, 7, 0)[1] - 4, P(11.6, N, 0)[0] + 10, P(11.1, N, 0)[1] + 70] },
];

/** Where the island sprite was last drawn on each canvas (for hit-testing). */
export const placement = new WeakMap<CanvasRenderingContext2D, { sx: number; sy: number }>();

function highlightSpot(g: CanvasRenderingContext2D, spot: Hotspot, sx: number, sy: number, sky: Sky, t: number) {
  const [x0, y0, x1, y1] = spot.box;
  const pad = 3;
  const w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
  g.save();
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 0.28 + 0.12 * Math.sin(t / 220);
  for (const layer of [0, 1, 2]) g.drawImage(litLayer(layer, sky), x0 - pad, y0 - pad, w, h, sx + x0 - pad, sy + y0 - pad, w, h);
  g.restore();
  // pixel target brackets
  g.fillStyle = "#ffd95a";
  const L = 6;
  const bx0 = sx + x0 - pad - 2, by0 = sy + y0 - pad - 2, bx1 = sx + x1 + pad + 2, by1 = sy + y1 + pad + 2;
  const bob = Math.round(Math.sin(t / 260));
  for (const [cx, cy, dx, dy] of [[bx0, by0, 1, 1], [bx1, by0, -1, 1], [bx0, by1, 1, -1], [bx1, by1, -1, -1]] as [number, number, number, number][]) {
    g.fillRect(cx - (dx < 0 ? L - 1 : 0) - dx * bob, cy - dy * bob, L, 1);
    g.fillRect(cx - dx * bob, cy - (dy < 0 ? L - 1 : 0) - dy * bob, 1, L);
  }
}

/** Logical height a PixelCanvas needs so the island fits at 1:1 (crisp, never resampled). */
export const ISLAND_FIT_H = SPR_H + 30;

export function drawIsland(g: CanvasRenderingContext2D, w: number, h: number, o: IslandOpts) {
  const sky = skyAt(o.dayT);
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, w, h);
  const hero = o.showSky !== false;
  if (hero) drawSky(g, w, h, sky, o);

  const ex = o.explode ?? 0;
  const bob = hero ? Math.round(Math.sin(o.t / 1600) * 2) : 0;
  // intro: rise out of the clouds with a soft overshoot-free ease (matches the UI's curve)
  const k = Math.min(1, Math.max(0, o.intro ?? 1));
  const ease = 1 - Math.pow(1 - k, 3);
  const rise = Math.round((1 - ease) * h * 0.45);
  const sx = Math.round(w / 2 - SPR_W / 2);
  const sy = (hero ? Math.round(h * (o.topFrac ?? 0.04)) + bob : Math.round((h - SPR_H) / 2 + ex * 8)) + rise;
  const off = [-ex * 84, -ex * 34, ex * 4, ex * 38].map(Math.round);
  placement.set(g, { sx, sy });

  if (hero) islets(g, w, h, sky, o.t);
  for (let layer = LAYER_COUNT - 1; layer >= 0; layer--) {
    const dim = o.active === undefined || o.active === layer ? 1 : 0.36;
    g.globalAlpha = dim * (hero ? Math.min(1, ease * 1.6) : 1);
    g.drawImage(litLayer(layer, sky), sx, sy + off[layer]);
    animateLayer(g, layer, sx, sy + off[layer], sky, o.t, g.globalAlpha);
  }
  g.globalAlpha = 1;
  const spot = o.highlight ? HOTSPOTS.find((s) => s.id === o.highlight) : null;
  if (spot && ex === 0) highlightSpot(g, spot, sx, sy, sky, o.t);
  if (hero) cloudSea(g, w, h, sky, o.t);
}

function animateLayer(g: CanvasRenderingContext2D, layer: number, x0: number, y0: number, sky: Sky, t: number, alpha: number) {
  const night = sky.light < 0.66;
  g.globalAlpha = alpha;
  if (layer === 3) {
    const [wx, wy] = waterfallTop;
    for (let y = 0; y < 240; y++) {
      const band = Math.floor((y - t / 30) / 3);
      for (let k = -2; k <= 2; k++) {
        const foam = (band + k * 2) % 4 === 0;
        g.fillStyle = foam ? "#eaf7ff" : k === -2 || k === 2 ? "#3f93cf" : "#68b8e8";
        g.fillRect(x0 + wx + k, y0 + wy + y, 1, 1);
      }
    }
  }
  if (layer === 2) {
    for (let i = 0; i < canalPts.length; i++) {
      if (Math.floor(t / 180 + i) % 3 === 0) { g.fillStyle = "#cfefff"; g.fillRect(x0 + Math.floor(canalPts[i][0]), y0 + Math.floor(canalPts[i][1]), 2, 1); }
    }
  }
  if (layer === 1) {
    // the crew strolling the high street (one of them is the Mole...)
    for (let k = 0; k < 6; k++) {
      const cyc = t / 14000 + k / 6;
      const u = cyc % 1;
      const back = Math.floor(cyc) % 2 === 1;
      const x = STREET_A[0] + (STREET_B[0] - STREET_A[0]) * (back ? 1 - u : u);
      const [px, py] = P(x, STREET_A[1] + (k % 2) * 0.3, 0);
      const step = Math.floor(t / 160 + k) % 2;
      g.fillStyle = "#1b1530"; g.fillRect(x0 + px - 1, y0 + py - 7, 5, 8);
      g.fillStyle = SEAT_COLORS[k]; g.fillRect(x0 + px, y0 + py - 6, 3, 5);
      g.fillStyle = "#14171f"; g.fillRect(x0 + px, y0 + py - 5, 3, 1);
      g.fillStyle = "#ffffff"; g.fillRect(x0 + px + (back ? 0 : 2), y0 + py - 5, 1, 1);
      g.fillStyle = "#1b1530"; g.fillRect(x0 + px + step, y0 + py, 1, 1);
    }
  }
  if (layer === 0) {
    for (const [fx, fy] of flags) {
      g.fillStyle = "#3a2a20"; g.fillRect(x0 + fx, y0 + fy - 8, 1, 9);
      const wave = Math.floor(t / 250) % 2;
      g.fillStyle = "#ff4d6d"; g.fillRect(x0 + fx + 1, y0 + fy - 8 + wave, 5, 3);
      g.fillStyle = "#ffd95a"; g.fillRect(x0 + fx + 3, y0 + fy - 7 + wave, 1, 1);
    }
    for (let k = 0; k < chimneys.length; k++) {
      const [cx, cy] = chimneys[k];
      for (let p = 0; p < 4; p++) {
        const life = (t / 900 + p / 4 + k * 0.37) % 1;
        g.fillStyle = `rgba(232,232,242,${0.55 * (1 - life) * alpha})`;
        g.fillRect(x0 + cx + Math.round(Math.sin(life * 6 + k) * 2), y0 + cy - Math.round(life * 12), 2, 2);
      }
    }
    if (night) {
      for (let k = 0; k < windowsLit.length; k++) {
        if ((k * 7 + Math.floor(t / 4000)) % 5 === 0) continue;
        const [wx, wy] = windowsLit[k];
        g.fillStyle = "#ffd27a"; g.fillRect(x0 + wx, y0 + wy, 2, 2);
      }
      const a = Math.sin(t / 1700);
      const [lx, ly] = flags[1] ?? [0, 0];
      const [ex2, ey2] = P(7 + a * 4.5, 10 + a, 0);
      g.globalAlpha = alpha * 0.18;
      fillConvex(g, [[x0 + lx, y0 + ly + 12], [x0 + ex2 - 16, y0 + ey2 + 3], [x0 + ex2 + 16, y0 + ey2 - 3]], "#fff3b0");
    }
  }
  g.globalAlpha = 1;
}

// ------------------------------------------------------------------ sky, clouds, islets

function drawSky(g: CanvasRenderingContext2D, w: number, h: number, sky: Sky, o: IslandOpts) {
  const bands = 22;
  const colAt = (t: number) => (t < 0.55 ? mix(sky.top, sky.mid, t / 0.55) : mix(sky.mid, sky.low, (t - 0.55) / 0.45));
  for (let b = 0; b < bands; b++) {
    const y0 = Math.floor((b * h) / bands), y1 = Math.floor(((b + 1) * h) / bands);
    g.fillStyle = css(colAt(b / (bands - 1)));
    g.fillRect(0, y0, w, y1 - y0);
    if (b < bands - 1) {
      g.fillStyle = css(colAt((b + 1) / (bands - 1)));
      for (let x = 0; x < w; x += 2) { g.fillRect(x, y1 - 2, 1, 1); g.fillRect(x + 1, y1 - 1, 1, 1); }
    }
  }
  if (sky.light < 0.62) {
    const r = rnd(7);
    for (let k = 0; k < 120; k++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h * 0.6);
      const tw = (k + Math.floor(o.t / 500)) % 11;
      if (tw === 0) continue;
      g.fillStyle = `rgba(255,255,255,${Math.min(1, (0.62 - sky.light) * (tw > 8 ? 2.4 : 1.4))})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const d = ((o.dayT % 1) + 1) % 1;
  const sunU = (d - 0.22) / 0.62;
  const up = sunU >= 0 && sunU <= 1;
  const u = up ? sunU : ((d + 1 - 0.84) % 1) / 0.38;
  const bx = Math.round(w * (0.08 + 0.84 * u));
  const by = Math.round(h * (0.66 - Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * 0.5));
  const R = up ? 11 : 8;
  g.fillStyle = css(sky.sun, 0.25);
  blob(g, bx, by, R + 4, css(sky.sun, 0.25));
  blob(g, bx, by, R, css(sky.sun));
  if (!up) blob(g, bx + 4, by - 2, R - 1, css(sky.top));
  g.fillStyle = css(mix(sky.mid, sky.low, 0.35), 0.8);
  farIsle(g, Math.round(w * 0.86), Math.round(h * 0.4), 34);
  farIsle(g, Math.round(w * 0.13), Math.round(h * 0.5), 20);
  const bank = (yy: number, speed: number, sc: number, seed: number, a: number) => {
    const r = rnd(seed);
    for (let k = 0; k < 6; k++) {
      const cw = Math.round((40 + r() * 50) * sc);
      const x = Math.round(((r() * (w + cw * 2) + (o.t / 1000) * speed) % (w + cw * 2)) - cw);
      puff(g, x, Math.round(yy + r() * h * 0.06), cw, sky, a);
    }
  };
  bank(h * 0.16, 3, 0.8, 3, 0.85);
  bank(h * 0.42, 5, 1, 11, 0.95);
  g.fillStyle = css(mix(sky.top, [20, 20, 30], 0.6));
  for (let k = 0; k < 5; k++) {
    const x = Math.round(((o.t / 60 + k * 113) % (w + 40)) - 20);
    const y = Math.round(h * 0.22 + k * 11 + Math.sin(o.t / 400 + k) * 3);
    const flap = Math.floor(o.t / 200 + k) % 2;
    g.fillRect(x, y + flap, 2, 1); g.fillRect(x + 3, y + flap, 2, 1); g.fillRect(x + 2, y + 1 - flap, 1, 1);
  }
}

function puff(g: CanvasRenderingContext2D, x: number, y: number, w: number, sky: Sky, a: number) {
  const h = Math.max(8, Math.round(w * 0.26));
  g.fillStyle = css(sky.cloudShade, a);
  g.fillRect(x, y + h - 3, w, 3);
  g.fillStyle = css(sky.cloud, a);
  g.fillRect(x + 2, y + Math.round(h * 0.45), w - 4, h - Math.round(h * 0.45) - 3);
  blob(g, x + Math.round(w * 0.3), y + Math.round(h * 0.45), Math.round(h * 0.42), css(sky.cloud, a));
  blob(g, x + Math.round(w * 0.55), y + Math.round(h * 0.32), Math.round(h * 0.5), css(sky.cloud, a));
  blob(g, x + Math.round(w * 0.78), y + Math.round(h * 0.55), Math.round(h * 0.32), css(sky.cloud, a));
  g.fillStyle = css(mix(sky.cloud, [255, 255, 255], 0.5), a);
  g.fillRect(x + Math.round(w * 0.45), y + Math.round(h * 0.05), Math.round(w * 0.16), 1);
}

/** The sea of clouds the island floats on (drawn in front of its base). */
function cloudSea(g: CanvasRenderingContext2D, w: number, h: number, sky: Sky, t: number) {
  const base = Math.round(h * 0.86);
  const r = rnd(99);
  for (let k = 0; k < 16; k++) {
    const cw = Math.round(60 + r() * 90);
    const x = Math.round(((r() * (w + cw) + (t / 1000) * (2 + r() * 3)) % (w + cw * 2)) - cw);
    puff(g, x, base + Math.round(r() * h * 0.07) - 12, cw, sky, 1);
  }
  g.fillStyle = css(sky.cloud);
  g.fillRect(0, base + Math.round(h * 0.07), w, h);
}

function farIsle(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillRect(x - s, y, s * 2, 3);
  for (let k = 0; k < s; k++) g.fillRect(x - s + k, y + 3, 2 * (s - k), 1 + (k % 3 === 0 ? 1 : 0));
}

/** Little floating islets with a tree, bobbing beside the big one. */
function islets(g: CanvasRenderingContext2D, w: number, h: number, sky: Sky, t: number) {
  const L = sky.light;
  const draw = (cx: number, cy: number, s: number, ph: number) => {
    const y = cy + Math.round(Math.sin(t / 1300 + ph) * 3);
    g.fillStyle = "#1b1530"; g.fillRect(cx - s - 1, y - 1, s * 2 + 2, 6);
    g.fillStyle = sh(hex("#5fb34c"), L); g.fillRect(cx - s, y, s * 2, 2);
    g.fillStyle = sh(hex("#7a4e2c"), L); g.fillRect(cx - s, y + 2, s * 2, 2);
    for (let k = 0; k < s; k++) {
      g.fillStyle = "#1b1530"; g.fillRect(cx - s + k - 1, y + 4 + Math.floor(k * 0.8), 2 * (s - k) + 2, 1);
      g.fillStyle = sh(mix(hex("#8a8090"), hex("#3a3248"), k / s), L);
      g.fillRect(cx - s + k, y + 4 + Math.floor(k * 0.8), 2 * (s - k), 1);
    }
    blob(g, cx - 2, y - 5, 4, sh(hex("#2f7a3e"), L));
    blob(g, cx - 3, y - 7, 2, sh(hex("#4fae52"), L));
  };
  draw(Math.round(w * 0.84), Math.round(h * 0.52), 13, 0);
  draw(Math.round(w * 0.17), Math.round(h * 0.72), 9, 2);
}
