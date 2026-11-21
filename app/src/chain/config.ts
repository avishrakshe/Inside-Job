import { PublicKey } from "@solana/web3.js";

const env = (typeof import.meta !== "undefined" && (import.meta as any).env) || {};
const pe = (typeof process !== "undefined" && (process as any).env) || {};
const get = (k: string, d: string) => env[`VITE_${k}`] || pe[k] || d;

export const PROGRAM_ID = new PublicKey(get("PROGRAM_ID", "9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U"));
/** Solana devnet (base layer): rooms are created + delegated here. */
export const BASE_RPC = get("BASE_RPC", "https://rpc.magicblock.app/devnet");
/** MagicBlock's TEE (Intel TDX) Private Ephemeral Rollup on devnet. */
export const TEE_RPC = get("TEE_RPC", "https://devnet-tee.magicblock.app");
export const TEE_WS = get("TEE_WS", TEE_RPC.replace(/^http/, "ws"));
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
export const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
/** The public room pool: free tables (guest play, no wallet). v2 rooms (replay + Tip Line). */
export const ROOM_IDS: number[] = get("ROOM_IDS", "31,32,33,34").split(",").map((s: string) => Number(s.trim()));
/** Staked tables: every seat pays the table's stake (USDC) into a Solana Pot; winners split it. */
export const STAKED_ROOM_IDS: number[] = get("STAKED_ROOM_IDS", "41,42").split(",").map((s: string) => Number(s.trim())).filter(Boolean);
/** Circle's devnet USDC: stakes and Tip Line entries. */
export const USDC_MINT = new PublicKey(get("USDC_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"));
export const USDC_DECIMALS = 6;
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const FAUCET_URL = "https://faucet.solana.com";
export const USDC_FAUCET_URL = "https://faucet.circle.com";
/** Base-layer explorer link for an account (Solana devnet). */
export const explorerBase = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

export const explorerTx = (sig: string, onTee = true) =>
  onTee
    ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(TEE_RPC)}`
    : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
