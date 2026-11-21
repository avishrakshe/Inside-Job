//! Turns `src/map.txt` + `src/stations.txt` into compile-time tables:
//! the room id of every tile, the station list, and one BFS flow field per
//! station (plus the lobby spawn) that on-chain bots follow. The web client
//! reads the very same two text files, so map and rules can't drift apart.
use std::collections::VecDeque;
use std::fmt::Write as _;

const W: usize = 40;
const H: usize = 24;
pub const SPAWN: (usize, usize) = (19, 11);

fn room_of(c: char) -> u8 {
    match c {
        '#' => 0,
        'S' => 1, // security
        'R' => 2, // server room
        'V' => 3, // vault
        'L' => 4, // lobby
        'H' => 5, // laser hall
        'D' => 6, // deposit boxes
        'W' => 7, // sewer
        '.' => 8, // corridor
        other => panic!("unknown map char {other:?}"),
    }
}

fn main() {
    // the program builds from its own dir; tools/replay (the WASM replay) reuses this script
    let dir = if std::path::Path::new("src/map.txt").exists() { "src" } else { "../../programs/inside-job/src" };
    println!("cargo:rerun-if-changed={dir}/map.txt");
    println!("cargo:rerun-if-changed={dir}/stations.txt");
    let map = std::fs::read_to_string(format!("{dir}/map.txt")).expect("map.txt");
    let rows: Vec<&str> = map.lines().map(|l| l.trim_end_matches('\r')).filter(|l| !l.is_empty()).collect();
    assert_eq!(rows.len(), H, "map must have {H} rows");
    let mut tiles = vec![0u8; W * H];
    for (y, row) in rows.iter().enumerate() {
        assert_eq!(row.chars().count(), W, "row {y} must be {W} wide");
        for (x, c) in row.chars().enumerate() {
            tiles[y * W + x] = room_of(c);
        }
    }
    let st_txt = std::fs::read_to_string(format!("{dir}/stations.txt")).expect("stations.txt");
    let mut stations: Vec<(usize, usize)> = Vec::new();
    for line in st_txt.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        let mut it = line.split_whitespace();
        let x: usize = it.next().unwrap().parse().unwrap();
        let y: usize = it.next().unwrap().parse().unwrap();
        assert!(tiles[y * W + x] != 0 && tiles[y * W + x] != 8, "station {x},{y} must be inside a room");
        stations.push((x, y));
    }
    assert!(tiles[SPAWN.1 * W + SPAWN.0] == 4, "spawn must be in the lobby");

    // flow fields: for every walkable tile, which neighbour gets you closer to the target
    let mut targets = stations.clone();
    targets.push(SPAWN);
    let mut flows: Vec<Vec<u8>> = Vec::new();
    for &(tx, ty) in &targets {
        let mut dist = vec![u16::MAX; W * H];
        let mut q = VecDeque::new();
        dist[ty * W + tx] = 0;
        q.push_back((tx, ty));
        while let Some((x, y)) = q.pop_front() {
            let d = dist[y * W + x];
            let n = [(x as i32, y as i32 - 1), (x as i32 + 1, y as i32), (x as i32, y as i32 + 1), (x as i32 - 1, y as i32)];
            for (nx, ny) in n {
                if nx < 0 || ny < 0 || nx >= W as i32 || ny >= H as i32 {
                    continue;
                }
                let (nx, ny) = (nx as usize, ny as usize);
                if tiles[ny * W + nx] == 0 || dist[ny * W + nx] != u16::MAX {
                    continue;
                }
                dist[ny * W + nx] = d + 1;
                q.push_back((nx, ny));
            }
        }
        let mut flow = vec![0u8; W * H];
        for y in 0..H {
            for x in 0..W {
                let i = y * W + x;
                if tiles[i] == 0 || dist[i] == 0 {
                    continue;
                }
                assert!(dist[i] != u16::MAX, "tile {x},{y} is unreachable");
                // 1 up, 2 right, 3 down, 4 left
                let cand = [(1u8, x as i32, y as i32 - 1), (2, x as i32 + 1, y as i32), (3, x as i32, y as i32 + 1), (4, x as i32 - 1, y as i32)];
                for (dir, nx, ny) in cand {
                    if nx < 0 || ny < 0 || nx >= W as i32 || ny >= H as i32 {
                        continue;
                    }
                    let j = ny as usize * W + nx as usize;
                    if tiles[j] != 0 && dist[j] < dist[i] {
                        flow[i] = dir;
                        break;
                    }
                }
            }
        }
        flows.push(flow);
    }

    let mut out = String::new();
    writeln!(out, "pub const MAP_W: usize = {W};").unwrap();
    writeln!(out, "pub const MAP_H: usize = {H};").unwrap();
    writeln!(out, "pub const N_STATIONS: usize = {};", stations.len()).unwrap();
    writeln!(out, "pub const SPAWN_TX: i32 = {};", SPAWN.0).unwrap();
    writeln!(out, "pub const SPAWN_TY: i32 = {};", SPAWN.1).unwrap();
    writeln!(out, "pub const SPAWN_FLOW: usize = {};", stations.len()).unwrap();
    writeln!(out, "pub static TILES: [u8; {}] = {:?};", W * H, tiles).unwrap();
    let sx: Vec<u8> = stations.iter().map(|s| s.0 as u8).collect();
    let sy: Vec<u8> = stations.iter().map(|s| s.1 as u8).collect();
    writeln!(out, "pub static STATION_TX: [u8; {}] = {:?};", sx.len(), sx).unwrap();
    writeln!(out, "pub static STATION_TY: [u8; {}] = {:?};", sy.len(), sy).unwrap();
    write!(out, "pub static FLOW: [[u8; {}]; {}] = [", W * H, flows.len()).unwrap();
    for f in &flows {
        write!(out, "{:?},", f).unwrap();
    }
    writeln!(out, "];").unwrap();
    let dst = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("mapgen.rs");
    std::fs::write(dst, out).unwrap();
}
