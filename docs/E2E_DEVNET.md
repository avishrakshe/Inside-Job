# Verified on devnet — live MagicBlock TEE

`npx tsx app/scripts/e2e.ts 4` — run 2026-11-18 against `https://devnet-tee.magicblock.app` (Intel TDX validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`), program `9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U`.

One human session key + 5 on-chain bots played a full heist (~2.5 min, two meetings). A second, unrelated keypair ("stranger") completed the TEE's own auth handshake and holds a **valid** token — it is refused because it is not on the accounts' permission member lists.

```
PASS  room is readable by anyone (public)            — phase Lobby
PASS  seat owner can read their own View             — readable (120 bytes)
PASS  stranger with a valid token is refused my View — TEE returned null — sealed
PASS  VRF callback dealt the roles                   — seed_state=1 in 1366 ms
PASS  my View holds my role                          — I am crew
PASS  stranger is refused the sealed World           — TEE returned null — sealed
PASS  a seated player is refused the sealed World too — TEE returned null — sealed
PASS  a seated player is refused another seat's View — TEE returned null — sealed
PASS  crank ticks the heist inside the TEE           — 10.3 ticks/s
PASS  act moves my sealed position                   — (576,336) -> (485,336)
PASS  the heist ends with a winner                   — Mole wins
PASS  roles are published only at the end
PASS  after lights-on the World is public            — readable (600 bytes)
PASS  seed = sha256(vrf || salts || room || heist)   — 712b647320a70bd4
PASS  replayed shuffle == revealed roles
PASS  reset re-seals the World                       — TEE returned null — sealed
room 2S3jaWwZE11rFrYui7FzJdGDMezmFYdtvZM9pGDPJjkx
```

Room pool provisioned with `npx tsx app/scripts/setup-rooms.ts 1 2 3 4` (create → delegate to the TEE validator → sealed World + 8 private Views), ~8 s per room.

| Room | PDA |
|---|---|
| 1 | `5E4spW8nStpGSLcm3fdECCxNqDgRE9prxuktyLf7Z1E5` |
| 2 | `F5eNni5VT6NFBYWpe9R15Xp3c757ZWsUJa9kcoyjJoaZ` |
| 3 | `FyYsyMtURcBcxPNcFFnmUqYNZ3XfnNK6s2BBfyiuN9x7` |
| 4 | `2S3jaWwZE11rFrYui7FzJdGDMezmFYdtvZM9pGDPJjkx` |

In the browser, the in-game **Try to cheat** console reports the same thing for a seated player:

```
⛔ World (all roles + positions): TEE returned null — sealed
⛔ View of seat 1 (someone else's sight): TEE returned null — sealed
◯ Room (public lobby): readable (1624 bytes)
◯ Your own View (seat 0): readable (120 bytes)
```

## Staked table: stake → sealed heist → Magic Action payout (2026-11-19)

`npx tsx app/scripts/e2e-stake.ts 21`, against the same TEE + Solana devnet, after the money-layer upgrade. Two wallets each bought a 0.01 SOL ticket on Solana, sat down in the TEE with their session keys, and idled while 3 bots played; the vault's time lock ended the heist. `finish` committed the Room to Solana with a post-commit Magic Action, and `settle` paid out the Pot on Solana **1.5 s later**: no oracle, no admin, no extra transaction from anyone.

```
PASS  staked table reports its stake  (0.01 SOL/seat)
PASS  both tickets are in the Pot on Solana  (pot 8FKJWd3huQXYCKRagAsbpFWkvjijqJXabRTJ2pfgsBci)
PASS  a session key the ticket didn't name is refused a seat
PASS  both staked players are seated in the TEE  (pot_nonce 4242147872868056987)
PASS  the staked heist ends with a winner  (Mole wins)
PASS  lights-on committed the Room and the Magic Action settled the Pot on Solana  (1.5 s after finish)
PASS  conservation: payouts == stake × tickets  (20000000 == 20000000)
```

The Mole was a bot, so no human won and both tickets were refunded in full (`payouts [0.01, 0.01]`), exactly as `money.rs` specifies.

Current room pool (`npx tsx app/scripts/setup-rooms.ts`): free crews **11–14**, staked tables **21–22** (0.01 SOL/seat). Rooms 1–4 below predate the Room layout change and are retired.
