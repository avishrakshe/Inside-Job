//! The deterministic game rules. Pure functions over `Room`, `World` and the eight `View`s,
//! so the whole match logic is unit-tested on the host (see `tests` below).
//!
//! Units: one tile = 32 units. One tick = 100 ms of game time.
use crate::state::*;

include!(concat!(env!("OUT_DIR"), "/mapgen.rs"));

pub const TILE: i32 = 32;
pub const HALF: i32 = TILE / 2;
pub const BODY_R: i32 = 8;
pub const SPEED: i32 = 7;
pub const GHOST_SPEED: i32 = 9;
pub const CUFF_R: i32 = 48;
pub const REPORT_R: i32 = 72;
pub const USE_R: i32 = 40;
pub const BUTTON_R: i32 = 44;
pub const CORRIDOR_SIGHT: i32 = 96;
pub const TASK_TICKS: u8 = 80;
pub const KILL_CD: u16 = 380;
pub const KILL_CD_START: u16 = 260;
pub const KILL_CD_AFTER_MEETING: u16 = 220;
pub const HUNT_BELOW_CD: u16 = 15;
/// The vault's time lock: if the crew hasn't cracked it after 9 minutes of heist time
/// (meetings don't count), the alarm wins it for the Mole. Also ends games with AFK players.
pub const HEIST_TICKS: u32 = 5400;
pub const MEETING_SECS: i64 = 45;
pub const RESULT_SECS: i64 = 6;
pub const BOT_VOTE_AFTER_SECS: i64 = 14;
pub const CORRIDOR: u8 = 8;
pub const LOBBY_ROOM: u8 = 4;
pub const BUTTON_X: i32 = 19 * TILE + HALF;
pub const BUTTON_Y: i32 = 12 * TILE + HALF;

pub const IN_DIR: u8 = 0x0f;
pub const IN_USE: u8 = 1 << 4;
pub const IN_CUFF: u8 = 1 << 5;
pub const IN_REPORT: u8 = 1 << 6;
pub const IN_EMERGENCY: u8 = 1 << 7;

pub const F_CAN_USE: u8 = 1;
pub const F_CAN_REPORT: u8 = 2;
pub const F_CAN_CUFF: u8 = 4;
pub const F_AT_BUTTON: u8 = 8;

const DIRS: [(i32, i32); 9] = [(0, 0), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)];
const SPAWN_RING: [(i32, i32); MAXP] = [(-48, -32), (0, -40), (48, -32), (64, 8), (48, 40), (0, 56), (-48, 40), (-64, 8)];

// ---------------------------------------------------------------- map helpers

pub fn tile_at(px: i32, py: i32) -> u8 {
    if px < 0 || py < 0 {
        return 0;
    }
    let (tx, ty) = ((px / TILE) as usize, (py / TILE) as usize);
    if tx >= MAP_W || ty >= MAP_H {
        return 0;
    }
    TILES[ty * MAP_W + tx]
}

pub fn walkable(px: i32, py: i32) -> bool {
    tile_at(px - BODY_R, py - BODY_R) != 0
        && tile_at(px + BODY_R, py - BODY_R) != 0
        && tile_at(px - BODY_R, py + BODY_R) != 0
        && tile_at(px + BODY_R, py + BODY_R) != 0
}

pub fn station_xy(st: u8) -> (i32, i32) {
    let s = st as usize;
    (STATION_TX[s] as i32 * TILE + HALF, STATION_TY[s] as i32 * TILE + HALF)
}

fn d2(ax: i32, ay: i32, bx: i32, by: i32) -> i32 {
    let (dx, dy) = (ax - bx, ay - by);
    dx * dx + dy * dy
}

/// Lit rooms: you see everyone in the same room. In corridors (and from a corridor
/// into a doorway) you only see what's close. Walls block everything else.
pub fn can_see(ax: i32, ay: i32, bx: i32, by: i32) -> bool {
    let (ra, rb) = (tile_at(ax, ay), tile_at(bx, by));
    if ra == rb && ra != CORRIDOR && ra != 0 {
        return true;
    }
    (ra == CORRIDOR || rb == CORRIDOR) && d2(ax, ay, bx, by) <= CORRIDOR_SIGHT * CORRIDOR_SIGHT
}

/// Axis-separated movement with wall sliding.
pub fn step(x: &mut i16, y: &mut i16, dir: u8, speed: i32) {
    let d = (dir & IN_DIR) as usize;
    if d == 0 || d > 8 {
        return;
    }
    let (dx, dy) = DIRS[d];
    let s = if dx != 0 && dy != 0 { speed * 5 / 7 } else { speed };
    let (cx, cy) = (*x as i32, *y as i32);
    let nx = cx + dx * s;
    if walkable(nx, cy) {
        *x = nx as i16;
    }
    let ny = cy + dy * s;
    if walkable(*x as i32, ny) {
        *y = ny as i16;
    }
}

// ---------------------------------------------------------------- randomness

