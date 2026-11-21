//! The move log, and the replay that checks it.
//!
//! The rules in `sim.rs` are deterministic. During a heist they take only three things
//! from outside: each human's input at every step, each human's ballot, and the clock.
//! `record_step` writes exactly those (4-byte records) before every step, and folds them
//! into a running SHA-256 that the Room carries to Solana. At lights-on the log is
//! public, and `replay` re-runs the whole heist from the deal: same code, same inputs,
//! so it must end in the same World. If it doesn't, the enclave didn't follow the rules.
//!
//! The TEE is then trusted only to keep secrets *during* the game, not to decide who
//! won: the winner and the payout are reproducible by anyone, in a browser.
//!
//! Record: [step lo, step hi, code, value]
//!   code 0..=7   seat `code`'s input byte at this step (held input | edge buttons)
//!   code 8..=15  seat `code - 8` cast ballot `value`
//!   code 16 / 17 the clock moved forward / back by `value` seconds
use crate::sim;
use crate::state::*;
#[cfg(feature = "replay")]
use crate::shim::Pubkey;
#[cfg(all(test, not(feature = "replay")))]
use anchor_lang::prelude::Pubkey;

pub const REC: usize = 4;
/// 12 288 records (48 KiB): a 15-minute heist with every human steering nonstop fits.
pub const LOG_CAP: usize = 12_288;
pub const LOG_ACCOUNT_SIZE: usize = DISC + MOVE_LOG_SIZE + REC * LOG_CAP;

const C_VOTE: u8 = 8;
const C_NOW_FWD: u8 = 16;
const C_NOW_BACK: u8 = 17;
const EDGES: u8 = sim::IN_CUFF | sim::IN_REPORT | sim::IN_EMERGENCY;
const HELD: u8 = sim::IN_DIR | sim::IN_USE;
/// the most records one step can produce: clock (16) + 8 inputs + 8 ballots
const MAX_PER_STEP: usize = 32;

/// SHA-256 over the concatenation of `parts` (the program and the WASM replay each pass theirs).
pub type Hasher = fn(&[&[u8]]) -> [u8; 32];

/// What the deal commits to before play: H(tag ‖ seed ‖ room ‖ heist).
pub fn deal_commit(seed: &[u8; 32], room_id: u64, match_no: u32, hash: Hasher) -> [u8; 32] {
    hash(&[b"inside-job/commit/v1", seed, &room_id.to_le_bytes(), &match_no.to_le_bytes()])
}

fn masks(room: &Room) -> (u8, u8) {
    let (mut occ, mut bot) = (0u8, 0u8);
    for s in 0..MAXP {
        if room.occupied(s) {
            occ |= 1 << s;
        }
        if room.is_bot[s] == 1 {
            bot |= 1 << s;
        }
    }
    (occ, bot)
}

fn human(h: &MoveLog, s: usize) -> bool {
    h.occ_mask & (1 << s) != 0 && h.bot_mask & (1 << s) == 0
}

/// A fresh log for the heist that `room` is about to deal (call at start_match, after bots fill).
pub fn begin(h: &mut MoveLog, room: &Room) {
    *h = bytemuck::Zeroable::zeroed();
    h.room_id = room.room_id;
    h.match_no = room.match_no;
    let (occ, bot) = masks(room);
    h.occ_mask = occ;
    h.bot_mask = bot;
    h.max_players = room.max_players;
}

