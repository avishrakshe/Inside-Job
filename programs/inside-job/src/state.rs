//! Account layouts. All three are fixed-size, zero-copy (`repr(C)`, no padding), so the
//! TypeScript client decodes them by offset and a tick never pays for (de)serialisation.
//!
//! * `Room`  — public lobby + scoreboard. Delegated PDA (lives on Solana between sessions).
//! * `World` — the sealed truth: roles, true positions, bodies, votes, salts.
//!             An ephemeral account whose permission has ZERO members: nobody can read it.
//! * `View`  — what one seat is allowed to know this tick. Readable only by that seat's keys.
//! * `MoveLog` — the heist's input log (header + records), sealed until lights-on.
//!
//! With the `replay` feature (tools/replay compiles this same file to WebAssembly) the
//! zero-copy structs are plain `repr(C)` Pod types and the Anchor-only accounts drop out.
#[cfg(not(feature = "replay"))]
use anchor_lang::prelude::*;
#[cfg(feature = "replay")]
use crate::shim::Pubkey;

pub const MAXP: usize = 8;
pub const NO_SEAT: u8 = 255;
pub const VOTE_SKIP: u8 = 254;
pub const VOTE_NONE: u8 = 255;

pub const ROOM_SEED: &[u8] = b"room";
pub const WORLD_SEED: &[u8] = b"world";
pub const VIEW_SEED: &[u8] = b"view";

// phases
pub const PH_LOBBY: u8 = 0;
pub const PH_STARTING: u8 = 1; // waiting for the VRF deal
pub const PH_PLAY: u8 = 2;
pub const PH_MEETING: u8 = 3;
pub const PH_RESULT: u8 = 4; // ejection shown
pub const PH_ENDED: u8 = 5; // winner decided, still sealed
pub const PH_REVEALED: u8 = 6; // lights on: World + Views public

pub const ROLE_CREW: u8 = 0;
pub const ROLE_MOLE: u8 = 1;
pub const ROLE_UNKNOWN: u8 = 255;

pub const TEAM_CREW: u8 = 0;
pub const TEAM_MOLE: u8 = 1;

/// ready_mask: bit 0 = World + Room permission, bits 8..15 = View[seat]
pub const READY_CORE: u32 = 1;
pub const READY_ALL: u32 = 1 | (0xff << 8);

pub const CHAT_SLOTS: usize = 16;
pub const CHAT_LEN: usize = 48;
pub const NAME_LEN: usize = 12;
pub const TASKS_PER: usize = 3;

pub const MAX_TIPS: usize = 16;
pub const NO_PICK: u8 = 255;

