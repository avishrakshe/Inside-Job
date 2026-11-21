// Same map + same movement/vision rules as programs/inside-job/src/sim.rs, so the
// client can predict its own movement and draw the fog exactly as the TEE computes it.
import mapTxt from "../../../programs/inside-job/src/map.txt?raw";
import stationsTxt from "../../../programs/inside-job/src/stations.txt?raw";

export const TILE = 32;
export const HALF = 16;
export const BODY_R = 8;
export const SPEED = 7;
export const GHOST_SPEED = 9;
export const CORRIDOR = 8;
export const CORRIDOR_SIGHT = 96;
export const USE_R = 40;
export const REPORT_R = 72;
export const CUFF_R = 48;
export const TASK_TICKS = 80;
/** sim::HEIST_TICKS: after 9 minutes of heist time the alarm wins it for the Mole */
export const HEIST_TICKS = 5400;
export const BUTTON = { x: 19 * TILE + HALF, y: 12 * TILE + HALF };

const ROOM_CHARS: Record<string, number> = { "#": 0, S: 1, R: 2, V: 3, L: 4, H: 5, D: 6, W: 7, ".": 8 };
export const ROOM_NAMES = ["", "Security", "Server Room", "The Vault", "Lobby", "Laser Hall", "Deposit Boxes", "Sewer", "Corridor"];

const rows = mapTxt.split(/\r?\n/).filter((l) => l.length > 0);
export const MAP_H = rows.length;
export const MAP_W = rows[0].length;
export const TILES: Uint8Array = new Uint8Array(MAP_W * MAP_H);
rows.forEach((row, y) => [...row].forEach((c, x) => (TILES[y * MAP_W + x] = ROOM_CHARS[c] ?? 0)));

export const STATIONS = stationsTxt
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [x, y, ...name] = l.split(/\s+/);
    return { tx: +x, ty: +y, x: +x * TILE + HALF, y: +y * TILE + HALF, name: name.join(" ") };
  });

export function tileAt(px: number, py: number): number {
  if (px < 0 || py < 0) return 0;
  const tx = Math.trunc(px / TILE), ty = Math.trunc(py / TILE);
  if (tx >= MAP_W || ty >= MAP_H) return 0;
  return TILES[ty * MAP_W + tx];
}

export function walkable(px: number, py: number): boolean {
  return (
    tileAt(px - BODY_R, py - BODY_R) !== 0 && tileAt(px + BODY_R, py - BODY_R) !== 0 &&
    tileAt(px - BODY_R, py + BODY_R) !== 0 && tileAt(px + BODY_R, py + BODY_R) !== 0
  );
}

const d2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

export function canSee(ax: number, ay: number, bx: number, by: number): boolean {
  const ra = tileAt(ax, ay), rb = tileAt(bx, by);
  if (ra === rb && ra !== CORRIDOR && ra !== 0) return true;
  return (ra === CORRIDOR || rb === CORRIDOR) && d2(ax, ay, bx, by) <= CORRIDOR_SIGHT * CORRIDOR_SIGHT;
}

const DIRS: [number, number][] = [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** Identical to sim::step (integer maths). */
export function step(x: number, y: number, dir: number, speed: number): [number, number] {
  const d = dir & 0x0f;
  if (d === 0 || d > 8) return [x, y];
  const [dx, dy] = DIRS[d];
  const s = dx !== 0 && dy !== 0 ? Math.trunc((speed * 5) / 7) : speed;
  let nx = x;
  if (walkable(x + dx * s, y)) nx = x + dx * s;
  let ny = y;
  if (walkable(nx, y + dy * s)) ny = y + dy * s;
  return [nx, ny];
}

export function dirFromKeys(up: boolean, down: boolean, left: boolean, right: boolean): number {
  const dx = (right ? 1 : 0) - (left ? 1 : 0);
  const dy = (down ? 1 : 0) - (up ? 1 : 0);
  const idx = DIRS.findIndex(([a, b]) => a === dx && b === dy);
  return idx < 0 ? 0 : idx;
}

export const dist2 = d2;