/// Log everything that will feed this step. Call right before `sim::tick`.
pub fn record_step(h: &mut MoveLog, recs: &mut [u8], room: &Room, w: &World, now: i64, hash: Hasher) {
    let step = h.steps;
    h.steps = h.steps.wrapping_add(1);
    if h.overflow != 0 {
        return;
    }
    if step == 0 {
        h.now0 = now;
        h.last_now = now;
    }
    if step > u16::MAX as u32 {
        h.overflow = 1;
        return;
    }
    let sb = (step as u16).to_le_bytes();
    let mut buf = [0u8; REC * MAX_PER_STEP];
    let mut n = 0usize;
    let mut push = |code: u8, val: u8, n: &mut usize| -> bool {
        if *n >= MAX_PER_STEP {
            return false;
        }
        buf[*n * REC..*n * REC + REC].copy_from_slice(&[sb[0], sb[1], code, val]);
        *n += 1;
        true
    };
    // the clock (meetings run on unix seconds)
    let mut ok = true;
    while ok && now != h.last_now {
        let fwd = now > h.last_now;
        let d = (now - h.last_now).unsigned_abs().min(255);
        ok = push(if fwd { C_NOW_FWD } else { C_NOW_BACK }, d as u8, &mut n);
        h.last_now += if fwd { d as i64 } else { -(d as i64) };
        if n >= 16 && now != h.last_now {
            ok = false; // a 68-minute jump: give up rather than log a wrong clock
        }
    }
    // human inputs and ballots (bots are part of the rules: the replay re-derives them)
    for s in 0..MAXP {
        if !ok || !human(h, s) {
            continue;
        }
        if w.input[s] != h.last_in[s] || w.edge[s] != 0 {
            ok = push(s as u8, (w.input[s] & HELD) | (w.edge[s] & EDGES), &mut n);
        }
        if ok && room.voted_mask & (1 << s) != 0 && h.logged_votes & (1 << s) == 0 {
            ok = push(C_VOTE + s as u8, w.votes[s], &mut n);
            h.logged_votes |= 1 << s;
        }
    }
    if !ok || h.n_recs as usize + n > LOG_CAP || recs.len() < (h.n_recs as usize + n) * REC {
        h.overflow = 1;
        return;
    }
    if n > 0 {
        let at = h.n_recs as usize * REC;
        recs[at..at + n * REC].copy_from_slice(&buf[..n * REC]);
        h.n_recs += n as u32;
        h.hash = hash(&[&h.hash, &buf[..n * REC]]);
    }
}

/// Remember what the World holds after the step. Call right after `sim::tick`.
pub fn after_step(h: &mut MoveLog, room: &Room, w: &World) {
    for s in 0..MAXP {
        if human(h, s) {
            h.last_in[s] = w.input[s];
        }
    }
    h.logged_votes = room.voted_mask & !h.bot_mask;
}

#[cfg(any(test, feature = "replay"))]
pub struct Replayed {
    pub room: Room,
    pub world: World,
    pub hash: [u8; 32],
}

#[cfg(any(test, feature = "replay"))]
/// Re-run a heist from its deal. `salts`/`salt_set`/`vrf`/`seed` come from the revealed World.
pub fn replay(h: &MoveLog, recs: &[u8], salts: &[[u8; 32]; MAXP], salt_set: &[u8; MAXP], vrf: [u8; 32], seed: [u8; 32], hash: Hasher) -> Result<Replayed, &'static str> {
    if h.overflow != 0 {
        return Err("the move log overflowed: this heist can't be replayed");
    }
    let n = h.n_recs as usize;
    if recs.len() < n * REC {
        return Err("the move log is shorter than its header says");
    }
    let mut room: Room = bytemuck::Zeroable::zeroed();
    room.room_id = h.room_id;
    room.match_no = h.match_no;
    room.max_players = h.max_players;
    room.phase = PH_STARTING;
    for s in 0..MAXP {
        if h.bot_mask & (1 << s) != 0 {
            room.is_bot[s] = 1;
        } else if h.occ_mask & (1 << s) != 0 {
            room.players[s] = Pubkey::new_from_array([s as u8 + 1; 32]);
        }
    }
    let mut w: World = bytemuck::Zeroable::zeroed();
    w.room_id = h.room_id;
    w.salts = *salts;
    w.salt_set = *salt_set;
    sim::deal(&mut room, &mut w, seed);
    w.vrf = vrf;
    let mut views: [View; MAXP] = bytemuck::Zeroable::zeroed();
    let mut chain = [0u8; 32];
    let mut now = h.now0;
    let mut i = 0usize;
    for step in 0..h.steps {
        let start = i;
        while i < n {
            let r = &recs[i * REC..i * REC + REC];
            if u16::from_le_bytes([r[0], r[1]]) as u32 != step {
                break;
            }
            let (code, val) = (r[2], r[3]);
            match code {
                0..=7 => {
                    let s = code as usize;
                    w.input[s] = val & HELD;
                    w.edge[s] = val & EDGES;
                }
                8..=15 => sim::cast_vote(&mut room, &mut w, (code - C_VOTE) as usize, val),
                C_NOW_FWD => now += val as i64,
                C_NOW_BACK => now -= val as i64,
                _ => return Err("unknown record in the move log"),
            }
            i += 1;
        }
        if i > start {
            chain = hash(&[&chain, &recs[start * REC..i * REC]]);
        }
        let mut refs: [&mut View; MAXP] = {
            let [a, b, c, d, e, f, g, k] = &mut views;
            [a, b, c, d, e, f, g, k]
        };
        sim::tick(&mut room, &mut w, &mut refs[..], now);
    }
    if i != n {
        return Err("the move log has records after its last step");
    }
    Ok(Replayed { room, world: w, hash: chain })
}