#[cfg_attr(not(feature = "replay"), account(zero_copy))]
#[cfg_attr(feature = "replay", derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable), repr(C))]
pub struct Room {
    // 8-byte fields
    pub room_id: u64,
    pub last_tick_slot: u64,
    pub start_slot: u64,
    /// unix seconds: end of the current meeting / result screen
    pub phase_end: i64,
    pub task_id: i64,
    // keys
    pub authority: Pubkey,
    pub host: Pubkey,
    /// the in-browser session key of each seat (signs every gameplay tx)
    pub players: [Pubkey; MAXP],
    /// the wallet each seat plays for (payouts in staked mode)
    pub wallets: [Pubkey; MAXP],
    // 4-byte fields
    pub match_no: u32,
    pub tick: u32,
    pub task_total: u32,
    pub task_done: u32,
    pub chat_count: u32,
    pub ready_mask: u32,
    /// unix seconds each seat last acted (lobby presence)
    pub last_seen: [u32; MAXP],
    // 1-byte fields
    pub phase: u8,
    pub n_moles: u8,
    pub max_players: u8,
    pub bump: u8,
    pub caller: u8,
    pub reported: u8,
    pub ejected: u8,
    pub ejected_role: u8,
    pub winner: u8,
    /// 0 = not dealt, 1 = VRF, 2 = fallback (not VRF-grade, flagged in the UI)
    pub seed_state: u8,
    pub voted_mask: u8,
    pub n_humans: u8,
    pub staked: u8,
    pub _pad: [u8; 3],
    pub is_bot: [u8; MAXP],
    /// public life status: only updated when a meeting reveals the dead
    pub alive_pub: [u8; MAXP],
    /// votes of the last meeting, published all at once at the tally
    pub last_votes: [u8; MAXP],
    /// roles, published only when the game ends
    pub roles_pub: [u8; MAXP],
    pub names: [[u8; NAME_LEN]; MAXP],
    pub chat_seat: [u8; CHAT_SLOTS],
    pub chat_len: [u8; CHAT_SLOTS],
    pub chat_text: [[u8; CHAT_LEN]; CHAT_SLOTS],
    // ---- staked tables (appended so every older offset is unchanged)
    /// the base-layer Pot this heist is played for (0 = no pot yet / free table)
    pub pot_nonce: u64,
    /// token base units (USDC: 6 decimals) per seat; 0 = free table
    pub stake: u64,
    // ---- v2: verifiable replay + Tip Line (appended; every older offset is unchanged)
    /// the SPL mint stakes and tips are paid in (devnet USDC)
    pub mint: Pubkey,
    /// H("inside-job/commit/v1" ‖ seed ‖ room ‖ heist): pushed to Solana before play
    pub deal_commit: [u8; 32],
    /// running SHA-256 over the move log: committed to Solana with the result
    pub log_hash: [u8; 32],
    pub log_len: u32,
    /// bit flags: COMMITTED_DEAL once the Room carrying `deal_commit` has been committed to
    /// Solana, COMMITTED_RESULT once the final Room has (cleared by `start_match`)
    pub deal_committed: u8,
    /// Tip Line entries that have picked this heist (index into the base-layer Market)
    pub tip_n: u8,
    pub _pad2: [u8; 2],
    /// each Tip Line entry's suspect (NO_PICK = none yet)
    pub tip_seat: [u8; MAX_TIPS],
    /// each entry's weight: heist time left when it last picked (earlier = more)
    pub tip_weight: [u16; MAX_TIPS],
}
pub const ROOM_SIZE: usize = 1784;
pub const COMMITTED_DEAL: u8 = 1;
pub const COMMITTED_RESULT: u8 = 2;
const _: () = assert!(core::mem::size_of::<Room>() == ROOM_SIZE);

impl Room {
    pub fn seat_of(&self, key: &Pubkey) -> Option<usize> {
        if *key == Pubkey::default() {
            return None;
        }
        (0..MAXP).find(|&i| self.players[i] == *key)
    }
    pub fn occupied(&self, i: usize) -> bool {
        self.is_bot[i] == 1 || self.players[i] != Pubkey::default()
    }
    pub fn clear_seat(&mut self, i: usize) {
        self.players[i] = Pubkey::default();
        self.wallets[i] = Pubkey::default();
        self.names[i] = [0; NAME_LEN];
        self.is_bot[i] = 0;
        self.last_seen[i] = 0;
        self.alive_pub[i] = 0;
    }
    pub fn humans(&self) -> usize {
        (0..MAXP).filter(|&i| self.players[i] != Pubkey::default() && self.is_bot[i] == 0).count()
    }
    pub fn push_chat(&mut self, seat: u8, text: &[u8]) {
        let slot = (self.chat_count as usize) % CHAT_SLOTS;
        let n = text.len().min(CHAT_LEN);
        self.chat_seat[slot] = seat;
        self.chat_len[slot] = n as u8;
        self.chat_text[slot] = [0; CHAT_LEN];
        self.chat_text[slot][..n].copy_from_slice(&text[..n]);
        self.chat_count = self.chat_count.wrapping_add(1);
    }
}

