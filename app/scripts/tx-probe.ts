// What does the TEE RPC return for someone else's transaction? Usage: npx tsx scripts/tx-probe.ts [roomId]
// Joins a free lobby seat, sends one `act`, then fetches that tx raw as: the signer, a stranger with a
// valid token, and a caller with no token. Prints exactly what each one gets back.
import { Keypair } from "@solana/web3.js";
import { TEE_RPC } from "../src/chain/config";
import { GameClient } from "../src/chain/client";
import { occupied } from "../src/chain/decode";
import { log, sleep } from "./common";

const roomId = Number(process.argv[2] ?? 12);
const me = new GameClient(Keypair.generate());
const stranger = new GameClient(Keypair.generate());
await me.connect();
await stranger.connect();

const room = (await me.fetchRoom(roomId))!;
const seat = Array.from({ length: room.maxPlayers }, (_, i) => i).find((i) => !occupied(room, i))!;
await me.join(roomId, seat, "PROBE");
const sig = await me.act(roomId, 0x23); // cuff bit + direction
await sleep(2500);

async function raw(label: string, url: string) {
  const body = { jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }] };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j: any = await r.json();
  const res = j.result;
  const ixs = res?.transaction?.message?.instructions ?? [];
  log(label, `http ${r.status}`, j.error ? `error ${JSON.stringify(j.error).slice(0, 160)}` : res ? "result" : "null");
  if (res) {
    console.log("   keys:", JSON.stringify(Object.keys(res)), "tx keys:", JSON.stringify(Object.keys(res.transaction ?? {})));
    console.log("   accountKeys:", (res.transaction?.message?.accountKeys ?? []).length, "instructions:", JSON.stringify(ixs).slice(0, 300));
    console.log("   logs:", JSON.stringify(res.meta?.logMessages ?? null).slice(0, 300));
  }
}

await raw("signer   ", `${TEE_RPC}?token=${me.token}`);
await raw("stranger ", `${TEE_RPC}?token=${stranger.token}`);
await raw("no token ", TEE_RPC);

await me.leave(roomId, seat).catch((e) => log("leave failed", String(e).slice(0, 120)));
process.exit(0);
