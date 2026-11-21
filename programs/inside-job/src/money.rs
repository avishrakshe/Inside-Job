//! The money rules, as pure functions so they're unit-tested on the host.
//!
//! * Every ticket is `stake` lamports. A ticket whose holder never took a seat is refunded.
//! * Seated humans on the winning team split everything the seated humans staked,
//!   evenly; the remainder (≤ n-1 lamports) goes to the first winner. No house rake.
//! * If no seated human is on the winning team (bots won), every seated human is refunded:
//!   there's nobody to pay, and the house never keeps a stake.
//! * Conservation: the sum of payouts is always exactly `stake * tickets`.
use crate::state::*;
use anchor_lang::prelude::*;

/// The seat a ticket played from, if its holder sat down with the session key it named.
pub fn seat_of_ticket(room: &Room, pot: &Pot, e: usize) -> Option<usize> {
    (0..MAXP).find(|&s| room.is_bot[s] == 0 && room.wallets[s] == pot.wallets[e] && room.players[s] == pot.sessions[e] && pot.wallets[e] != Pubkey::default())
}

pub fn on_winning_team(room: &Room, s: usize) -> bool {
    match room.roles_pub[s] {
        ROLE_MOLE => room.winner == TEAM_MOLE,
        ROLE_CREW => room.winner == TEAM_CREW,
        _ => false,
    }
}

/// Lamports owed to each ticket (index = ticket index in the Pot).
pub fn payouts(room: &Room, pot: &Pot) -> [u64; MAXP] {
    let n = (pot.n as usize).min(MAXP);
    let mut out = [0u64; MAXP];
    let mut seated = [false; MAXP];
    let mut winners: [usize; MAXP] = [0; MAXP];
    let mut n_win = 0usize;
    let mut n_seated = 0u64;
    for e in 0..n {
        match seat_of_ticket(room, pot, e) {
            None => out[e] = pot.stake, // never sat down: refund
            Some(s) => {
                seated[e] = true;
                n_seated += 1;
                if on_winning_team(room, s) {
                    winners[n_win] = e;
                    n_win += 1;
                }
            }
        }
    }
    if n_win == 0 {
        for e in 0..n {
            if seated[e] {
                out[e] = pot.stake;
            }
        }
        return out;
    }
    let pool = pot.stake * n_seated;
    let share = pool / n_win as u64;
    for &e in winners.iter().take(n_win) {
        out[e] = share;
    }
    out[winners[0]] += pool - share * n_win as u64;
    out
}

pub fn refunds(pot: &Pot) -> [u64; MAXP] {
    let mut out = [0u64; MAXP];
    for e in 0..(pot.n as usize).min(MAXP) {
        out[e] = pot.stake;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytemuck::Zeroable;

    fn pot_with(n: usize, stake: u64) -> Pot {
        let mut p = Pot { room_id: 1, nonce: 7, stake, created_at: 0, status: POT_OPEN, n: n as u8, bump: 0, winner: 255, wallets: [Pubkey::default(); MAXP], sessions: [Pubkey::default(); MAXP], paid: [0; MAXP] };
        for i in 0..n {
            p.wallets[i] = Pubkey::new_unique();
            p.sessions[i] = Pubkey::new_unique();
        }
        p
    }

    /// seat ticket `e` at seat `s` with role `r`
    fn seat(room: &mut Room, pot: &Pot, e: usize, s: usize, r: u8) {
        room.players[s] = pot.sessions[e];
        room.wallets[s] = pot.wallets[e];
        room.roles_pub[s] = r;
    }

    fn sum(a: &[u64; MAXP]) -> u64 {
        a.iter().sum()
    }

    #[test]
    fn crew_win_splits_the_pot_among_human_crew() {
        let pot = pot_with(4, 10_000_000);
        let mut room = Room::zeroed();
        room.roles_pub = [ROLE_UNKNOWN; MAXP];
        seat(&mut room, &pot, 0, 0, ROLE_CREW);
        seat(&mut room, &pot, 1, 1, ROLE_CREW);
        seat(&mut room, &pot, 2, 2, ROLE_MOLE);
        seat(&mut room, &pot, 3, 3, ROLE_CREW);
        room.winner = TEAM_CREW;
        let p = payouts(&room, &pot);
        assert_eq!(p[2], 0);
        assert_eq!(p[0] + p[1] + p[3], 40_000_000);
        assert_eq!(sum(&p), 40_000_000);
    }

    #[test]
    fn mole_win_takes_everything() {
        let pot = pot_with(5, 7_777_777);
        let mut room = Room::zeroed();
        room.roles_pub = [ROLE_UNKNOWN; MAXP];
        for e in 0..5 {
            seat(&mut room, &pot, e, e + 1, if e == 3 { ROLE_MOLE } else { ROLE_CREW });
        }
        room.winner = TEAM_MOLE;
        let p = payouts(&room, &pot);
        assert_eq!(p[3], 7_777_777 * 5);
        assert_eq!(sum(&p), 7_777_777 * 5);
    }

    #[test]
    fn unseated_tickets_are_refunded_and_bots_winning_refunds_everyone() {
        let pot = pot_with(3, 1_000);
        let mut room = Room::zeroed();
        room.roles_pub = [ROLE_UNKNOWN; MAXP];
        seat(&mut room, &pot, 0, 0, ROLE_CREW);
        seat(&mut room, &pot, 1, 1, ROLE_CREW);
        // ticket 2 never sat down; a bot is the Mole and wins
        room.is_bot[5] = 1;
        room.roles_pub[5] = ROLE_MOLE;
        room.winner = TEAM_MOLE;
        let p = payouts(&room, &pot);
        assert_eq!(p, [1_000, 1_000, 1_000, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn a_ticket_only_counts_with_the_session_key_it_named() {
        let pot = pot_with(2, 500);
        let mut room = Room::zeroed();
        room.roles_pub = [ROLE_UNKNOWN; MAXP];
        seat(&mut room, &pot, 0, 0, ROLE_CREW);
        // someone sat with ticket 1's wallet but a different session key
        room.players[1] = Pubkey::new_unique();
        room.wallets[1] = pot.wallets[1];
        room.roles_pub[1] = ROLE_MOLE;
        room.winner = TEAM_MOLE;
        let p = payouts(&room, &pot);
        // ticket 1 counts as unseated (refund); the seated crew lost to "no human winner" → refund
        assert_eq!(p[0], 500);
        assert_eq!(p[1], 500);
    }

    #[test]
    fn conservation_holds_for_every_shape() {
        // property-style sweep: every ticket count, stake, seating and winner
        for n in 1..=MAXP {
            for stake in [1u64, 3, 999, 10_000_000, 123_456_789] {
                for mask in 0u32..(1 << n) {
                    for winner in [TEAM_CREW, TEAM_MOLE] {
                        let pot = pot_with(n, stake);
                        let mut room = Room::zeroed();
                        room.roles_pub = [ROLE_UNKNOWN; MAXP];
                        for e in 0..n {
                            if mask & (1 << e) != 0 {
                                seat(&mut room, &pot, e, e, if (e + mask as usize) % 3 == 0 { ROLE_MOLE } else { ROLE_CREW });
                            }
                        }
                        room.winner = winner;
                        let p = payouts(&room, &pot);
                        assert_eq!(sum(&p), stake * n as u64, "n={n} stake={stake} mask={mask:b} winner={winner}");
                        assert!(p.iter().skip(n).all(|&x| x == 0));
                    }
                }
            }
        }
        let pot = pot_with(6, 42);
        assert_eq!(sum(&refunds(&pot)), 42 * 6);
    }
}
