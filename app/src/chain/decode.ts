// Fixed-offset decoders for the program's zero-copy accounts (repr(C), no padding).
// Offsets mirror programs/inside-job/src/state.rs exactly; sizes are asserted there.
import { PublicKey } from "@solana/web3.js";

export const MAXP = 8;
export const NO_SEAT = 255;
export const VOTE_SKIP = 254;
export const VOTE_NONE = 255;
export const ROLE_CREW = 0;
export const ROLE_MOLE = 1;
export const ROLE_UNKNOWN = 255;
export const PH = { LOBBY: 0, STARTING: 1, PLAY: 2, MEETING: 3, RESULT: 4, ENDED: 5, REVEALED: 6 } as const;
export const PHASE_NAME = ["Lobby", "Dealing", "Heist", "Meeting", "Verdict", "Ended", "Lights on"];
export const READY_ALL = 1 | (0xff << 8);
const DISC = 8;
const ZERO = PublicKey.default.toBase58();

export interface RoomState {
  roomId: number; lastTickSlot: number; startSlot: number; phaseEnd: number; taskId: number;
  authority: string; host: string; players: string[]; wallets: string[];
  matchNo: number; tick: number; taskTotal: number; taskDone: number; chatCount: number; readyMask: number;
  lastSeen: number[];
  phase: number; nMoles: number; maxPlayers: number; caller: number; reported: number; ejected: number; ejectedRole: number;
  winner: number; seedState: number; votedMask: number; nHumans: number; staked: number;
  isBot: number[]; alivePub: number[]; lastVotes: number[]; rolesPub: number[]; names: string[];
  chat: { seat: number; text: string; n: number }[];
  /** staked tables: the base-layer Pot this heist plays for (0n = none yet) */
  potNonce: bigint;
  /** lamports per seat; 0 = free table */
  stake: number;
}

export const ROOM_SIZE = 1632;
export const POT_OPEN = 0, POT_SETTLED = 1, POT_REFUNDED = 2;
export interface PotState {
  roomId: number; nonce: bigint; stake: number; createdAt: number; status: number; n: number; winner: number;
  wallets: string[]; sessions: string[]; paid: number[];
}

export function decodePot(raw: Uint8Array): PotState {
  const d = raw.subarray(DISC);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const key = (o: number) => new PublicKey(d.subarray(o, o + 32)).toBase58();
  const n = d[33];
  return {
    roomId: Number(v.getBigUint64(0, true)), nonce: v.getBigUint64(8, true), stake: Number(v.getBigUint64(16, true)),
    createdAt: Number(v.getBigInt64(24, true)), status: d[32], n, winner: d[35],
    wallets: Array.from({ length: MAXP }, (_, i) => key(36 + i * 32)),
    sessions: Array.from({ length: MAXP }, (_, i) => key(292 + i * 32)),
    paid: Array.from({ length: MAXP }, (_, i) => Number(v.getBigUint64(548 + i * 8, true))),
  };
}

export interface ViewState {
  roomId: number; seat: number; tick: number; killCd: number; meX: number; meY: number;
  visX: number[]; visY: number[]; bodyX: number[]; bodyY: number[];
  role: number; alive: number; partnerMask: number; flags: number; visMask: number; ghostMask: number; bodyMask: number;
  nearStation: number; taskSt: number[]; taskProg: number[]; witness: number;
}

export interface WorldState {
  roomId: number; tick: number; dealt: number; x: number[]; y: number[]; seed: Uint8Array; vrf: Uint8Array; salts: Uint8Array[];
  role: number[]; alive: number[]; votes: number[]; taskSt: number[]; taskProg: number[]; body: number[];
}

const td = new TextDecoder();
const str = (b: Uint8Array) => td.decode(b.subarray(0, b.indexOf(0) === -1 ? b.length : b.indexOf(0)));
const u8s = (d: Uint8Array, o: number, n: number) => Array.from(d.subarray(o, o + n));