#[cfg_attr(not(feature = "replay"), account(zero_copy))]
#[cfg_attr(feature = "replay", derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable), repr(C))]
pub struct World {
    pub room_id: u64,
    pub rng: u64,
    pub tick: u32,
    pub dealt: u32,
    pub in_seq: [u32; MAXP],
    pub x: [i16; MAXP],
    pub y: [i16; MAXP],
    pub body_x: [i16; MAXP],
    pub body_y: [i16; MAXP],
    pub kill_cd: [u16; MAXP],
    /// H(vrf ‖ salts ‖ room ‖ match) — what the deal actually used
    pub seed: [u8; 32],
    /// raw VRF output (or the fallback's pseudo-seed), published at lights-on for verification
    pub vrf: [u8; 32],
    pub salts: [[u8; 32]; MAXP],
    pub role: [u8; MAXP],
    pub alive: [u8; MAXP],
    /// held input: bits 0-3 direction (0 none, 1..8 = N NE E SE S SW W NW), bit 4 USE
    pub input: [u8; MAXP],
    /// edge-triggered buttons waiting for the next tick: bit 5 CUFF, 6 REPORT, 7 EMERGENCY
    pub edge: [u8; MAXP],
    pub emergency_used: [u8; MAXP],
    pub body: [u8; MAXP],
    /// seat+1 of a Mole this seat watched cuff someone (0 = none)
    pub witness: [u8; MAXP],
    pub votes: [u8; MAXP],
    pub bot_goal: [u8; MAXP],
    pub bot_wait: [u8; MAXP],
    pub task_st: [u8; MAXP * TASKS_PER],
    /// 0..TASK_TICKS-1 progress, 255 = done
    pub task_prog: [u8; MAXP * TASKS_PER],
    pub salt_set: [u8; MAXP],
}
pub const WORLD_SIZE: usize = 592;
const _: () = assert!(core::mem::size_of::<World>() == WORLD_SIZE);

#[cfg_attr(not(feature = "replay"), account(zero_copy))]
#[cfg_attr(feature = "replay", derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable), repr(C))]
pub struct View {
    pub room_id: u64,
    pub seat: u32,
    pub tick: u32,
    pub kill_cd: u32,
    pub _pad0: u32,
    pub me_x: i16,
    pub me_y: i16,
    pub vis_x: [i16; MAXP],
    pub vis_y: [i16; MAXP],
    pub body_x: [i16; MAXP],
    pub body_y: [i16; MAXP],
    pub role: u8,
    pub alive: u8,
    /// other Moles (Mole viewers only)
    pub partner_mask: u8,
    /// bit0 can_use, bit1 can_report, bit2 can_cuff, bit3 at_button
    pub flags: u8,
    pub vis_mask: u8,
    pub ghost_mask: u8,
    pub body_mask: u8,
    pub near_station: u8,
    pub task_st: [u8; TASKS_PER],
    pub task_prog: [u8; TASKS_PER],
    pub witness: u8,
    pub _pad1: [u8; 5],
}
pub const VIEW_SIZE: usize = 112;
const _: () = assert!(core::mem::size_of::<View>() == VIEW_SIZE);

pub const LOG_SEED: &[u8] = b"log";

/// Header of the move log (an ephemeral account: header + 4-byte records). Everything the
/// rules took from outside during a heist — human inputs, ballots, the clock — so anyone
/// can replay the heist from the deal and get the exact same World. See `replaylog.rs`.
#[cfg_attr(not(feature = "replay"), account(zero_copy))]
#[cfg_attr(feature = "replay", derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable), repr(C))]
pub struct MoveLog {
    pub room_id: u64,
    /// unix time of the first step, and the clock as of the last record
    pub now0: i64,
    pub last_now: i64,
    pub match_no: u32,
    /// sim steps taken (one per executed tick)
    pub steps: u32,
    pub n_recs: u32,
    /// 1 = ran out of space; the heist can't be replayed (never silently wrong)
    pub overflow: u8,
    pub occ_mask: u8,
    pub bot_mask: u8,
    pub max_players: u8,
    /// each human's held input as the World had it after the last step
    pub last_in: [u8; MAXP],
    /// human ballots already logged this meeting
    pub logged_votes: u8,
    pub _pad: [u8; 7],
    /// running SHA-256 over every record
    pub hash: [u8; 32],
}
pub const MOVE_LOG_SIZE: usize = 88;
const _: () = assert!(core::mem::size_of::<MoveLog>() == MOVE_LOG_SIZE);

