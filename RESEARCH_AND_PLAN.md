# INSIDE JOB: Winners Teardown, Refined Concept & Build Plan (v2)
### Original real-time social-deduction game for MagicBlock **Solana Blitz v10: Entertainment Finance**

> Working title **INSIDE JOB**. This is an original heist-themed game in the social-deduction *genre*. Don't use the "Among Us" name, characters, ship maps or art (that is someone else's IP), and judges score creativity.
>
> **What changed from v1:**
> 1. I read the repos of the winners and of the closest competitors.
> 2. v1 claimed "first game where the secret is the asset". That was **wrong**. SINBAZAAR (Blitz v8) already built a market whose traded asset is a secret, and Shadow Mafia (Blitz v2) already built a staked mafia game. The pitch is re-anchored below.
> 3. Scope is cut and re-ordered around what demonstrably wins.

---

## 0. TL;DR

| | |
|---|---|
| **Dates (from MagicBlock's own events API)** | Kickoff **Fri 20 Nov 2026 14:00 UTC**. Submission closes **Fri 27 Nov 2026 14:00 UTC** |
| **Official judging** | *"Creativity, technical depth, and how compellingly they showcase what's possible on Solana."* Eligibility: must integrate ER or VRF. *"The top prize rewards the strongest overall build."* |
| **Hidden scoring signals** | MagicBlock's internal tool (`jonasXchen/github-scrapper`) scans repos for SDK usage, **counts on-chain transactions that touch the Delegation, ACL (permissions), VRF and Ephemeral SPL programs** on devnet and mainnet, and measures **commits and active days**. The builder directory sorts by "integration · commits · activeDays" |
| **What wins** | One fun loop × several primitives that each *do a job* × visible proof (a cheat console, verify tab, live tx panel) × real money flow with refunds × tests × polish × playable without a wallet |
| **Refined pitch** | *"Real-time social deduction where nobody can know the Mole: not the players, not spectators, not us, not even the randomness oracle. The crowd can bet on it, and the bet resolves with **no oracle**, because the answer is already on-chain, sealed in the enclave."* |

---

## 1. Winners teardown: how they work and why they won

### Tenor: 🏆 Blitz v7 1st (private multi-dealer FX RFQ)
- **How it works:** five dealer bots quote USD/INR blind inside a PER. The match commits through **Magic Actions**, then USDC moves and a `FillRecord` lands on Explorer. Losing quotes are never written anywhere. A cross-dealer read fails with custom error **6013 `CrossReadDenied`**. It uses a live Pyth USD/INR feed.
- **Structure:** `programs/` · `app/` (Next.js, with a `/demo` cockpit page plus `/trade`, `/dealer`, `/spectator`, `/race`) · `bots/` · `crank/` · `tests/` organised **by day** (`test:day2 … test:day7`, "20 clean runs").
- **Why it won:** privacy has an *economic reason*: blind quotes compress spreads. The `/demo` page has an **Attack console** that triggers the denial live. It measured latency (p50 7.2 s). One clean narrative line: *"Compete blind. Settle atomic. Win on price."*

### BLACKOUT: 🥈 Blitz v9 2nd (fog-of-war battle royale, **on mainnet since 14 Nov**)
- **How it works:** a TEE-sealed `World` (zero readers) and 8 `View`s (one reader each). A crank `tick` runs every 50 ms (sim, then vision per seat). VRF seeds spawns, loot and zones. `finish` flips the World public and commits; a `settle` Magic Action pays the pot and writes the leaderboard. Session keys sign about 20 inputs/s.
- **Structure:** `programs/blackout/src/{instructions,sim}` (a deterministic sim with **44 Rust tests** and a golden fingerprint) · `app/src/{chain,game,scene,ui}` · a **TypeScript mirror of the Rust sim**, verified bit-for-bit (`scripts/mirror.ts`, 2,000 steps) · e2e scripts against the live TEE · Playwright UI tests · `Audit.md` · `AI_USAGE.md` (built with Claude Code).
- **Why it won:**
  - A README table headed **"Take any one of these out and the game stops working"**, covering 8 primitives.
  - A **"Who can read what"** permission matrix.
  - An in-app **"Try to cheat"** button that asks the TEE for sealed accounts and shows the denial.
  - A **VERIFY** tab and replay.
  - **Guest play: free, gasless, no wallet.** Bots fill empty seats.
  - Huge polish: 3D, mocap, sound, phone controls.
  - A real economy: staked tables, a house fee and a daily challenge.

### UltraPong: Blitz v8 winner (8-player survival pong)
- **How it works:** a **shared Rust physics crate** runs on-chain at 20 Hz scheduled ticks *and* in the browser as WASM (for warm-up mode). Clients send paddle targets only. Settlement is verified on-chain.
- **Why it won:**
  - A **"Live network activity" panel** listing real input, tick and settlement signatures.
  - Full recovery paths: lobby expiry, a 20 s disconnect forfeit, draws refund, and a 15-minute base-layer refund deadline.
  - LiteSVM tests that include **measured compute units (189,683 CU worst-case tick)**.
  - An 8-wallet live run (1,330 inputs, 78 ms p95).
  - Warm-up with 7 bots and no wallet.

### BlitzMine: Blitz v7 winner (shared 5×5 mining board, 60 s rounds)
- **Why it won:** a dead-simple social loop (everyone on one board). A rigorous **"What keeps it fair"** list:
  - an expected nonce per deploy;
  - rejection sampling rather than modulo;
  - VRF is requested only after the deadline;
  - on VRF timeout the round **refunds, never rerolls**;
  - a property test that **settlement conserves every lamport**.
- It also has a one-command full local cycle (`cycle:local`) and a Magic Router–aware backend crank.

### Hunch (v6 3rd) and Samrajya / HoldOut (priyanshudotsol, 3-time winner)
- Mobile-native (Expo, with Privy social login). A risk-managed payout cap. Settlement by a backend crank.
- Samrajya adds a **state-location pill**: *Solana lobby → ER war → Solana settlement*, with a link for every tx.
- Everything is **permissionless** (anyone can start, ring the bell, claim for someone, or open the next war).

### VeilMarket: v6 Wizardio's Choice (private World Cup prediction markets)
- ER, PER and VRF are **all wired into the real UI** through a "MagicBlock panel" on each market.
- Its rule was **"No fabricated data anywhere in the UI."** A swipeable PWA.
- Weakness it admitted: resolution is manual or a VRF coin flip. **The oracle problem was unsolved.**

### CapturGO: v6 1st (GPS rewards, private claims)
- An existing live product with a partner. Integration-proof **tx links at the top of the README**.
- It **found and reported a MagicBlock devnet bug** (an Ephemeral SPL instruction #34), with a working fallback route.

### What *didn't* place, and why (inferred)
| Project | What it had | Likely why it didn't win |
|---|---|---|
| **SINBAZAAR** (v8) | Superb depth: 35 instructions, `prove-privacy.ts` passing against the real devnet TEE, a secret-as-asset market | Dark and abstract premise (confessions, "blackmail escrow"). **22 of 25 rooms disabled.** Not fun to *play*; needs a "FICTION MODE" banner |
| **Shadow Mafia** (v2) | Staked mafia, session keys, sealed votes | **No TEE** (it never got a token), so roles were readable. Blockhash randomness, not VRF. Turn-based. A server triggers tallies and relays chat over Socket.io |
| **Bluff** (v9) | Liar's dice in PER, AI bot archetypes, vault payouts | A solid but familiar card/dice format, beside teexas poker in the same edition |

### Patterns to copy (all ten appear in 2+ winners)
1. A one-line **economic or experiential reason** privacy/speed is needed (Tenor: spreads; BLACKOUT: a wallhack is one RPC call).
2. **"Take one away and it breaks"**: every primitive has a job.
3. **Proof as a feature in the UI**: an attack/cheat console, a verify tab, a live tx panel.
4. **Playable instantly**: a guest mode, no wallet, bots fill seats.
5. **Money paths with failure handling**: timeouts → refunds, never rerolls; conservation tests.
6. **A deterministic sim** shared or mirrored between chain and client for prediction.
7. **Tests and e2e scripts against the live devnet TEE**, with measured numbers.
8. **README structure**: tx links first → primitive table → permission matrix → architecture diagram → "what keeps it fair" → honest limits.
9. **Real on-chain activity** on devnet (or mainnet) during the week, which MagicBlock's scraper counts.
10. **Polish and sound.** A fun loop beats more features (compare SINBAZAAR's 22 disabled rooms).

---

## 2. The competitive map for our idea

| Already done | By | Our difference |
|---|---|---|
| Hidden roles + staked pot | Shadow Mafia (v2) | Real-time **spatial** play (movement, fog, kills in the dark). A truly sealed TEE and VRF |
| Sealed world + fog of war + crank + Magic Action payout | BLACKOUT (v9 🥈) | Social deduction (lying, meetings, votes), not aim. 2D readable top-down, not 3D shooter |
| Sealed answers in a party game | Herd (v8) | Continuous real-time play plus a spectator economy |
| Secret as a traded asset | SINBAZAAR (v8) | The secret is a *live game state* that resolves itself; fun, not dark |
| Private prediction market | VeilMarket (v6) | **No oracle and no admin**: the truth already sits sealed in program state |

**The real gap:** nobody has combined **real-time spatial social deduction** with a **self-resolving spectator market**. The specific technical novelty is that **prediction markets' hardest problem (resolution/oracles) disappears** when the outcome is sealed program state. VeilMarket and SINBAZAAR both listed resolution trust as a limitation. Ours doesn't have it.

---

## 3. Refined concept: INSIDE JOB

**Setting:** a crew of robbers inside a bank vault (lobby, security room, server room, laser hall, deposit boxes, sewer exit). The **Mole** is an undercover informant.

**Players:** 4–8 seats. Empty seats are **on-chain bots** that obey the same fog. 1 Mole for 4–6 players, 2 for 7–8.

**Loop (one match ≈ 4–6 min)**
1. **Lobby.** Pick a table: free (guest, no wallet) or staked (1 USDC). One wallet signature, which carries the session key in the same tx.
2. **Deal.** VRF output is mixed with each player's sealed salt inside the TEE. That determines roles, spawns and tasks.
3. **Heist (real time).** Move. Do tasks (2–6 s hold-to-complete at stations). The Mole can **cuff** someone in range (cooldown) and **trip an alarm** (a crew-wide timer fixed at 2 stations). You see only what is in your room or vision radius. Bodies are invisible until someone sees them.
4. **Meeting** (report or button, 60 s). Public chat (quick-chat plus short text, on-chain). **Sealed ballots** flip public together. Top vote is ejected. **The Tip Line betting window is open during the meeting.**
5. **End.** Crew wins on all tasks or all Moles ejected. Moles win on parity or an alarm timeout. Then **lights on**: the World flips public, the replay and VERIFY tab unlock, and the Magic Action settles everything.

**Ghosts:** the dead get a ghost chat that only the dead can read (the member list grows on each death) and can still finish tasks.

---

## 4. The money (Entertainment Finance, three layers)

1. **The Score (players).** Stake `S` USDC each. **Crew win:** 70% split equally among all crew, 30% by task contribution. **Mole win:** Moles split. Rake 0% in the hackathon.
   *Fairness:* roles come from VRF, so every seat has the same expected value, `S(1−rake)`, before skill. It's a skill game, like Slimecoin.
2. **The Tip Line (spectators).** A parimutuel pool per seat colour, on *"X is the Mole"*. Each bet is a **private ephemeral account** (only the bettor can read it, the SINBAZAAR and sealed-auction pattern). Aggregate odds publish when each meeting closes. **Resolution reads the sealed `World.roles` directly: no oracle, no admin, no vote.**
3. **The Deception Bonus.** The market fee (5%) pays the Mole `fee × (1 − p_final)` if the Mole wins, where `p_final` is the crowd's final implied probability. If the crew wins, it goes to crew who voted correctly. Fooling the crowd pays.

**Safety rails (say these before a judge asks):**
- Seated wallets and session keys are rejected from betting on their own room. The program knows the seat map inside the TEE.
- Per-wallet and per-market caps (market ≤ player pot in the MVP) limit how much a sybil wallet can extract.
- Devnet with test USDC only. Skill framing.

---

## 5. Primitive table: take one away and it breaks

| Primitive | Job |
|---|---|
| **Private ER (TEE)** | Holds roles, true positions, bodies, cooldowns and the seat map. Without it, a wallhack and role-reveal are one RPC call |
| **Ephemeral permissions** (ACL program) | `World` 0 readers · `View[i]` seat *i* only · `MoleChannel` moles · `GhostChannel` **grows on each death** · `Ballot`/`Bet` owner-only until tally · `finish` flips all public |
| **Ephemeral accounts** | World, Views, ballots, bets and channels exist only in the rollup, with rent sponsored by the Room PDA |
| **VRF** (ephemeral queue) | Seeds the deal, spawns and bot personalities. Mixed with player salts so the **oracle operator can't learn roles** |
| **Crank** | `tick` every 100 ms: movement, vision, cooldowns, alarm and meeting timers, bot brains, auto-tally |
| **Session keys** | One signature, then ~10 inputs/s gasless. Scoped to `act/chat/vote/bet`; **cannot move funds** |
| **Magic Actions** | `finish` performs commit + `settle`: pays the pot, the Tip Line and the Deception Bonus in one flow |
| **Ephemeral SPL Token** (USDC) | Stakes and bets held in Room-owned eATAs inside the ER. **Fallback:** a base-layer vault with a Magic Action payout (Tenor's pattern) |
| **Magic Router** | One client endpoint |
| **TEE attestation** | A "Enclave verified ✓" badge before you stake |

Using Delegation, ACL, VRF *and* Ephemeral SPL means all four of the programs MagicBlock's integration checker counts show up in our transactions.

---

## 6. Architecture

### 6.1 Who can read what
| Account | You | Other players | Spectators / RPC | After lights-on |
|---|:-:|:-:|:-:|:-:|
| `Room`: phase, timers, alive bitmap, **global** task bar, chat, revealed votes, published odds | ✓ | ✓ | ✓ | ✓ |
| `View[i]`: your role, tasks, what you can see (Mole: partner, cooldowns) | ✓ | ✕ | ✕ | ✓ |
| `World`: roles, salts, true positions, bodies, seat map | ✕ | ✕ | ✕ | ✓ |
| `MoleChannel` / `GhostChannel` | if member | if member | ✕ | ✓ |
| `Ballot[i]`, `Bet[j]` | owner | ✕ | ✕ | ✓ |
| Base: `Vault`/eATA, `Ticket`, leaderboard | ✓ | ✓ | ✓ | ✓ |

### 6.2 Instructions
- **Base layer:** `init_room` · `buy_ticket` (stake, session key, sealed-salt commitment) · `delegate_room` (pinned to the TEE validator).
- **Setup in the ER:** `init_permissions` (refuses unless every secret account is sealed) · `start_match` → VRF → `deal_callback`.
- **Play:** **`act(packed)`**, one uniform instruction for move/task/cuff/sabotage/report/fix/no-op · `tick` (crank) · `chat` · `vote` · `tally` (crank) · `bet` (spectators).
- **End:** `finish` (flip public → commit + Magic Action `settle`) · `refund_timeout` (permissionless, base layer) · `reset`.

### 6.3 Leakage audit (technical depth; put it in the README)
| Leak | Fix |
|---|---|
| Role in state | `World` has 0 readers |
| Positions (who was near the body) | Only in `World`; each `View` is derived in the TEE |
| Kill visible | A body appears only in Views that see it |
| Per-player task counts (Moles never complete tasks) | Room shows only the global bar |
| Instruction type (`kill` vs `move`) | One `act` instruction with a fixed-size payload |
| Input timing | The client sends at a constant 10 Hz, including no-ops |
| Logs | Never `msg!` secrets |
| **VRF oracle sees the randomness** | Roles = H(vrf ‖ player salts ‖ slot hash), computed in the TEE |
| Mid-game commits | Disabled until `finish` |
| Mole UI in the client bundle | Rendered only from fields present in your View |

### 6.4 Real-time model (copying BLACKOUT and UltraPong)
- A **deterministic sim crate** (`sim/`: movement, collision against a tile grid, room-based vision, tasks, cooldowns) is used by the program **and** compiled to WASM for client prediction. That's UltraPong's approach, simpler than maintaining a separate TypeScript mirror.
- The crank ticks at 100 ms. The client renders with an 80–100 ms snapshot buffer.
- **Measure CU per tick on day 2.** The target is under 200k for 8 seats plus bots. UltraPong's worst case was 190k.

### 6.5 Failure paths (copying BlitzMine and UltraPong)
- VRF timeout (30 s) → **refund, never reroll**.
- Disconnect for 20 s → your character idles. If you're the Mole, a cuff is impossible while idle.
- Abandoned match, or no `finish` within 15 min → a permissionless base-layer **refund**.
- Duplicate settle is blocked. A **conservation property test** asserts every USDC unit is accounted for.

---

## 7. Proof features judges can click (copied from winners)
1. **"Try to cheat" console**: buttons that request `World`, an opponent's `View` and someone's `Ballot` from the TEE and show the denial (BLACKOUT, Tenor).
2. **VERIFY tab** after lights-on: re-derives roles, spawns and tasks from VRF + salts in the browser (BLACKOUT).
3. **Live chain panel**: the state-location pill (Solana → TEE ER → Solana) plus the latest 200 signatures with explorer links (Samrajya, UltraPong).
4. **"Enclave verified" badge** via `verifyTeeRpcIntegrity` (teexas).
5. **`scripts/prove-privacy.ts`** output pasted into the README, with PASS lines against the real devnet TEE (SINBAZAAR).

---

## 8. Scope: what's in, what's cut

**MVP (must ship):** sealed world + roles + fog · VRF deal with salts · crank tick · tasks, cuff, report, meeting, sealed vote, eject, win · ghost channel · bots · guest free mode · USDC staked mode with Magic Action settle and refunds · Try-to-cheat · Verify · live chain panel · README.

**Ship if day 5 is green:** Tip Line + Deception Bonus + spectator page.

**Cut from v1:**
- the anonymous-seat VRF queue;
- LLM agent players;
- SOAR;
- line-of-sight raycasting (room-based vision is enough);
- the eATA private-balance payouts beyond the basic stake.

**Art direction:** 2D top-down (PixiJS or Phaser 3), a chunky original heist style with dark rooms lit by vision. Sound matters: footsteps, alarm, cuff click, vault crack. Phone layout with a touch joystick (PWA).

---

## 9. Day-by-day plan (deadline 27 Nov 14:00 UTC; submit by 12:00)

| When | Deliverable | Gate |
|---|---|---|
| **Wed 18 – Thu 19 (prep)** | Toolchain (Solana 3.1.9, Rust 1.89, Anchor 1.0.2, Node 24). Run `private-counter`, `sealed-auction`, `roll-dice`, `rewards-delegated-vrf`, `crank-counter`, `magic-actions`, `spl-tokens` from `magicblock-engine-examples` on devnet. Get a TEE token. `npx skills add https://github.com/magicblock-labs/magicblock-dev-skill`. Builder profile + Telegram. Art and sound picks. **Don't write game code yet** | All examples green on devnet |
| **Fri 20 (D1, from 14:00 UTC)** | Repo, program skeleton (Room/World/View/Ballot), permissions, delegation to the TEE. `prove-privacy.ts` | **Stranger reads World/View → denied** on the devnet TEE |
| **Sat 21 (D2)** | VRF + salt deal · sim crate (move, collide, room vision) · crank tick · Pixi client with WASM prediction · guest burner keys | Two browsers see different fog. CU per tick measured |
| **Sun 22 (D3)** | Tasks, cuff, bodies, report, meeting, chat, sealed ballots, eject, win conditions, ghost channel | Full match to a win state with 4 humans |
| **Mon 23 (D4)** | Bots in the tick · USDC stakes (eSPL; **fall back to a base vault by 18:00 UTC if blocked**) · `finish` + Magic Action `settle` · refunds · conservation test | **MVP cut line**: staked match pays correctly both ways |
| **Tue 24 (D5)** | Tip Line + Deception Bonus + spectator page | A spectator wallet wins or loses correctly; seated wallet rejected |
| **Wed 25 (D6)** | Try-to-cheat, Verify, live chain panel, attestation badge · mobile controls · sound · Vercel deploy · e2e scripts | A judge can play solo vs bots in under 30 s |
| **Thu 26 (D7)** | Playtests with real people (Telegram builders group), bug fixes, 3-min video, README | Video recorded |
| **Fri 27 (by 12:00 UTC)** | Submit, with a 2-hour buffer | — |

**Every day:** commit often (MagicBlock measures active days) and leave a bot match running on devnet, so the ACL, VRF, Delegation and eSPL transaction counts are real.

---

## 10. Three-minute demo script
1. **0:00.** *"On a public chain a secret role is one RPC call away."* Click **Try to cheat** → denied. Show the "Enclave verified ✓" badge.
2. **0:20.** Guest match: 1 human, 5 bots, instant start. Fog: you see only your room.
3. **0:45.** Staked table: 4 wallets × 1 USDC. The live chain panel scrolls with ER signatures.
4. **1:10.** The Mole cuffs someone in a dark room; the other screens show nothing. A body is found and the meeting opens. The spectator places a Tip Line bet; odds publish when the window closes.
5. **1:50.** Sealed votes flip together. The wrong person is ejected. The ghost chat lights up for them only.
6. **2:20.** Mole wins → lights on. VERIFY re-derives the deal from VRF + salts. The Magic Action pays the pot and the Deception Bonus: *"the crowd gave Red 9%, so Red earns 91% of the fee pool."* The market resolved with **no oracle**.
7. **2:50.** *"Nobody could know the Mole, not even us. That's what Solana with MagicBlock makes possible."*

---

## 11. README skeleton (the winners' order)
1. Banner + play link + program ID + **integration tx links**.
2. One-paragraph pitch: why it's impossible on plain Solana.
3. "Take one away and it breaks" primitive table.
4. "Who can read what" matrix.
5. Architecture mermaid + one-tick sequence diagram.
6. Leakage audit.
7. "What keeps it fair" (VRF + salts, refunds-not-rerolls, conservation test, session-key scope).
8. Verified on devnet: e2e outputs, `prove-privacy` PASS lines, CU and latency numbers.
9. Repo map · Run it · Honest limits · AI usage.

---

## 12. Risks
- **TEE or eSPL devnet instability.** CapturGO hit an eSPL bug. Keep the base-vault fallback ready and check `https://status.magicblock.app/api/services`.
- **ER caches old program bytecode** after a redeploy (from SINBAZAAR), which surfaces as account-list errors. Restart the local stack and re-delegate.
- **Fees:** 0.003 SOL per delegation session and 0.001 SOL per commit after the first. Pre-fund the Room PDA.
- **Docs contradiction** about an empty member list with `is_private=false`. SINBAZAAR and BLACKOUT behaviour suggests `is_private=true` with no members means sealed. Verify on day 1.
- **Scope.** If you're behind at the end of day 4, drop the Tip Line and polish the core. A fun, sealed, staked game with proof UX is already competitive.
- **Regulatory.** Real-money and market features stay on devnet with test USDC.

---

## 13. Sources
- Events and judging (MagicBlock API): https://build.magicblock.app/api/events · https://build.magicblock.app/api/panels
- MagicBlock evaluation tooling: https://github.com/jonasXchen/github-scrapper
- Winners: https://github.com/Shaurya2k06/tenor · https://github.com/Anshv784/blackout · https://github.com/X2C-fun/UltraPong · https://github.com/Monti-27/BlitzMine · https://github.com/priyanshudotsol/Hunch-magicblock · https://github.com/priyanshudotsol/Samrajya · https://github.com/usainbluntmx/veilmarket · https://github.com/CapturGo/capturgo-magicblock · https://github.com/Magicianhax/ghost-stops · https://github.com/ajeeshRS/privRoll
- Competitors: https://github.com/nickthelegend/sinbazaar · https://github.com/Ultr0nX/shadow-mafia · https://github.com/toufiqfarhan0/bluff-liar-dice · https://github.com/Abhist17/teexas · https://github.com/codeswithroh/nightfall
- Recaps: https://www.magicblock.xyz/blog/august2026-recap · https://www.magicblock.xyz/blog/september2026-recap · https://www.magicblock.xyz/blog/entertainment-finance-on-magicblock · https://solanacompass.com/news/magicblock-solana-blitz-v6-41-mobile-apps-three-winners-one-weekend
- Docs: https://docs.magicblock.gg/llms.txt (PER access control, VRF, cranks, Magic Actions, Ephemeral SPL, runtime limits, session keys)