#[cfg(any(test, feature = "replay"))]
/// First difference between the replayed World and the revealed one (`in_seq` is
/// transport bookkeeping, not game state, so it's skipped). None = identical.
pub fn diff_world(a: &World, b: &World) -> Option<&'static str> {
    macro_rules! cmp {
        ($($f:ident),*) => { $( if a.$f != b.$f { return Some(stringify!($f)); } )* };
    }
    cmp!(room_id, rng, tick, dealt, x, y, body_x, body_y, kill_cd, seed, vrf, salts, role, alive, input, edge, emergency_used, body, witness, votes, bot_goal, bot_wait, task_st, task_prog, salt_set);
    None
}

#[cfg(all(test, not(feature = "replay")))]
mod tests {
    use super::*;
    use crate::sim::*;
    use anchor_lang::prelude::Pubkey;
    use bytemuck::Zeroable;

    fn sha(p: &[&[u8]]) -> [u8; 32] {
        solana_sha256_hasher::hashv(p).to_bytes()
    }

    struct Live {
        room: Room,
        world: World,
        log: MoveLog,
        recs: Vec<u8>,
    }

    /// A heist with two humans who mash random inputs and vote at random moments, exactly
    /// the way the `act` / `vote` instructions touch the World between ticks.
    fn play(seed: u8, humans: usize) -> Live {
        let mut r: Room = Zeroable::zeroed();
        r.room_id = 7;
        r.match_no = seed as u32;
        r.max_players = 8;
        for s in 0..6 {
            if s < humans {
                r.players[s] = Pubkey::new_unique();
            } else {
                r.is_bot[s] = 1;
            }
        }
        let mut w: World = Zeroable::zeroed();
        w.room_id = 7;
        for s in 0..MAXP {
            w.salts[s] = [seed ^ (s as u8).wrapping_mul(37); 32];
            w.salt_set[s] = (s < humans) as u8;
        }
        let mut log: MoveLog = Zeroable::zeroed();
        begin(&mut log, &r);
        let mut recs = vec![0u8; REC * LOG_CAP];
        deal(&mut r, &mut w, [seed; 32]);
        w.vrf = [seed.wrapping_mul(3); 32];
        let mut views: Vec<View> = (0..MAXP).map(|_| Zeroable::zeroed()).collect();
        let mut rng = seed as u64 * 7_919 + 1;
        let mut now = 1_700_000_000i64;
        let mut t = 0;
        while r.phase != PH_ENDED && t < 20_000 {
            for s in 0..humans {
                if r.phase == PH_PLAY && next_rng(&mut rng) % 3 == 0 {
                    let dir = (next_rng(&mut rng) % 9) as u8;
                    let use_ = if next_rng(&mut rng) % 4 == 0 { IN_USE } else { 0 };
                    w.input[s] = dir | use_;
                    let e = next_rng(&mut rng) % 40;
                    w.edge[s] |= match e { 0 => IN_CUFF, 1 => IN_REPORT, 2 => IN_EMERGENCY, _ => 0 };
                }
                if r.phase == PH_MEETING && w.alive[s] == 1 && r.voted_mask & (1 << s) == 0 && next_rng(&mut rng) % 25 == 0 {
                    let alive: Vec<usize> = (0..MAXP).filter(|&j| r.occupied(j) && w.alive[j] == 1).collect();
                    let k = next_rng(&mut rng) as usize % (alive.len() + 1);
                    cast_vote(&mut r, &mut w, s, if k == alive.len() { VOTE_SKIP } else { alive[k] as u8 });
                }
            }
            if t % 10 == 0 {
                now += 1;
            }
            if t == 333 {
                now += 700; // a big clock jump (needs several clock records)
            }
            record_step(&mut log, &mut recs, &r, &w, now, sha);
            let mut refs: Vec<&mut View> = views.iter_mut().collect();
            tick(&mut r, &mut w, &mut refs[..], now);
            after_step(&mut log, &r, &w);
            t += 1;
        }
        assert_eq!(r.phase, PH_ENDED, "seed {seed}: the heist must end");
        Live { room: r, world: w, log, recs }
    }

