// Print a room's public state twice, 3 s apart (is the crank ticking?). Usage: npx tsx scripts/peek.ts 21
import { Keypair } from "@solana/web3.js";
import { GameClient } from "../src/chain/client";
import { PHASE_NAME } from "../src/chain/decode";
import { sleep } from "./common";

const id = Number(process.argv[2] ?? 21);
const c = new GameClient(Keypair.generate());
await c.connect();
for (let k = 0; k < 2; k++) {
  const r = (await c.fetchRoom(id))!;
  console.log(new Date().toISOString().slice(11, 19), PHASE_NAME[r.phase], "tick", r.tick, "tasks", `${r.taskDone}/${r.taskTotal}`, "alive", r.alivePub.join(""), "pot", r.potNonce.toString(), "winner", r.winner);
  if (k === 0) await sleep(3000);
}
process.exit(0);
