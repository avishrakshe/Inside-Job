# INSIDE JOB

**A real-time heist of social deduction where nobody can know the Mole — not the players, not the chain, not even the randomness oracle.**

Built for **MagicBlock Solana Blitz v10 — Entertainment Finance**. Every move, cuff and sealed vote is a gasless Solana transaction inside a **MagicBlock Private Ephemeral Rollup** (Intel TDX). A crank ticks the game every 100 ms inside the enclave. There is no game server.

| | |
|---|---|
| Play | **https://inside-job-six.vercel.app** (free tables: no wallet needed) |
| Program (devnet) | `9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U` |
| Rollup | MagicBlock TEE devnet — `devnet-tee.magicblock.app`, validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` |
| Live proof | checks against the live devnet TEE — [docs/E2E_DEVNET.md](docs/E2E_DEVNET.md) |
| Free tables (delegated to the TEE) | crews 11–14 |
| Staked tables | tables 21–22 · 0.01 devnet SOL a seat · winners split the Pot, paid by a Magic Action |

## Why it can't exist on plain Solana

On a public chain every account is readable. A hidden-role game there is over before it starts: the Mole is one `getAccountInfo` away, and so is everyone's position — which is just as revealing (*who was standing next to the body?*). INSIDE JOB keeps **roles, true positions, bodies, ballots and salts** in a `World` account whose permission has **zero members**. Each seat can read only its own `View`: what its light reveals, computed inside the TEE every tick.

## The game

A crew of robbers cracks a vault in real time. One of them (two at 7–8 players) is an undercover **Mole**.

- **Crew** — finish your three stations (hold `E`). When the vault bar fills, the crew wins.
- **Mole** — cuff the crew when nobody's looking (`Q`), fake your tasks, survive the vote.
- **Report** a body (`R`) or hit the **emergency button** in the lobby (`F`) → meeting. Chat is on-chain and only open during meetings. **Ballots are sealed** in the World and published all at once at the tally.
- **Lights on** — when the game ends, World and every View flip public: anyone can replay the whole deal and check every role.
- Empty seats are filled by **on-chain bots** that obey the same fog of war.

## MagicBlock building blocks — take one away and it breaks

| Building block | Job in INSIDE JOB |
|---|---|
| **Private Ephemeral Rollup (TEE)** | Holds the sealed truth. Without it, roles and positions are public state. |
| **Ephemeral permissions** | `World` has 0 readers · `View[i]` is readable only by seat *i*'s session key + wallet · `Room` is public. `join`/`leave` rewrite View members, `finish` flips everything public, `reset` re-seals. |
| **Ephemeral accounts** | World and the 8 Views live only inside the rollup, rent sponsored by the Room PDA. |
| **VRF** (delegated queue) | Seeds the deal. Mixed with every player's sealed salt so the oracle can't know the roles. |
| **Crank** | `start_match` schedules `tick` every 100 ms: movement, vision, cooldowns, meetings, bots. |
| **Session keys** | The browser makes a key with 0 SOL that signs ~10 moves/s, no wallet popups, and can't move funds. |
| **Delegation** | Room PDAs live on Solana and are delegated to the TEE validator only. |
| **Magic Actions** | Staked tables: `finish` commits the Room to Solana and schedules `settle` there in the same intent, so lights-on *is* the payout. |
| **Commits** | The committed Room is the only thing Solana learns about a heist: who won and who held which role, after lights-on. |

## Staked tables: a pot that pays itself out

1. **Ticket (Solana).** `buy_ticket` moves the table's stake from your wallet into that heist's `Pot` PDA and names the in-browser **session key** that may use the ticket. The Pot is plain base-layer state; the money never leaves Solana.
2. **Seat (TEE rollup).** `join` reads the Pot from Solana inside the rollup and seats only the session key the ticket named. A different key with the same wallet is refused.
3. **Lights on → payout.** `finish` flips the World public, commits the Room to Solana and attaches a post-commit **Magic Action** that runs `settle` on Solana. `settle` reads the *committed* Room (winner + published roles) and pays the winning humans from the Pot. **No oracle, no admin:** the result was sealed program state all along.
4. **Failure paths.** `settle` is permissionless and idempotent, so if the action never lands anyone can run the same payout from the committed Room. If a pot is still open after 20 minutes (crank died, nobody started), **anyone can refund every ticket**. Refund, never re-roll.

**The rules** (`programs/inside-job/src/money.rs`, unit-tested): seated humans on the winning team split everything the seated humans staked; tickets that never sat down are refunded; if no human won (bots did), every human is refunded; no house cut. A property test sweeps every ticket count, stake, seating and winner and asserts **payouts == stake × tickets** to the lamport.

**Small binary.** `magic.rs` encodes the one `ScheduleIntentBundle` we need by hand (the SDK builder adds ~130 KB of bincode to the program); a test asserts it is byte-for-byte what the SDK produces.

## Who can read what

| | You | Other players | Spectators / RPC | After lights-on |
|---|:-:|:-:|:-:|:-:|
| Room: lobby, chat, alive-at-last-meeting, task bar, published votes | ✓ | ✓ | ✓ | ✓ |
| Your View: your role, tasks, what your light reveals | ✓ | ✕ | ✕ | ✓ |
| World: every role, position, body, ballot, salt | ✕ | ✕ | ✕ | ✓ |
| Pot (Solana): tickets, stakes, payouts | ✓ | ✓ | ✓ | ✓ |
| Gameplay transactions (`act` inputs, accounts, logs) | ✕ | ✕ | ✕ | ✕ |

## Leakage audit — hiding the role field is not enough

| Leak | Fix |
|---|---|
| Role stored in an account | World has zero readers |
| Positions (who was near the body) | Only in World; Views are derived inside the TEE |
| Kills | A body appears only in Views that can see it; the Room learns of deaths only at a meeting |
| Per-player task counts (the Mole never completes any) | Room shows only the crew-wide bar |
| Instruction type (`cuff` vs `move`) | **One** `act(input, seq)` instruction for move / work / cuff / report / emergency |
| Input timing (the Mole goes quiet, then strikes) | The client sends `act` at a constant 10 Hz, no-ops included |
| Transaction bodies (`act`'s input byte carries the cuff bit) | The TEE RPC answers `getTransaction` with a redacted shell (signature, slot, time; 0 accounts, 0 instructions, 0 logs) for everyone, signer included, and `getSignaturesForAddress` on the World or a View lists nothing. Checked live by `e2e.ts` and the in-game 🕵 console |
| The VRF oracle knows the randomness | Roles = SHA-256(VRF ‖ all sealed salts ‖ room ‖ heist), computed in the TEE |
| Logs | The program never logs game state |
| Vote order / bandwagoning | Ballots sealed in the World, published together at the tally |

## What keeps it fair

- **Unsteerable deal:** each player's 32-byte salt is written straight into the sealed World at `join` (and refreshed every heist); the oracle never sees the salts, players never see the VRF output in time.
- **Verifiable afterwards:** at lights-on the client recomputes `seed = SHA-256("inside-job/deal/v1" ‖ vrf ‖ salts ‖ room_id ‖ match_no)` and replays the program's exact shuffle (splitmix64 + rejection sampling + Fisher-Yates) in the browser.
- **Oracle down?** After ~6 s any seated player may deal from rollup state (still salted) — flagged `fallback` in the UI.
- **Liveness:** if the crank ever stalls, any seated client may call `tick` — slot-gated on chain, so it can't speed the game up.
- **Deterministic rules, tested:** `programs/inside-job/src/sim.rs` is pure functions with unit tests (deal distribution, walls, per-room vision, cuffs + witnesses, meetings, ties, ghosts, a 40-game bot balance run).

## Repo

```
programs/inside-job/
  src/lib.rs         instructions + account contexts
  src/sim.rs         the game rules (pure, unit-tested)
  src/money.rs       payout rules (pure, conservation-tested)
  src/magic.rs       hand-encoded commit + Magic Action intent (tested against the SDK)
  src/state.rs       zero-copy Room / World / View layouts
  src/map.txt        the map — read by the program (build.rs) AND the web client
  src/stations.txt   task stations — same
  build.rs           compiles the map + BFS flow fields for the bots