pub const POT_SEED: &[u8] = b"pot";
pub const POT_OPEN: u8 = 0;
pub const POT_SETTLED: u8 = 1;
pub const POT_REFUNDED: u8 = 2;

/// Base-layer escrow for one staked heist. Never delegated: it lives on Solana and is
/// paid out by `settle`, which reads the Room state the TEE committed at lights-on.
/// The stakes themselves sit in the Pot's token account (an ATA of the Pot PDA).
#[cfg(not(feature = "replay"))]
#[account]
pub struct Pot {
    pub room_id: u64,
    pub nonce: u64,
    pub stake: u64,
    pub created_at: i64,
    pub status: u8,
    pub n: u8,
    pub bump: u8,
    /// winning team copied from the committed Room at settle (255 = refunded)
    pub winner: u8,
    /// who paid
    pub wallets: [Pubkey; MAXP],
    /// the session key each ticket authorises to take a seat in the rollup
    pub sessions: [Pubkey; MAXP],
    /// what each ticket received at settle / refund
    pub paid: [u64; MAXP],
}
pub const POT_SIZE: usize = 8 + 8 + 8 + 8 + 4 + 32 * MAXP + 32 * MAXP + 8 * MAXP; // 612

#[cfg(not(feature = "replay"))]
impl Pot {
    pub fn entry_of(&self, wallet: &Pubkey) -> Option<usize> {
        (0..self.n as usize).find(|&i| self.wallets[i] == *wallet)
    }
}

pub const MARKET_SEED: &[u8] = b"market";
pub const MARKET_OPEN: u8 = 0;
pub const MARKET_RESOLVED: u8 = 1;
pub const MARKET_REFUNDED: u8 = 2;

/// The Tip Line for one heist: spectators stake on which seat is the Mole. Base-layer
/// escrow (tokens in the Market's ATA). Picks are made inside the rollup and land in the
/// Room; at lights-on a Magic Action copies the committed result here. No oracle.
#[cfg(not(feature = "replay"))]
#[account]
pub struct Market {
    pub room_id: u64,
    pub created_at: i64,
    pub match_no: u32,
    pub status: u8,
    pub n: u8,
    pub bump: u8,
    /// winning team, copied from the committed Room (255 = unresolved)
    pub winner: u8,
    pub wallets: [Pubkey; MAX_TIPS],
    /// the session key that may pick for each entry inside the rollup
    pub sessions: [Pubkey; MAX_TIPS],
    pub amounts: [u64; MAX_TIPS],
    pub seats: [u8; MAX_TIPS],
    pub weights: [u16; MAX_TIPS],
    pub roles: [u8; MAXP],
    pub paid: [u64; MAX_TIPS],
    /// bit e set once entry e has been paid
    pub claimed: u16,
}
pub const MARKET_SIZE: usize = 8 + 8 + 4 + 4 + 32 * MAX_TIPS * 2 + 8 * MAX_TIPS + MAX_TIPS + 2 * MAX_TIPS + MAXP + 8 * MAX_TIPS + 2; // 1362

#[cfg(not(feature = "replay"))]
impl Market {
    pub fn entry_of_session(&self, k: &Pubkey) -> Option<usize> {
        (0..self.n as usize).find(|&i| self.sessions[i] == *k)
    }
}

pub const DISC: usize = 8;

/// Borrow a zero-copy body that sits after the 8-byte discriminator.
pub fn body_mut<T: bytemuck::Pod>(d: &mut [u8]) -> &mut T {
    bytemuck::from_bytes_mut(&mut d[DISC..DISC + core::mem::size_of::<T>()])
}
pub fn body_ref<T: bytemuck::Pod>(d: &[u8]) -> &T {
    bytemuck::from_bytes(&d[DISC..DISC + core::mem::size_of::<T>()])
}