pub fn next_rng(state: &mut u64) -> u64 {
    // splitmix64
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Unbiased integer in [0, n) by rejection sampling.
pub fn rng_below(state: &mut u64, n: u64) -> u64 {
    let zone = u64::MAX - (u64::MAX % n);
    loop {
        let v = next_rng(state);
        if v < zone {
            return v % n;
        }
    }
}

// ---------------------------------------------------------------- the deal

/// Roles, tasks and spawns from the mixed seed. `mixed` is already H(vrf ‖ salts ‖ …),
/// computed by the caller, so neither the VRF oracle nor any single player can know it.
pub fn deal(room: &mut Room, w: &mut World, mixed: [u8; 32]) {
    w.seed = mixed;
    let mut rng = u64::from_le_bytes(mixed[0..8].try_into().unwrap())
        ^ u64::from_le_bytes(mixed[8..16].try_into().unwrap()).rotate_left(17);
    let mut seats = [0usize; MAXP];
    let mut n = 0;
    for i in 0..MAXP {
        if room.occupied(i) {
            seats[n] = i;
            n += 1;
        }
    }
    // Fisher-Yates over the occupied seats
    for k in (1..n).rev() {
        let j = rng_below(&mut rng, (k + 1) as u64) as usize;
        seats.swap(k, j);
    }
    let n_moles = if n >= 7 { 2 } else { 1 };
    room.n_moles = n_moles as u8;
    let mut crew = 0u32;
    for i in 0..MAXP {
        w.role[i] = ROLE_UNKNOWN;
        w.alive[i] = 0;
    }
    for (k, &s) in seats.iter().take(n).enumerate() {
        w.role[s] = if k < n_moles { ROLE_MOLE } else { ROLE_CREW };
        if w.role[s] == ROLE_CREW {
            crew += 1;
        }
        w.alive[s] = 1;
    }
    for i in 0..MAXP {
        // three different stations each (Moles get a fake list to stand at)
        let mut picked = [255u8; TASKS_PER];
        for t in 0..TASKS_PER {
            loop {
                let st = rng_below(&mut rng, N_STATIONS as u64) as u8;
                if !picked.contains(&st) {
                    picked[t] = st;
                    break;
                }
            }
            w.task_st[i * TASKS_PER + t] = picked[t];
            w.task_prog[i * TASKS_PER + t] = 0;
        }
        let (ox, oy) = SPAWN_RING[i];
        w.x[i] = (SPAWN_TX * TILE + HALF + ox) as i16;
        w.y[i] = (SPAWN_TY * TILE + HALF + oy) as i16;
        w.kill_cd[i] = if w.role[i] == ROLE_MOLE { KILL_CD_START } else { 0 };
        w.input[i] = 0;
        w.edge[i] = 0;
        w.emergency_used[i] = 0;
        w.body[i] = 0;
        w.witness[i] = 0;
        w.votes[i] = VOTE_NONE;
        w.bot_goal[i] = 255;
        w.bot_wait[i] = (rng_below(&mut rng, 20)) as u8;
        room.alive_pub[i] = w.alive[i];
        room.roles_pub[i] = ROLE_UNKNOWN;
        room.last_votes[i] = VOTE_NONE;
    }
    w.rng = rng;
    w.tick = 0;
    w.dealt = 1;
    room.tick = 0;
    room.task_total = crew * TASKS_PER as u32;
    room.task_done = 0;
    room.winner = NO_SEAT;
    room.ejected = NO_SEAT;
    room.ejected_role = ROLE_UNKNOWN;
    room.caller = NO_SEAT;
    room.reported = NO_SEAT;
    room.voted_mask = 0;
    room.phase = PH_PLAY;
}

// ---------------------------------------------------------------- one tick

pub struct TickOut {
    pub changed_phase: bool,
}

/// Advance one 100 ms step. `now` = unix seconds (meeting timers).
pub fn tick(room: &mut Room, w: &mut World, views: &mut [&mut View], now: i64) -> TickOut {
    let before = room.phase;
    match room.phase {
        PH_PLAY => play_tick(room, w, now),
        PH_MEETING => meeting_tick(room, w, now),
        PH_RESULT => {
            if now >= room.phase_end {
                after_result(room, w);
            }
        }
        _ => {}
    }
    write_views(room, w, views);
    TickOut { changed_phase: before != room.phase }
}

fn play_tick(room: &mut Room, w: &mut World, now: i64) {
    w.tick = w.tick.wrapping_add(1);
    room.tick = w.tick;
    // bots decide
    for i in 0..MAXP {
        if room.is_bot[i] == 1 && w.role[i] != ROLE_UNKNOWN {
            bot_think(room, w, i);
        }
    }
    // movement
    for i in 0..MAXP {
        if !room.occupied(i) || w.role[i] == ROLE_UNKNOWN {
            continue;
        }
        let speed = if w.alive[i] == 1 { SPEED } else { GHOST_SPEED };
        let (mut x, mut y) = (w.x[i], w.y[i]);
        step(&mut x, &mut y, w.input[i], speed);
        w.x[i] = x;
        w.y[i] = y;
    }
    // tasks (held USE)
    for i in 0..MAXP {
        if !room.occupied(i) || w.role[i] != ROLE_CREW || w.input[i] & IN_USE == 0 {
            continue;
        }
        // bots are filler crew: they work at half speed so humans set the pace
        if room.is_bot[i] == 1 && w.tick % 2 == 1 {
            continue;
        }
        if let Some(t) = near_task(w, i) {
            let k = i * TASKS_PER + t;
            w.task_prog[k] = w.task_prog[k].saturating_add(1);
            if w.task_prog[k] >= TASK_TICKS {
                w.task_prog[k] = 255;
                room.task_done = room.task_done.saturating_add(1);
            }
        }
    }
    // edge buttons, in seat order
    let mut meeting: Option<(u8, u8)> = None;
    for i in 0..MAXP {
        let e = w.edge[i];
        w.edge[i] = 0;
        if e == 0 || w.alive[i] == 0 || w.role[i] == ROLE_UNKNOWN {
            continue;
        }
        if e & IN_CUFF != 0 && w.role[i] == ROLE_MOLE && w.kill_cd[i] == 0 {
            if let Some(v) = cuff_target(room, w, i) {
                cuff(room, w, i, v);
            }
        }
        if meeting.is_none() && e & IN_REPORT != 0 {
            if let Some(b) = report_target(w, i) {
                meeting = Some((i as u8, b as u8));
            }
        }
        if meeting.is_none() && e & IN_EMERGENCY != 0 && w.emergency_used[i] == 0 && at_button(w, i) {
            w.emergency_used[i] = 1;
            meeting = Some((i as u8, NO_SEAT));
        }
    }
    for i in 0..MAXP {
        if w.kill_cd[i] > 0 {
            w.kill_cd[i] -= 1;
        }
    }
    if check_win(room, w) {
        return;
    }
    if let Some((caller, reported)) = meeting {
        start_meeting(room, w, caller, reported, now);
    }
}

fn near_task(w: &World, i: usize) -> Option<usize> {
    for t in 0..TASKS_PER {
        let k = i * TASKS_PER + t;
        if w.task_prog[k] == 255 {
            continue;
        }
        let (sx, sy) = station_xy(w.task_st[k]);
        if d2(w.x[i] as i32, w.y[i] as i32, sx, sy) <= USE_R * USE_R {
            return Some(t);
        }
    }
    None
}

fn near_station_any(w: &World, i: usize) -> u8 {
    for t in 0..TASKS_PER {
        let k = i * TASKS_PER + t;
        let (sx, sy) = station_xy(w.task_st[k]);
        if d2(w.x[i] as i32, w.y[i] as i32, sx, sy) <= USE_R * USE_R {
            return w.task_st[k];
        }
    }
    255
}

fn at_button(w: &World, i: usize) -> bool {
    d2(w.x[i] as i32, w.y[i] as i32, BUTTON_X, BUTTON_Y) <= BUTTON_R * BUTTON_R
}

fn cuff_target(room: &Room, w: &World, m: usize) -> Option<usize> {
    let mut best: Option<(usize, i32)> = None;
    for j in 0..MAXP {
        if j == m || !room.occupied(j) || w.alive[j] == 0 || w.role[j] != ROLE_CREW {
            continue;
        }
        let dd = d2(w.x[m] as i32, w.y[m] as i32, w.x[j] as i32, w.y[j] as i32);
        if dd <= CUFF_R * CUFF_R && best.map_or(true, |(_, b)| dd < b) {
            best = Some((j, dd));
        }
    }
    best.map(|(j, _)| j)
}

fn report_target(w: &World, i: usize) -> Option<usize> {
    (0..MAXP).find(|&b| w.body[b] == 1 && d2(w.x[i] as i32, w.y[i] as i32, w.body_x[b] as i32, w.body_y[b] as i32) <= REPORT_R * REPORT_R)
}

pub fn cuff(room: &Room, w: &mut World, m: usize, v: usize) {
    w.alive[v] = 0;
    w.body[v] = 1;
    w.body_x[v] = w.x[v];
    w.body_y[v] = w.y[v];
    w.kill_cd[m] = KILL_CD;
    // anyone alive (not the Moles, not the victim) who could see the Mole saw it happen
    for j in 0..MAXP {
        if j == m || j == v || !room.occupied(j) || w.alive[j] == 0 || w.role[j] == ROLE_MOLE {
            continue;
        }
        if can_see(w.x[j] as i32, w.y[j] as i32, w.x[m] as i32, w.y[m] as i32) {
            w.witness[j] = m as u8 + 1;
        }
    }
}

fn counts(room: &Room, w: &World) -> (u32, u32) {
    let (mut crew, mut moles) = (0, 0);
    for i in 0..MAXP {
        if room.occupied(i) && w.alive[i] == 1 {
            if w.role[i] == ROLE_MOLE {
                moles += 1;
            } else if w.role[i] == ROLE_CREW {
                crew += 1;
            }
        }
    }
    (crew, moles)
}

/// Returns true if the game ended.
pub fn check_win(room: &mut Room, w: &mut World) -> bool {
    let (crew, moles) = counts(room, w);
    let winner = if room.task_total > 0 && room.task_done >= room.task_total {
        Some(TEAM_CREW)
    } else if moles == 0 {
        Some(TEAM_CREW)
    } else if moles >= crew {
        Some(TEAM_MOLE)
    } else if w.tick >= HEIST_TICKS {
        Some(TEAM_MOLE)
    } else {
        None
    };
    if let Some(t) = winner {
        room.winner = t;
        room.phase = PH_ENDED;
        for i in 0..MAXP {
            room.roles_pub[i] = w.role[i];
            room.alive_pub[i] = w.alive[i];
        }
        return true;
    }
    false
}

pub fn start_meeting(room: &mut Room, w: &mut World, caller: u8, reported: u8, now: i64) {
    room.phase = PH_MEETING;
    room.phase_end = now + MEETING_SECS;
    room.caller = caller;
    room.reported = reported;
    room.voted_mask = 0;
    room.ejected = NO_SEAT;
    room.ejected_role = ROLE_UNKNOWN;
    for i in 0..MAXP {
        w.votes[i] = VOTE_NONE;
        w.body[i] = 0; // the meeting clears the bodies...
        w.input[i] = 0;
        w.edge[i] = 0;
        room.alive_pub[i] = w.alive[i]; // ...and reveals who's dead
        room.last_votes[i] = VOTE_NONE;
    }
}

pub fn cast_vote(room: &mut Room, w: &mut World, seat: usize, target: u8) {
    w.votes[seat] = target;
    room.voted_mask |= 1 << seat;
}

fn all_alive_voted(room: &Room, w: &World) -> bool {
    (0..MAXP).all(|i| !room.occupied(i) || w.alive[i] == 0 || room.voted_mask & (1 << i) != 0)
}

fn meeting_tick(room: &mut Room, w: &mut World, now: i64) {
    // bots vote once the discussion has had a moment
    if now >= room.phase_end - MEETING_SECS + BOT_VOTE_AFTER_SECS {
        for i in 0..MAXP {
            if room.is_bot[i] == 1 && w.alive[i] == 1 && room.voted_mask & (1 << i) == 0 {
                let mut target = VOTE_SKIP;
                if w.role[i] == ROLE_CREW && w.witness[i] > 0 {
                    let k = (w.witness[i] - 1) as usize;
                    if w.alive[k] == 1 {
                        target = k as u8;
                    }
                }
                cast_vote(room, w, i, target);
            }
        }
    }
    if now >= room.phase_end || all_alive_voted(room, w) {
        tally(room, w, now);
    }
}

pub fn tally(room: &mut Room, w: &mut World, now: i64) {
    let mut count = [0u32; MAXP];
    let mut skip = 0u32;
    for i in 0..MAXP {
        if !room.occupied(i) || w.alive[i] == 0 {
            continue;
        }
        let v = w.votes[i];
        if (v as usize) < MAXP && room.occupied(v as usize) && w.alive[v as usize] == 1 {
            count[v as usize] += 1;
        } else {
            skip += 1;
        }
    }
    let max = *count.iter().max().unwrap();
    let top: Vec<usize> = (0..MAXP).filter(|&i| count[i] == max && max > 0).collect();
    room.ejected = NO_SEAT;
    room.ejected_role = ROLE_UNKNOWN;
    if top.len() == 1 && max > skip {
        let e = top[0];
        w.alive[e] = 0;
        room.ejected = e as u8;
        room.ejected_role = w.role[e];
        room.alive_pub[e] = 0;
    }
    for i in 0..MAXP {
        room.last_votes[i] = w.votes[i];
    }
    room.phase = PH_RESULT;
    room.phase_end = now + RESULT_SECS;
}

fn after_result(room: &mut Room, w: &mut World) {
    if check_win(room, w) {
        return;
    }
    room.phase = PH_PLAY;
    room.caller = NO_SEAT;
    room.reported = NO_SEAT;
    for i in 0..MAXP {
        let (ox, oy) = SPAWN_RING[i];
        w.x[i] = (SPAWN_TX * TILE + HALF + ox) as i16;
        w.y[i] = (SPAWN_TY * TILE + HALF + oy) as i16;
        w.witness[i] = 0;
        w.votes[i] = VOTE_NONE;
        if w.role[i] == ROLE_MOLE && w.kill_cd[i] < KILL_CD_AFTER_MEETING {
            w.kill_cd[i] = KILL_CD_AFTER_MEETING;
        }
        w.bot_goal[i] = 255;
    }
}

// ---------------------------------------------------------------- bots

fn bot_think(room: &Room, w: &mut World, i: usize) {
    let mut input = 0u8;
    let alive = w.alive[i] == 1;
    if w.role[i] == ROLE_MOLE && !alive {
        w.input[i] = 0;
        return;
    }
    // crew who see a body report it
    if alive && w.role[i] == ROLE_CREW {
        for b in 0..MAXP {
            if w.body[b] == 1 && can_see(w.x[i] as i32, w.y[i] as i32, w.body_x[b] as i32, w.body_y[b] as i32) {
                if d2(w.x[i] as i32, w.y[i] as i32, w.body_x[b] as i32, w.body_y[b] as i32) <= REPORT_R * REPORT_R {
                    w.edge[i] |= IN_REPORT;
                    w.input[i] = 0;
                    return;
                }
                // walk to it: aim the goal at the closest station-free point = the body itself
                input = toward(w.x[i] as i32, w.y[i] as i32, w.body_x[b] as i32, w.body_y[b] as i32);
                w.input[i] = input;
                return;
            }
        }
    }
    // Moles cuff when nobody else is looking
    if alive && w.role[i] == ROLE_MOLE && w.kill_cd[i] == 0 {
        if let Some(v) = cuff_target(room, w, i) {
            let seen = (0..MAXP).any(|j| {
                j != i && j != v && room.occupied(j) && w.alive[j] == 1 && w.role[j] == ROLE_CREW
                    && can_see(w.x[j] as i32, w.y[j] as i32, w.x[i] as i32, w.y[i] as i32)
            });
            if !seen {
                w.edge[i] |= IN_CUFF;
            }
        }
    }
    // a Mole whose cuff is nearly ready goes hunting: shadow the closest crew member
    if alive && w.role[i] == ROLE_MOLE && w.kill_cd[i] < HUNT_BELOW_CD {
        let (x, y) = (w.x[i] as i32, w.y[i] as i32);
        let mut prey: Option<(usize, i32)> = None;
        for j in 0..MAXP {
            if room.occupied(j) && w.alive[j] == 1 && w.role[j] == ROLE_CREW {
                let dd = d2(x, y, w.x[j] as i32, w.y[j] as i32);
                if prey.map_or(true, |(_, b)| dd < b) {
                    prey = Some((j, dd));
                }
            }
        }
        if let Some((j, _)) = prey {
            let (px, py) = (w.x[j] as i32, w.y[j] as i32);
            if can_see(x, y, px, py) {
                w.input[i] = if d2(x, y, px, py) <= (CUFF_R - 12) * (CUFF_R - 12) { 0 } else { toward(x, y, px, py) };
            } else {
                let st = nearest_station(px, py);
                let (sx, sy) = station_xy(st);
                w.input[i] = flow_dir(x, y, st as usize, sx, sy);
            }
            return;
        }
    }
    // pick a goal: the next unfinished task (crew), or wander between stations
    let crew = w.role[i] == ROLE_CREW;
    let mut goal = w.bot_goal[i];
    if crew {
        goal = 255;
        for t in 0..TASKS_PER {
            if w.task_prog[i * TASKS_PER + t] != 255 {
                goal = w.task_st[i * TASKS_PER + t];
                break;
            }
        }
        if goal == 255 {
            goal = w.bot_goal[i];
        }
    }
    if goal == 255 || goal as usize >= N_STATIONS {
        goal = rng_below(&mut w.rng, N_STATIONS as u64) as u8;
    }
    w.bot_goal[i] = goal;
    let (gx, gy) = station_xy(goal);
    let (x, y) = (w.x[i] as i32, w.y[i] as i32);
    if d2(x, y, gx, gy) <= (USE_R - 8) * (USE_R - 8) {
        // at the station: work (crew) or pretend to (Moles), then move on
        if crew && near_task(w, i).is_some() {
            input |= IN_USE;
        } else if w.bot_wait[i] > 0 {
            w.bot_wait[i] -= 1;
        } else {
            w.bot_goal[i] = rng_below(&mut w.rng, N_STATIONS as u64) as u8;
            w.bot_wait[i] = 15 + rng_below(&mut w.rng, 30) as u8;
        }
    } else {
        input |= flow_dir(x, y, goal as usize, gx, gy);
    }
    w.input[i] = input;
}

fn nearest_station(x: i32, y: i32) -> u8 {
    let mut best = (0u8, i32::MAX);
    for s in 0..N_STATIONS {
        let (sx, sy) = station_xy(s as u8);
        let dd = d2(x, y, sx, sy);
        if dd < best.1 {
            best = (s as u8, dd);
        }
    }
    best.0
}

/// 8-way direction code from a delta.
fn toward(x: i32, y: i32, tx: i32, ty: i32) -> u8 {
    let (dx, dy) = ((tx - x).signum(), (ty - y).signum());
    let dx = if (tx - x).abs() < 4 { 0 } else { dx };
    let dy = if (ty - y).abs() < 4 { 0 } else { dy };
    match (dx, dy) {
        (0, -1) => 1,
        (1, -1) => 2,
        (1, 0) => 3,
        (1, 1) => 4,
        (0, 1) => 5,
        (-1, 1) => 6,
        (-1, 0) => 7,
        (-1, -1) => 8,
        _ => 0,
    }
}

/// Follow the precomputed BFS field toward `flow`; keep centred in corridors.
fn flow_dir(x: i32, y: i32, flow: usize, gx: i32, gy: i32) -> u8 {
    let (tx, ty) = ((x / TILE) as usize, (y / TILE) as usize);
    if tx >= MAP_W || ty >= MAP_H {
        return 0;
    }
    let f = FLOW[flow][ty * MAP_W + tx];
    let (cx, cy) = (tx as i32 * TILE + HALF, ty as i32 * TILE + HALF);
    match f {
        0 => toward(x, y, gx, gy),
        1 | 3 => {
            let vy = if f == 1 { -1 } else { 1 };
            let vx = if (cx - x).abs() > 3 { (cx - x).signum() } else { 0 };
            dir_code(vx, vy)
        }
        _ => {
            let vx = if f == 2 { 1 } else { -1 };
            let vy = if (cy - y).abs() > 3 { (cy - y).signum() } else { 0 };
            dir_code(vx, vy)
        }
    }
}

fn dir_code(dx: i32, dy: i32) -> u8 {
    match (dx, dy) {
        (0, -1) => 1,
        (1, -1) => 2,
        (1, 0) => 3,
        (1, 1) => 4,
        (0, 1) => 5,
        (-1, 1) => 6,
        (-1, 0) => 7,
        (-1, -1) => 8,
        _ => 0,
    }
}

// ---------------------------------------------------------------- views

pub fn write_views(room: &Room, w: &World, views: &mut [&mut View]) {
    for (i, v) in views.iter_mut().enumerate() {
        if i >= MAXP {
            break;
        }
        write_view(room, w, i, v);
    }
}

pub fn write_view(room: &Room, w: &World, i: usize, v: &mut View) {
    v.tick = w.tick;
    if !room.occupied(i) || w.dealt == 0 || w.role[i] == ROLE_UNKNOWN || room.phase == PH_LOBBY || room.phase == PH_STARTING {
        v.role = ROLE_UNKNOWN;
        v.alive = 0;
        v.partner_mask = 0;
        v.flags = 0;
        v.vis_mask = 0;
        v.ghost_mask = 0;
        v.body_mask = 0;
        v.near_station = 255;
        v.witness = 0;
        v.kill_cd = 0;
        return;
    }
    let (mx, my) = (w.x[i] as i32, w.y[i] as i32);
    let me_alive = w.alive[i] == 1;
    v.role = w.role[i];
    v.alive = w.alive[i];
    v.me_x = w.x[i];
    v.me_y = w.y[i];
    v.kill_cd = w.kill_cd[i] as u32;
    v.partner_mask = 0;
    if w.role[i] == ROLE_MOLE {
        for j in 0..MAXP {
            if j != i && w.role[j] == ROLE_MOLE {
                v.partner_mask |= 1 << j;
            }
        }
    }
    let (mut vis, mut ghosts, mut bodies) = (0u8, 0u8, 0u8);
    for j in 0..MAXP {
        v.vis_x[j] = 0;
        v.vis_y[j] = 0;
        v.body_x[j] = 0;
        v.body_y[j] = 0;
        if j == i || !room.occupied(j) || w.role[j] == ROLE_UNKNOWN {
            continue;
        }
        let (jx, jy) = (w.x[j] as i32, w.y[j] as i32);
        let j_alive = w.alive[j] == 1;
        let visible = if !me_alive {
            true // ghosts see everyone
        } else {
            j_alive && can_see(mx, my, jx, jy) // the living never see ghosts
        };
        if visible {
            vis |= 1 << j;
            if !j_alive {
                ghosts |= 1 << j;
            }
            v.vis_x[j] = w.x[j];
            v.vis_y[j] = w.y[j];
        }
        if w.body[j] == 1 && (!me_alive || can_see(mx, my, w.body_x[j] as i32, w.body_y[j] as i32)) {
            bodies |= 1 << j;
            v.body_x[j] = w.body_x[j];
            v.body_y[j] = w.body_y[j];
        }
    }
    v.vis_mask = vis;
    v.ghost_mask = ghosts;
    v.body_mask = bodies;
    let mut flags = 0u8;
    if room.phase == PH_PLAY {
        if w.role[i] == ROLE_CREW && near_task(w, i).is_some() {
            flags |= F_CAN_USE;
        }
        if me_alive && report_target(w, i).is_some() {
            flags |= F_CAN_REPORT;
        }
        if me_alive && w.role[i] == ROLE_MOLE && w.kill_cd[i] == 0 && cuff_target(room, w, i).is_some() {
            flags |= F_CAN_CUFF;
        }
        if me_alive && w.emergency_used[i] == 0 && at_button(w, i) {
            flags |= F_AT_BUTTON;
        }
    }
    v.flags = flags;
    v.near_station = near_station_any(w, i);
    for t in 0..TASKS_PER {
        v.task_st[t] = w.task_st[i * TASKS_PER + t];
        v.task_prog[t] = w.task_prog[i * TASKS_PER + t];
    }
    v.witness = w.witness[i];
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use bytemuck::Zeroable;

    fn room_with(n: usize, bots: bool) -> Room {
        let mut r = Room::zeroed();
        for i in 0..n {
            if bots {
                r.is_bot[i] = 1;
            } else {
                r.players[i] = anchor_lang::prelude::Pubkey::new_unique();
            }
        }
        r
    }

    fn views() -> Vec<View> {
        (0..MAXP).map(|_| View::zeroed()).collect()
    }

    #[test]
    fn map_tables_are_sane() {
        assert_eq!(TILES.len(), MAP_W * MAP_H);
        assert_eq!(tile_at(SPAWN_TX * TILE + HALF, SPAWN_TY * TILE + HALF), LOBBY_ROOM);
        for s in 0..N_STATIONS {
            let (x, y) = station_xy(s as u8);
            assert!(walkable(x, y), "station {s} must be walkable");
        }
        for (ox, oy) in SPAWN_RING {
            assert!(walkable(SPAWN_TX * TILE + HALF + ox, SPAWN_TY * TILE + HALF + oy));
        }
        assert_eq!(tile_at(BUTTON_X, BUTTON_Y), LOBBY_ROOM);
    }

    #[test]
    fn deal_gives_one_mole_for_six_and_two_for_eight() {
        for (n, moles) in [(4usize, 1usize), (6, 1), (7, 2), (8, 2)] {
            let mut r = room_with(n, true);
            let mut w = World::zeroed();
            deal(&mut r, &mut w, [n as u8; 32]);
            let m = (0..MAXP).filter(|&i| w.role[i] == ROLE_MOLE).count();
            let c = (0..MAXP).filter(|&i| w.role[i] == ROLE_CREW).count();
            assert_eq!(m, moles);
            assert_eq!(c, n - moles);
            assert_eq!(r.task_total as usize, (n - moles) * TASKS_PER);
            assert_eq!(r.phase, PH_PLAY);
        }
    }

    #[test]
    fn different_seeds_pick_different_moles() {
        let mut seen = [0u32; MAXP];
        for s in 0..64u8 {
            let mut r = room_with(8, true);
            let mut w = World::zeroed();
            let mut seed = [0u8; 32];
            seed[0] = s;
            seed[9] = s.wrapping_mul(7);
            deal(&mut r, &mut w, seed);
            for i in 0..MAXP {
                if w.role[i] == ROLE_MOLE {
                    seen[i] += 1;
                }
            }
        }
        assert!(seen.iter().all(|&c| c > 0), "every seat should be the Mole sometimes: {seen:?}");
    }

    #[test]
    fn walls_stop_movement() {
        let (mut x, mut y) = ((1 * TILE + HALF) as i16, (1 * TILE + HALF) as i16);
        for _ in 0..50 {
            step(&mut x, &mut y, 1, SPEED); // north into the outer wall
        }
        assert!(walkable(x as i32, y as i32));
        assert_eq!(tile_at(x as i32, y as i32), 1);
    }

    #[test]
    fn vision_is_per_room() {
        // two points in the lobby see each other; lobby and vault don't
        let (lx, ly) = (15 * TILE + HALF, 10 * TILE + HALF);
        let (lx2, ly2) = (24 * TILE + HALF, 14 * TILE + HALF);
        let (vx, vy) = (34 * TILE + HALF, 2 * TILE + HALF);
        assert!(can_see(lx, ly, lx2, ly2));
        assert!(!can_see(lx, ly, vx, vy));
    }

    #[test]
    fn crew_bots_finish_tasks_and_win() {
        // all bots: crew must eventually finish every task or the Mole wins; either way it ends
        let mut r = room_with(5, true);
        let mut w = World::zeroed();
        deal(&mut r, &mut w, [3u8; 32]);
        let mut vs = views();
        let mut now = 1_000;
        let mut ticks = 0;
        while r.phase != PH_ENDED && ticks < 60_000 {
            let mut refs: Vec<&mut View> = vs.iter_mut().collect();
            tick(&mut r, &mut w, &mut refs, now);
            ticks += 1;
            if ticks % 10 == 0 {
                now += 1;
            }
        }
        assert_eq!(r.phase, PH_ENDED, "game must end (ticks {ticks}, tasks {}/{})", r.task_done, r.task_total);
        assert!(r.winner == TEAM_CREW || r.winner == TEAM_MOLE);
        eprintln!("bots-only game: {ticks} ticks, tasks {}/{}, winner {}", r.task_done, r.task_total, r.winner);
    }

    #[test]
    fn many_bot_games_are_balanced_and_progress() {
        let (mut crew_wins, mut mole_wins, mut task_sum, mut meetings) = (0, 0, 0u32, 0u32);
        for seed in 0..40u8 {
            let n = 4 + (seed as usize % 5);
            let mut r = room_with(n, true);
            let mut w = World::zeroed();
            let mut s = [seed; 32];
            s[5] = seed.wrapping_mul(31);
            deal(&mut r, &mut w, s);
            let mut vs = views();
            let (mut now, mut ticks) = (0i64, 0);
            while r.phase != PH_ENDED && ticks < 60_000 {
                let before = r.phase;
                let mut refs: Vec<&mut View> = vs.iter_mut().collect();
                tick(&mut r, &mut w, &mut refs, now);
                if before == PH_PLAY && r.phase == PH_MEETING {
                    meetings += 1;
                }
                ticks += 1;
                if ticks % 10 == 0 {
                    now += 1;
                }
            }
            assert_eq!(r.phase, PH_ENDED, "seed {seed} stalled");
            task_sum += r.task_done;
            if r.winner == TEAM_CREW { crew_wins += 1 } else { mole_wins += 1 }
        }
        eprintln!("40 bot games: crew {crew_wins} / mole {mole_wins}, tasks done {task_sum}, meetings {meetings}");
        assert!(task_sum > 0, "crew bots must actually complete tasks");
        assert!(crew_wins > 0 && mole_wins > 0, "both sides must be able to win");
        assert!(meetings > 0, "bots must report bodies");
    }

    #[test]
    fn cuff_leaves_a_body_and_witness() {
        let mut r = room_with(4, false);
        let mut w = World::zeroed();
        deal(&mut r, &mut w, [9u8; 32]);
        let m = (0..MAXP).find(|&i| w.role[i] == ROLE_MOLE).unwrap();
        let crew: Vec<usize> = (0..4).filter(|&i| i != m).collect();
        // put mole + victim + witness together in the lobby
        let (v, wit) = (crew[0], crew[1]);
        w.x[m] = 600; w.y[m] = 360;
        w.x[v] = 620; w.y[v] = 360;
        w.x[wit] = 700; w.y[wit] = 400;
        w.kill_cd[m] = 0;
        w.edge[m] = IN_CUFF;
        let mut vs = views();
        let mut refs: Vec<&mut View> = vs.iter_mut().collect();
        tick(&mut r, &mut w, &mut refs, 10);
        assert_eq!(w.alive[v], 0);
        assert_eq!(w.body[v], 1);
        assert_eq!(w.witness[wit], m as u8 + 1);
        // the public room doesn't know yet
        assert_eq!(r.alive_pub[v], 1);
        // the witness's view shows the body; the victim is now a ghost
        assert_ne!(vs[wit].body_mask & (1 << v), 0);
        assert_eq!(vs[v].alive, 0);
    }

    #[test]
    fn meeting_ejects_the_majority_and_reveals_the_dead() {
        let mut r = room_with(5, false);
        let mut w = World::zeroed();
        deal(&mut r, &mut w, [5u8; 32]);
        let m = (0..MAXP).find(|&i| w.role[i] == ROLE_MOLE).unwrap();
        start_meeting(&mut r, &mut w, 0, NO_SEAT, 100);
        for i in 0..5 {
            cast_vote(&mut r, &mut w, i, if i == m { VOTE_SKIP } else { m as u8 });
        }
        let mut vs = views();
        let mut refs: Vec<&mut View> = vs.iter_mut().collect();
        tick(&mut r, &mut w, &mut refs, 101);
        assert_eq!(r.phase, PH_RESULT);
        assert_eq!(r.ejected, m as u8);
        assert_eq!(r.ejected_role, ROLE_MOLE);
        let mut refs: Vec<&mut View> = vs.iter_mut().collect();
        tick(&mut r, &mut w, &mut refs, 101 + RESULT_SECS);
        assert_eq!(r.phase, PH_ENDED);
        assert_eq!(r.winner, TEAM_CREW);
        assert_eq!(r.roles_pub[m], ROLE_MOLE);
    }

    #[test]
    fn a_tie_ejects_nobody() {
        let mut r = room_with(4, false);
        let mut w = World::zeroed();
        deal(&mut r, &mut w, [6u8; 32]);
        start_meeting(&mut r, &mut w, 0, NO_SEAT, 0);
        cast_vote(&mut r, &mut w, 0, 1);
        cast_vote(&mut r, &mut w, 1, 0);
        cast_vote(&mut r, &mut w, 2, VOTE_SKIP);
        cast_vote(&mut r, &mut w, 3, VOTE_SKIP);
        tally(&mut r, &mut w, 1);
        assert_eq!(r.ejected, NO_SEAT);
    }

    #[test]
    fn an_idle_crew_loses_to_the_time_lock() {
        // humans who never work: the heist still ends (the Mole wins on time)
        let mut r = room_with(4, false);
        let mut w = World::zeroed();
        deal(&mut r, &mut w, [4u8; 32]);
        let mut vs = views();
        let mut ticks = 0;
        while r.phase != PH_ENDED && ticks < 20_000 {
            let mut refs: Vec<&mut View> = vs.iter_mut().collect();
            tick(&mut r, &mut w, &mut refs, 0);
            ticks += 1;
        }
        assert_eq!(r.phase, PH_ENDED);
        assert_eq!(r.winner, TEAM_MOLE);
        assert_eq!(w.tick, HEIST_TICKS);
    }

    #[test]
    fn living_players_never_see_ghosts() {
        let mut r = room_with(4, false);
        let mut w = World::zeroed();
        deal(&mut r, &mut w, [8u8; 32]);
        w.alive[1] = 0;
        let mut vs = views();
        write_views(&r, &w, &mut vs.iter_mut().collect::<Vec<_>>());
        for i in [0usize, 2, 3] {
            if w.alive[i] == 1 {
                assert_eq!(vs[i].vis_mask & (1 << 1), 0);
            }
        }
        // and the ghost sees everyone
        assert_eq!(vs[1].vis_mask & 0b1101, 0b1101);
    }
}