    #[test]
    fn every_heist_replays_exactly_from_its_move_log() {
        let mut meetings = 0;
        for seed in 1..=16u8 {
            let humans = 1 + (seed as usize % 3);
            let l = play(seed, humans);
            assert_eq!(l.log.overflow, 0, "seed {seed}: log overflow");
            let rep = replay(&l.log, &l.recs, &l.world.salts, &l.world.salt_set, l.world.vrf, l.world.seed, sha).expect("replays");
            assert_eq!(diff_world(&rep.world, &l.world), None, "seed {seed}: replayed World differs");
            assert_eq!(diff_room(&rep.room, &l.room), None, "seed {seed}: replayed result differs");
            assert_eq!(rep.hash, l.log.hash, "seed {seed}: hash chain differs");
            meetings += l.room.last_votes.iter().any(|&v| v != VOTE_NONE) as u32;
        }
        assert!(meetings > 0, "the sample must include meetings with ballots");
    }

    #[test]
    fn a_doctored_log_is_caught() {
        let l = play(5, 2);
        assert!(l.log.n_recs > 10);
        // change one human input somewhere in the middle
        let mut recs = l.recs.clone();
        let k = (l.log.n_recs as usize / 2..l.log.n_recs as usize).find(|&k| recs[k * REC + 2] < 8).unwrap();
        recs[k * REC + 3] ^= 0x03;
        let rep = replay(&l.log, &recs, &l.world.salts, &l.world.salt_set, l.world.vrf, l.world.seed, sha).expect("still parses");
        assert_ne!(rep.hash, l.log.hash, "the hash chain must expose the edit");
        // and a forged seed can't reproduce the dealt roles
        let rep2 = replay(&l.log, &l.recs, &l.world.salts, &l.world.salt_set, l.world.vrf, [99; 32], sha).expect("parses");
        assert!(diff_world(&rep2.world, &l.world).is_some());
    }

    #[test]
    fn the_deal_commitment_binds_the_seed() {
        let a = deal_commit(&[1; 32], 7, 3, sha);
        assert_ne!(a, deal_commit(&[2; 32], 7, 3, sha));
        assert_ne!(a, deal_commit(&[1; 32], 7, 4, sha));
        assert_eq!(a, deal_commit(&[1; 32], 7, 3, sha));
    }
}

#[cfg(any(test, feature = "replay"))]
/// First difference in the public result the replay must reproduce. None = identical.
pub fn diff_room(a: &Room, b: &Room) -> Option<&'static str> {
    macro_rules! cmp {
        ($($f:ident),*) => { $( if a.$f != b.$f { return Some(stringify!($f)); } )* };
    }
    cmp!(winner, tick, task_total, task_done, n_moles, roles_pub, alive_pub, last_votes, ejected, ejected_role);
    None
}
