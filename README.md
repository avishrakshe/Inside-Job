# INSIDE JOB

**A real-time heist of social deduction where nobody can know the Mole — not the players, not the chain, not even the randomness oracle.**

Built for **MagicBlock Solana Blitz v10 — Entertainment Finance**. Every move, cuff and sealed vote is a gasless Solana transaction inside a **MagicBlock Private Ephemeral Rollup** (Intel TDX). A crank ticks the game every 100 ms inside the enclave. There is no game server.

| | |
|---|---|
| Play | **https://inside-job-six.vercel.app** (free tables: no wallet needed) |
| Program (devnet) | `9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U` |
| Rollup | MagicBlock TEE devnet — `devnet-tee.magicblock.app`, validator `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` |
| Live proof | checks against the live devnet TEE — [docs/E2E_DEVNET.md](docs/E2E_DEVNET.md) |
| Free tables (delegated to the TEE) | crews 31–34 |
| Staked tables | tables 41–42 · 1 devnet USDC a seat · winners split the Pot, paid by a Magic Action |
| Tip Line | spectators stake devnet USDC on who the Mole is; resolved on Solana from the sealed result |

## Why it can't exist on plain Solana

On a public chain every account is readable. A hidden-role game there is over before it starts: the Mole is one `getAccountInfo` away, and so is everyone's position — which is just as revealing (*who was standing next to the body?*). INSIDE JOB keeps **roles, true positions, bodies, ballots and salts** in a `World` account whose permission has **zero members**. Each seat can read only its own `View`: what its light reveals, computed inside the TEE every tick.

## The game

A crew of robbers cracks a vault in real time. One of them (two at 7–8 players) is an undercover **Mole**.

- **Crew** — finish your three stations (hold `E`). When the vault bar fills, the crew wins.
- **Mole** — cuff the crew when nobody's looking (`Q`), fake your tasks, survive the vote.
- **Report** a body (`R`) or hit the **emergency button** in the lobby (`F`) → meeting. Chat is on-chain and only open during meetings. **Ballots are sealed** in the World and published all at once at the tally.
- **Lights on** — when the game ends, World and every View flip public: anyone can replay the whole deal and check every role.
- Empty seats are filled by **on-chain bots** that obey the same fog of war.

## Trust the enclave for secrets, not for the result

A TEE keeps the Mole hidden *during* the heist. It should not also be the judge. So nothing
it decides has to be taken on faith:

1. **Deal commitment, on Solana before play.** At the deal the Room stores
   `H("inside-job/commit/v1" ‖ seed ‖ room ‖ heist)`, and `commit_deal` pushes that Room to
   Solana while the seed is still sealed. The roles can't be re-dealt mid-game.
2. **A move log with a hash chain.** Every tick, `replaylog.rs` records everything the rules
   take from outside — each human's input, each ballot, the clock — into a sealed log
   account, and folds it into a SHA-256 chain the Room carries. Bots aren't logged: they're
   part of the rules.
3. **Every result is committed.** At lights-on every heist's final Room — winner, roles, deal
   commitment, log hash — is committed to Solana (free tables too).
4. **The browser replays the heist.** `tools/replay` compiles the program's *own*
   `state.rs` + `sim.rs` + `replaylog.rs` to WebAssembly (75 KB). At lights-on the client
   replays every step from the deal and checks: same World byte-for-byte, same winner,
   seed matches the commitment, log matches the hash Solana holds.

Why not a ZK proof? A 10 Hz real-time game is thousands of steps of simulation per heist;
proving that fast enough to matter isn't practical today. And once lights-on makes
everything public, a deterministic replay gives anyone the same guarantee a validity proof
would — the outcome follows from the committed inputs — without a trusted setup. Tests:
16 random heists (humans mashing inputs, meetings, ballots, a 70-minute clock jump) replay
exactly; a doctored move, seed, role or winner is always caught.

What the TEE is still trusted for: keeping roles, positions and inputs secret until
lights-on, and not inventing inputs for a human (the log binds the result to *some* input
sequence; the inputs themselves were private while the game ran).

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
| **Magic Actions** | Staked tables: right after lights-on, `commit_result` commits the Room to Solana and schedules `settle` there in the same intent, so lights-on *is* the payout. |
| **Commits** | The committed Room is the only thing Solana learns about a heist: who won and who held which role, after lights-on. |

## Tip Line: a prediction market with no oracle

Spectators stake devnet USDC on **who the Mole is**. The stake goes into a `Market` PDA's
token account on Solana (`buy_tip`, max 5 USDC, one entry per wallet per heist). The *call*
is made inside the rollup (`pick`, signed by the session key the tip named): it lands in the
public Room with a weight = heist time left, so calling it early pays more; re-calling
resets the weight. Seated players (session or wallet) are refused, dead seats can't be picked,
and calls close when the heist ends. At lights-on the commit carries a Magic Action,
`record_tips`, that copies every call plus the published roles into the Market. Right
calls get their stake back plus a share of the wrong calls' stakes, in proportion to
stake × weight; if nobody called a Mole, everyone is refunded; no house cut
(`money::tip_payouts`, conservation-tested). Payouts are claimed with `claim_tip`
(permissionless, and only in the room's own mint). If the heist never resolves, `record_tips` refunds everyone after 20 min (counted from the heist's start while it's running).

## Staked tables: a pot that pays itself out

1. **Ticket (Solana).** `buy_ticket` moves the table's stake (devnet USDC) from your wallet's token account into that heist's `Pot` (its token account) and names the in-browser **session key** that may use the ticket. The Pot is plain base-layer state; the money never leaves Solana.
2. **Seat (TEE rollup).** `join` reads the Pot from Solana inside the rollup and seats only the session key the ticket named. A different key with the same wallet is refused.
3. **Lights on → payout.** `finish` flips the World public. Then `commit_result` (permissionless, once per heist) commits the Room to Solana and attaches a post-commit **Magic Action** that runs `settle` there. `settle` reads the *committed* Room (winner + published roles) and pays the winning humans from the Pot. **No oracle, no admin:** the result was sealed program state all along. The commit is a separate step on purpose: the rollup caps plain commits per delegation, and a refused commit must never strand a room mid-reveal.
4. **Failure paths.** `settle` is permissionless and idempotent, so if the action never lands anyone can run the same payout from the committed Room. If a pot is still open after 20 minutes (crank died, nobody started), **anyone can refund every ticket**. Refund, never re-roll. A refund can't cut a heist short: if Solana's copy of the Room shows the heist running, the 20 minutes count from its start, and once it shows a result the pot must be settled instead.

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

- **The TEE is the trust anchor for privacy, not for the result.** Secrecy during the game rests on MagicBlock's Intel TDX validator and its permission checks (the client verifies the enclave's attestation with `verifyTeeRpcIntegrity`). The outcome is re-derived in the browser from the committed deal and the move log (see above).
- **Devnet only.** Stakes and tips are devnet USDC (Circle's faucet). Mainnet would need real-money compliance work first.
- **Insiders.** A player can't tip on their own crew from their seat's keys, but nothing stops a second wallet; tips are capped at 5 USDC.
- **Who sat where is public** on staked tables (the Pot lists wallets, the Room lists seats); roles stay sealed until lights-on.
- Players talking over voice can always collude; that's true of every online social-deduction game.
