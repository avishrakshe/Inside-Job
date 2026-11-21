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
    #[msg("wrong token mint, or not an SPL token account")]
    BadMint,
    #[msg("tip must be between 0.1 and 5 USDC")]
    TipRange,
    #[msg("the Tip Line for this heist is full")]
    MarketFull,
    #[msg("the Tip Line for this heist is closed")]
    MarketClosed,
    #[msg("this wallet already tipped this heist")]
    DuplicateTip,
    #[msg("no tip for this session key (or the rollup hasn't seen it yet; retry)")]
    NoTip,
    #[msg("players in this crew can't tip on it")]
    Insider,
    #[msg("pick a living seat in this heist")]
    BadPick,
    #[msg("the Tip Line hasn't been resolved yet")]
    NotResolved,
    #[msg("already paid")]
    AlreadyClaimed,
    #[msg("the deal is already committed")]
    AlreadyCommitted,
}
