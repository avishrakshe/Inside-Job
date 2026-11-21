use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("bad account")]
    BadAccount,
    #[msg("bad seat")]
    BadSeat,
    #[msg("seat taken")]
    SeatTaken,
    #[msg("already seated")]
    AlreadySeated,
    #[msg("not seated")]
    NotSeated,
    #[msg("room is not ready")]
    NotReady,
    #[msg("wrong phase")]
    WrongPhase,
    #[msg("only the host can do that")]
    NotHost,
    #[msg("need at least 4 players (bots count)")]
    NotEnoughPlayers,
    #[msg("too early")]
    TooEarly,
    #[msg("dead players cannot do that")]
    Dead,
    #[msg("bad vote")]
    BadVote,
    #[msg("message too long")]
    TooLong,
    #[msg("staked table: buy a ticket on Solana first (or the rollup hasn't seen it yet; retry)")]
    NoTicket,
    #[msg("this table is playing for a different pot")]
    PotMismatch,
    #[msg("not a staked table")]
    NotStaked,
    #[msg("the pot is already settled or refunded")]
    PotClosed,
    #[msg("the pot is full")]
    PotFull,
    #[msg("you already hold a ticket for this pot")]
    DuplicateTicket,
    #[msg("the committed room does not match this pot (not finished yet?)")]
    NotSettleable,
    #[msg("a wallet account is missing")]
    MissingWallet,
}