app/
  src/chain/         client: session key, TEE auth, instructions, decoders, verification
  src/game/          canvas renderer, map rules mirror (prediction + fog)
  src/ui/            lobby, heist, meeting, verdict, lights-on, try-to-cheat, chain log
  scripts/           setup-rooms.ts (provision devnet), e2e.ts (live TEE test), e2e-stake.ts (money path)
scripts/             WSL build / test / deploy helpers
```

## Run it

```bash
# program (WSL / Linux): Rust 1.89, Solana CLI 3.1.x, Anchor 1.0.x
bash scripts/test.sh          # unit tests
bash scripts/build.sh         # SBF + IDL (copied to app/src/idl)
bash scripts/deploy.sh        # devnet

# client
cd app && npm install
npx tsx scripts/setup-rooms.ts           # free crews 11-14 + staked tables 21:0.01 22:0.01
npm run dev
npx tsx scripts/e2e.ts 14                # full heist against the live devnet TEE
npx tsx scripts/e2e-stake.ts 21          # two wallets stake, play, Magic Action pays out
```

## Honest limits

- **The TEE is the trust anchor.** Privacy rests on MagicBlock's Intel TDX validator and its permission checks; the client verifies the enclave's attestation (`verifyTeeRpcIntegrity`) but the program can't prove privacy by itself.
- **Devnet only.** Staked tables use devnet SOL, not USDC. The spectator "Tip Line" market is next on the roadmap.
- **Who sat where is public** on staked tables (the Pot lists wallets, the Room lists seats); roles stay sealed until lights-on.
- Players talking over voice can always collude; that's true of every online social-deduction game.
