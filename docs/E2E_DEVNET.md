# Verified on devnet — live MagicBlock TEE

Current room pool: free crews **31–34**, staked tables **41–42** (1 devnet USDC a seat),
provisioned 2026-11-21 with `npx tsx app/scripts/setup-rooms.ts`. Older room numbers below
belong to earlier Room layouts and are retired.

## v2: verifiable replay + commits (2026-11-21, crew 31)

`npx tsx app/scripts/e2e.ts 31`, right after the v2 program upgrade (deal commitment, move
log, WASM replay, `commit_result`). One human session key + bots played a full heist; a
second keypair ("stranger") holds a valid TEE token but is on no permission list.

```
PASS  room is readable by anyone (public)                     — phase Lobby
PASS  seat owner can read their own View                      — readable (120 bytes)
PASS  stranger with a valid token is refused my View          — TEE returned null — sealed
PASS  VRF callback dealt the roles                            — seed_state=1 in 902 ms
PASS  my View holds my role                                   — I am crew
PASS  the deal commitment is on Solana before play            — 3d7c3de63f13747f
PASS  stranger is refused the sealed move log                 — TEE returned null — sealed
PASS  stranger is refused the sealed World                    — TEE returned null — sealed
PASS  a seated player is refused the sealed World too         — TEE returned null — sealed
PASS  a seated player is refused another seat's View          — TEE returned null — sealed
PASS  crank ticks the heist inside the TEE                    — 12.0 ticks/s
PASS  act moves my sealed position                            — (576,336) -> (583,336)
PASS  another player sees no body of my act (no cuff bit)     — redacted shell: 0 accounts, 0 instructions, 0 logs
PASS  a no-token RPC caller sees no body of my act            — redacted shell: 0 accounts, 0 instructions, 0 logs
PASS  the TEE redacts even for the signer (nothing to subpoena) — redacted shell: 0 accounts, 0 instructions, 0 logs
PASS  stranger can't list my gameplay signatures              — 2 listed
PASS  no-token can't list my gameplay signatures              — 2 listed
PASS  gameplay never touches Solana base layer                — not on devnet
PASS  stranger tx history of World is hidden                  — 0 signatures
PASS  stranger tx history of my View is hidden                — 0 signatures
PASS  stranger tx history of Room (public by design)          — 0 signatures
PASS  program logs never carry inputs or roles                — stranger saw 0 log events in 2.5 s
PASS  the heist ends with a winner                            — Mole wins
PASS  roles are published only at the end
PASS  after lights-on the World is public                     — readable (600 bytes)
PASS  seed = sha256(vrf || salts || room || heist)            — 412cba6c261bbf24
PASS  replayed shuffle == revealed roles
PASS  the move log is public after lights-on                  — 200 records over 1941 steps
PASS  WASM replay rebuilds the exact revealed World + result
PASS  revealed seed matches the deal commitment               — 3d7c3de63f13747f
PASS  move log hash chain matches the Room's                  — cc58bf5a46040ae6
PASS  Solana holds the same result + log hash (free table commit) — winner 1
PASS  reset re-seals the World                                — TEE returned null — sealed
```

"2 listed" is not a leak: the check asserts that the `act` probe carrying the cuff bit is
not among the signatures a stranger can list for my session key; the two it lists are
setup transactions (join, start).

The v2 staked run (`e2e-stake.ts 41`: USDC tickets, `commit_result` → `settle`, Tip Line
claim) is pending devnet USDC for the admin wallet. The v1 staked run below exercised the
same commit + Magic Action payout with SOL stakes.

## v1: first live run (2026-11-18)

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

## v1 staked table: stake → sealed heist → Magic Action payout (2026-11-19)

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
(In v1, `finish` did the commit itself. In v2 the commit is its own step, `commit_result`,
so a commit the rollup refuses can never strand a room mid-reveal.)
