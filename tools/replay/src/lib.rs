//! The browser's referee. Compiles the program's *own* rule files — not a port — to
//! WebAssembly, then, at lights-on, checks a heist end to end:
//!   1. the move log belongs to this room + heist,
//!   2. the revealed seed matches the deal commitment the Room carried to Solana,
//!   3. replaying every logged step from the deal rebuilds the revealed World exactly,
//!   4. the replayed result (winner, roles, votes…) is the public one,
//!   5. the log's hash chain is the one committed to Solana with the result.
//! If all five hold, the TEE followed the rules: it was only trusted to keep secrets.
#![allow(dead_code)]

pub mod shim {
    /// Stand-in for Solana's Pubkey: the replay only needs "set / not set".
    #[derive(Clone, Copy, Default, PartialEq, Eq, Debug, bytemuck::Pod, bytemuck::Zeroable)]
    #[repr(transparent)]
    pub struct Pubkey(pub [u8; 32]);
    impl Pubkey {
        pub const fn new_from_array(a: [u8; 32]) -> Self {
            Pubkey(a)
        }
    }
}

#[path = "../../../programs/inside-job/src/state.rs"]
pub mod state;
#[path = "../../../programs/inside-job/src/sim.rs"]
pub mod sim;
#[path = "../../../programs/inside-job/src/replaylog.rs"]
pub mod replaylog;

use sha2::{Digest, Sha256};
use state::*;

fn sha(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn pod<T: bytemuck::Pod>(data: &[u8], what: &str) -> Result<T, String> {
    let n = core::mem::size_of::<T>();
    if data.len() < DISC + n {
        return Err(format!("{what} account is too short ({} bytes)", data.len()));
    }
    Ok(bytemuck::pod_read_unaligned(&data[DISC..DISC + n]))
}

fn js(s: Option<&str>) -> String {
    match s {
        None => "null".into(),
        Some(v) => format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "'")),
    }
}

