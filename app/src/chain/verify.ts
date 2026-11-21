// Lights-on verification, entirely in the browser:
//   1. seed == sha256("inside-job/deal/v1" ‖ vrf ‖ salts ‖ room_id ‖ match_no)
//   2. replaying the program's shuffle from that seed gives exactly the revealed roles.
// A port of sim::deal's role assignment (splitmix64 + rejection sampling + Fisher-Yates).
import { MAXP, ROLE_CREW, ROLE_MOLE, ROLE_UNKNOWN, RoomState, WorldState, occupied } from "./decode";

const M64 = (1n << 64n) - 1n;
const le64 = (b: Uint8Array, o: number) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]);
  return v;
};
const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & M64;

class Rng {
  constructor(public s: bigint) {}
  next(): bigint {
    this.s = (this.s + 0x9e3779b97f4a7c15n) & M64;
    let z = this.s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
    return z ^ (z >> 31n);
  }
  below(n: number): number {
    const N = BigInt(n);
    const zone = M64 - (M64 % N);
    for (;;) {
      const v = this.next();
      if (v < zone) return Number(v % N);
    }
  }
}

export function replayRoles(seed: Uint8Array, occupiedSeats: number[]): number[] {
  const rng = new Rng(le64(seed, 0) ^ rotl(le64(seed, 8), 17n));
  const seats = [...occupiedSeats];
  for (let k = seats.length - 1; k >= 1; k--) {
    const j = rng.below(k + 1);
    [seats[k], seats[j]] = [seats[j], seats[k]];
  }
  const nMoles = seats.length >= 7 ? 2 : 1;
  const roles = new Array(MAXP).fill(ROLE_UNKNOWN);
  seats.forEach((s, k) => (roles[s] = k < nMoles ? ROLE_MOLE : ROLE_CREW));
  return roles;
}

export async function mixSeed(vrf: Uint8Array, salts: Uint8Array[], roomId: number, matchNo: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = [new TextEncoder().encode("inside-job/deal/v1"), vrf, ...salts];
  const rid = new Uint8Array(8);
  new DataView(rid.buffer).setBigUint64(0, BigInt(roomId), true);
  const mno = new Uint8Array(4);
  new DataView(mno.buffer).setUint32(0, matchNo, true);
  parts.push(rid, mno);
  const total = parts.reduce((a, p) => a + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

export interface VerifyReport {
  seedOk: boolean;
  rolesOk: boolean;
  seedHex: string;
  vrfHex: string;
  saltsSet: number;
  replayed: number[];
}

export const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------- full replay (WASM)

/**
 * The program's own rule files (state.rs + sim.rs + replaylog.rs) compiled to WebAssembly
 * (tools/replay). Not a port: the browser runs the exact code the TEE ran.
 */
export interface ReplayReport {
  ok: boolean;
  /** revealed seed matches the deal commitment the Room carried to Solana */
  commit: boolean;
  /** the move log's hash chain matches the one committed with the result */
  chain: boolean;
  /** first World field the replay disagrees with (null = identical) */
  world: string | null;
  /** first public-result field the replay disagrees with (null = identical) */
  room: string | null;
  error: string | null;
  steps: number;
  records: number;
  winner: number;
  logHash: string;
  dealCommit: string;
}

let wasm: Promise<WebAssembly.Instance> | null = null;
function loadReplay(): Promise<WebAssembly.Instance> {
  if (!wasm) {
    wasm = import("./replay.wasm?url").then(async ({ default: url }) => {
      const bytes = await (await fetch(url)).arrayBuffer();
      return (await WebAssembly.instantiate(bytes, {})).instance;
    });
    wasm.catch(() => { wasm = null; });
  }
  return wasm;
}
/** Node scripts: hand in the .wasm bytes yourself (no Vite). */
export function useReplayBytes(bytes: ArrayBuffer | Uint8Array) {
  wasm = WebAssembly.instantiate(bytes, {}).then((r) => r.instance);
}

/** Replay a revealed heist from its move log and check it against what was committed. */
export async function verifyReplay(room: Uint8Array, world: Uint8Array, log: Uint8Array): Promise<ReplayReport> {
  const inst = await loadReplay();
  const ex = inst.exports as any;
  const put = (b: Uint8Array) => {
    const p = ex.ij_alloc(b.length) as number;
    new Uint8Array((ex.memory as WebAssembly.Memory).buffer, p, b.length).set(b);
    return p;
  };
  const pr = put(room), pw = put(world), pl = put(log);
  const out = ex.ij_verify(pr, room.length, pw, world.length, pl, log.length) as number;
  const len = ex.ij_out_len() as number;
  const json = new TextDecoder().decode(new Uint8Array((ex.memory as WebAssembly.Memory).buffer, out, len));
  return JSON.parse(json);
}

/** The deal commitment as Solana holds it (from the base-layer Room) vs the revealed one. */
export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function verifyDeal(room: RoomState, world: WorldState): Promise<VerifyReport> {
  const mixed = await mixSeed(world.vrf, world.salts, room.roomId, room.matchNo);
  const seedOk = hex(mixed) === hex(world.seed);
  const seats = Array.from({ length: MAXP }, (_, i) => i).filter((i) => occupied(room, i));
  const replayed = replayRoles(world.seed, seats);
  const rolesOk = seats.every((i) => replayed[i] === world.role[i]);
  return {
    seedOk, rolesOk, seedHex: hex(world.seed), vrfHex: hex(world.vrf),
    saltsSet: world.salts.filter((s) => s.some((b) => b !== 0)).length, replayed,
  };
}