export function decodeRoom(raw: Uint8Array): RoomState {
  const d = raw.subarray(DISC);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u64 = (o: number) => Number(v.getBigUint64(o, true));
  const i64 = (o: number) => Number(v.getBigInt64(o, true));
  const u32 = (o: number) => v.getUint32(o, true);
  const key = (o: number) => new PublicKey(d.subarray(o, o + 32)).toBase58();
  const players = Array.from({ length: MAXP }, (_, i) => key(104 + i * 32));
  const wallets = Array.from({ length: MAXP }, (_, i) => key(360 + i * 32));
  const chatCount = u32(632);
  const chat: RoomState["chat"] = [];
  const n = Math.min(chatCount, 16);
  for (let k = n; k >= 1; k--) {
    const idx = chatCount - k;
    const slot = idx % 16;
    const len = d[832 + slot];
    chat.push({ seat: d[816 + slot], text: td.decode(d.subarray(848 + slot * 48, 848 + slot * 48 + len)), n: idx });
  }
  return {
    roomId: u64(0), lastTickSlot: u64(8), startSlot: u64(16), phaseEnd: i64(24), taskId: i64(32),
    authority: key(40), host: key(72), players, wallets,
    matchNo: u32(616), tick: u32(620), taskTotal: u32(624), taskDone: u32(628), chatCount, readyMask: u32(636),
    lastSeen: Array.from({ length: MAXP }, (_, i) => u32(640 + i * 4)),
    phase: d[672], nMoles: d[673], maxPlayers: d[674], caller: d[676], reported: d[677], ejected: d[678], ejectedRole: d[679],
    winner: d[680], seedState: d[681], votedMask: d[682], nHumans: d[683], staked: d[684],
    isBot: u8s(d, 688, 8), alivePub: u8s(d, 696, 8), lastVotes: u8s(d, 704, 8), rolesPub: u8s(d, 712, 8),
    names: Array.from({ length: MAXP }, (_, i) => str(d.subarray(720 + i * 12, 732 + i * 12))),
    chat,
    potNonce: d.byteLength >= 1632 ? v.getBigUint64(1616, true) : 0n,
    stake: d.byteLength >= 1632 ? Number(v.getBigUint64(1624, true)) : 0,
  };
}

export function decodeView(raw: Uint8Array): ViewState {
  const d = raw.subarray(DISC);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const i16s = (o: number) => Array.from({ length: MAXP }, (_, i) => v.getInt16(o + i * 2, true));
  return {
    roomId: Number(v.getBigUint64(0, true)), seat: v.getUint32(8, true), tick: v.getUint32(12, true), killCd: v.getUint32(16, true),
    meX: v.getInt16(24, true), meY: v.getInt16(26, true),
    visX: i16s(28), visY: i16s(44), bodyX: i16s(60), bodyY: i16s(76),
    role: d[92], alive: d[93], partnerMask: d[94], flags: d[95], visMask: d[96], ghostMask: d[97], bodyMask: d[98],
    nearStation: d[99], taskSt: u8s(d, 100, 3), taskProg: u8s(d, 103, 3), witness: d[106],
  };
}

export function decodeWorld(raw: Uint8Array): WorldState {
  const d = raw.subarray(DISC);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const i16s = (o: number) => Array.from({ length: MAXP }, (_, i) => v.getInt16(o + i * 2, true));
  return {
    roomId: Number(v.getBigUint64(0, true)), tick: v.getUint32(16, true), dealt: v.getUint32(20, true),
    x: i16s(56), y: i16s(72), seed: d.slice(136, 168), vrf: d.slice(168, 200),
    salts: Array.from({ length: MAXP }, (_, i) => d.slice(200 + i * 32, 232 + i * 32)),
    role: u8s(d, 456, 8), alive: u8s(d, 464, 8), body: u8s(d, 496, 8), votes: u8s(d, 512, 8),
    taskSt: u8s(d, 536, 24), taskProg: u8s(d, 560, 24),
  };
}

export const isEmptyKey = (k: string) => k === ZERO;
export const occupied = (r: RoomState, i: number) => r.isBot[i] === 1 || !isEmptyKey(r.players[i]);