/// Verify one heist from the raw account data (each with its 8-byte discriminator).
/// Returns a small JSON report.
pub fn verify(room_raw: &[u8], world_raw: &[u8], log_raw: &[u8]) -> String {
    let parsed = (|| -> Result<(Room, World, MoveLog), String> {
        Ok((pod::<Room>(room_raw, "Room")?, pod::<World>(world_raw, "World")?, pod::<MoveLog>(log_raw, "move log")?))
    })();
    let (room, world, log) = match parsed {
        Ok(v) => v,
        Err(e) => return format!("{{\"ok\":false,\"error\":{}}}", js(Some(&e))),
    };
    let recs = &log_raw[(DISC + MOVE_LOG_SIZE).min(log_raw.len())..];
    let same_heist = log.room_id == room.room_id && log.match_no == room.match_no;
    let commit_ok = replaylog::deal_commit(&world.seed, room.room_id, room.match_no, sha) == room.deal_commit;
    let (mut world_diff, mut room_diff, mut err) = (None, None, None);
    let mut chain_ok = false;
    if !same_heist {
        err = Some("the move log is from another heist");
    } else {
        match replaylog::replay(&log, recs, &world.salts, &world.salt_set, world.vrf, world.seed, sha) {
            Err(e) => err = Some(e),
            Ok(rep) => {
                world_diff = replaylog::diff_world(&rep.world, &world);
                room_diff = replaylog::diff_room(&rep.room, &room);
                chain_ok = rep.hash == log.hash && log.hash == room.log_hash;
            }
        }
    }
    let ok = same_heist && commit_ok && chain_ok && world_diff.is_none() && room_diff.is_none() && err.is_none();
    format!(
        "{{\"ok\":{ok},\"commit\":{commit_ok},\"chain\":{chain_ok},\"world\":{},\"room\":{},\"error\":{},\"steps\":{},\"records\":{},\"winner\":{},\"logHash\":\"{}\",\"dealCommit\":\"{}\"}}",
        js(world_diff),
        js(room_diff),
        js(err),
        log.steps,
        log.n_recs,
        room.winner,
        hex(&room.log_hash),
        hex(&room.deal_commit),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use replaylog::*;
    use sim::*;
    use bytemuck::Zeroable;

    fn raw<T: bytemuck::Pod>(v: &T, extra: &[u8]) -> Vec<u8> {
        let mut d = vec![0u8; DISC];
        d.extend_from_slice(bytemuck::bytes_of(v));
        d.extend_from_slice(extra);
        d
    }

    /// Play a heist the way the program does (record → tick → after), then hand the raw
    /// account bytes to `verify`, exactly as the browser will at lights-on.
    fn heist(seed: u8) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut r: Room = Zeroable::zeroed();
        r.room_id = 31;
        r.match_no = 4;
        r.max_players = 8;
        r.players[0] = shim::Pubkey([9; 32]);
        for s in 1..6 {
            r.is_bot[s] = 1;
        }
        let mut w: World = Zeroable::zeroed();
        w.room_id = 31;
        w.salts[0] = [seed; 32];
        w.salt_set[0] = 1;
        let mut h: MoveLog = Zeroable::zeroed();
        begin(&mut h, &r);
        let mut recs = vec![0u8; REC * LOG_CAP];
        deal(&mut r, &mut w, [seed; 32]);
        w.vrf = [7; 32];
        r.deal_commit = deal_commit(&w.seed, r.room_id, r.match_no, sha);
        let mut views: Vec<View> = (0..MAXP).map(|_| Zeroable::zeroed()).collect();
        let mut rng = seed as u64;
        let mut now = 1_800_000_000i64;
        let mut t = 0u32;
        while r.phase != PH_ENDED && t < 20_000 {
            if r.phase == PH_PLAY && next_rng(&mut rng) % 4 == 0 {
                w.input[0] = (next_rng(&mut rng) % 9) as u8;
            }
            if t % 10 == 0 {
                now += 1;
            }
            record_step(&mut h, &mut recs, &r, &w, now, sha);
            let mut refs: Vec<&mut View> = views.iter_mut().collect();
            tick(&mut r, &mut w, &mut refs[..], now);
            after_step(&mut h, &r, &w);
            r.log_hash = h.hash;
            t += 1;
        }
        r.phase = PH_REVEALED;
        let used = h.n_recs as usize * REC;
        (raw(&r, &[]), raw(&w, &[]), raw(&h, &recs[..used]))
    }

    #[test]
    fn an_honest_heist_verifies() {
        for seed in [3u8, 11, 42] {
            let (r, w, l) = heist(seed);
            let out = verify(&r, &w, &l);
            assert!(out.starts_with("{\"ok\":true"), "seed {seed}: {out}");
        }
    }

    #[test]
    fn tampering_anywhere_is_caught() {
        let (r, w, l) = heist(5);
        // 1. a different winner in the public result
        let mut room: Room = bytemuck::pod_read_unaligned(&r[DISC..]);
        room.winner ^= 1;
        let out = verify(&raw(&room, &[]), &w, &l);
        assert!(out.contains("\"ok\":false") && out.contains("\"room\":\"winner\""), "{out}");
        // 2. a swapped role in the revealed World
        let mut world: World = bytemuck::pod_read_unaligned(&w[DISC..]);
        let a = (0..MAXP).find(|&i| world.role[i] == ROLE_MOLE).unwrap();
        let b = (0..MAXP).find(|&i| world.role[i] == ROLE_CREW).unwrap();
        world.role.swap(a, b);
        assert!(verify(&r, &raw(&world, &[]), &l).contains("\"ok\":false"));
        // 3. an edited move
        let mut l2 = l.clone();
        let k = DISC + MOVE_LOG_SIZE + 3;
        l2[k] ^= 0x01;
        let out = verify(&r, &w, &l2);
        assert!(out.contains("\"chain\":false"), "{out}");
        // 4. a seed that doesn't match the deal commitment
        let mut world: World = bytemuck::pod_read_unaligned(&w[DISC..]);
        world.seed[0] ^= 1;
        assert!(verify(&r, &raw(&world, &[]), &l).contains("\"commit\":false"));
    }
}

// ---------------------------------------------------------------- WASM ABI (no bindgen)

static mut OUT: Vec<u8> = Vec::new();

/// Allocate `n` bytes for the host to write into (leaked; the page is short-lived).
#[no_mangle]
pub extern "C" fn ij_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// # Safety
/// The three (ptr, len) pairs must point into memory from `ij_alloc`.
#[no_mangle]
pub unsafe extern "C" fn ij_verify(room: *const u8, room_len: usize, world: *const u8, world_len: usize, log: *const u8, log_len: usize) -> *const u8 {
    let r = core::slice::from_raw_parts(room, room_len);
    let w = core::slice::from_raw_parts(world, world_len);
    let l = core::slice::from_raw_parts(log, log_len);
    let out = verify(r, w, l).into_bytes();
    OUT = out;
    #[allow(static_mut_refs)]
    OUT.as_ptr()
}

#[no_mangle]
pub extern "C" fn ij_out_len() -> usize {
    #[allow(static_mut_refs)]
    unsafe {
        OUT.len()
    }
}
