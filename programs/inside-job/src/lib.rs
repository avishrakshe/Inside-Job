//! INSIDE JOB — a real-time heist of social deduction, sealed inside a MagicBlock
//! Private Ephemeral Rollup (Intel TDX).
//!
//! * `Room`  public lobby + scoreboard (delegated PDA, public permission)
//! * `World` the sealed truth — roles, positions, bodies, votes. Ephemeral account,
//!           private permission with ZERO members: nobody can read it until lights-on.
//! * `View`  per seat: only what that seat may know. Private to that seat's keys.
//! * VRF output is mixed with every player's sealed salt to deal the roles, so not even
//!   the randomness oracle can know who the Mole is.
//! * A crank ticks the game every 100 ms inside the TEE. No game server.
#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::access_control::instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi};
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, EphemeralPermission, Member, TX_LOGS_FLAG, TX_MESSAGE_FLAG};
use ephemeral_rollups_sdk::anchor::{delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{DELEGATION_PROGRAM_ID, EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use anchor_lang::solana_program::program::invoke;
use ephemeral_rollups_sdk::ephemeral_accounts::EphemeralAccount;
use ephemeral_rollups_sdk::vrf::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

pub mod errors;
pub mod magic;
pub mod money;
pub mod sim;
pub mod state;

use errors::GameError;
use state::*;

declare_id!("9B5TZmBnskcBrZ1QMCuojqrDEn1dEsb3oVNtgvZ73R2U");

/// Rooms may only be delegated to MagicBlock's TEE validator (same identity on devnet + mainnet).
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
pub const COMPUTE_BUDGET_PROGRAM: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
pub const TICK_MS: i64 = 100;
/// 15 minutes of ticks; clients can also tick (slot-gated) if the crank ever runs out.
pub const TICK_ITERATIONS: i64 = 9_000;
/// Devnet's TEE makes ~100 slots/s. Never tick faster than ~80 ms.
pub const MIN_TICK_SLOTS: u64 = 8;
/// If the VRF oracle hasn't answered after ~6 s, a seated player may deal from rollup state.
pub const FALLBACK_SLOTS: u64 = 600;
pub const HOST_AWAY_SECS: i64 = 90;
pub const MIN_PLAYERS: usize = 4;
pub const BOT_NAMES: [&[u8]; MAXP] = [b"VAULTBOT", b"LOCKPICK", b"GHOSTWIRE", b"SAFECRACK", b"TUMBLER", b"KEYRING", b"LOOKOUT", b"DRILLER"];
/// Anyone may refund an unsettled pot after this long (a heist's crank runs ≤ 15 min).
pub const REFUND_AFTER_SECS: i64 = 20 * 60;
pub const SETTLE_CU: u32 = 150_000;

#[ephemeral]
#[program]
pub mod inside_job {
    use super::*;

    // ------------------------------------------------------------ Solana (base layer)

    /// Create a room and pre-fund it: its lamports follow it into the rollup and pay
    /// for the sealed accounts and their permissions there.
    pub fn create_room(ctx: Context<CreateRoom>, room_id: u64, max_players: u8, prefund: u64, stake: u64) -> Result<()> {
        if prefund > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    Transfer { from: ctx.accounts.authority.to_account_info(), to: ctx.accounts.room.to_account_info() },
                ),
                prefund,
            )?;
        }
        let mut room = ctx.accounts.room.load_init()?;
        room.room_id = room_id;
        room.authority = ctx.accounts.authority.key();
        room.bump = ctx.bumps.room;
        room.max_players = max_players.clamp(MIN_PLAYERS as u8, MAXP as u8);
        room.phase = PH_LOBBY;
        room.winner = NO_SEAT;
        room.caller = NO_SEAT;
        room.reported = NO_SEAT;
        room.ejected = NO_SEAT;
        room.ejected_role = ROLE_UNKNOWN;
        room.last_votes = [VOTE_NONE; MAXP];
        room.roles_pub = [ROLE_UNKNOWN; MAXP];
        room.stake = stake;
        room.staked = (stake > 0) as u8;
        Ok(())
    }

    /// Staked tables: pay `stake` into this heist's Pot on Solana and name the session key
    /// that may use the ticket to take a seat in the rollup. The Pot is plain base-layer
    /// state (never delegated), so the money never leaves Solana.
    pub fn buy_ticket(ctx: Context<BuyTicket>, room_id: u64, nonce: u64, session: Pubkey) -> Result<()> {
        require!(nonce != 0, GameError::PotMismatch);
        let stake = {
            let ai = ctx.accounts.room.to_account_info();
            let owner_ok = *ai.owner == crate::ID || ai.owner.to_bytes() == DELEGATION_PROGRAM_ID.to_bytes();
            require!(owner_ok, GameError::BadAccount);
            let d = ai.try_borrow_data()?;
            require!(d.len() >= DISC + ROOM_SIZE && &d[..DISC] == Room::DISCRIMINATOR, GameError::BadAccount);
            let r: &Room = body_ref(&d);
            require!(r.room_id == room_id, GameError::BadAccount);
            r.stake
        };
        require!(stake > 0, GameError::NotStaked);
        let wallet = ctx.accounts.wallet.key();
        let pot = &mut ctx.accounts.pot;
        if pot.stake == 0 {
            pot.room_id = room_id;
            pot.nonce = nonce;
            pot.stake = stake;
            pot.created_at = Clock::get()?.unix_timestamp;
            pot.status = POT_OPEN;
            pot.bump = ctx.bumps.pot;
            pot.winner = 255;
        }
        require!(pot.status == POT_OPEN, GameError::PotClosed);
        require!((pot.n as usize) < MAXP, GameError::PotFull);
        require!(pot.entry_of(&wallet).is_none(), GameError::DuplicateTicket);
        let e = pot.n as usize;
        pot.wallets[e] = wallet;
        pot.sessions[e] = session;
        pot.n += 1;
        let amount = pot.stake;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer { from: ctx.accounts.wallet.to_account_info(), to: ctx.accounts.pot.to_account_info() },
            ),
            amount,
        )
    }

    /// Pay out a finished staked heist. Runs on Solana as the Magic Action that the TEE
    /// schedules at lights-on, right after it commits the Room. It is also permissionless:
    /// the outcome is read from the committed Room, so a direct call pays exactly the same.
    /// No oracle and no admin: the result was sealed program state all along.
    /// remaining accounts (any order): the Pot, the Room, every ticket holder's wallet.
    pub fn settle<'info>(ctx: Context<'info, Settle>, room_id: u64, nonce: u64) -> Result<()> {
        let rest = ctx.remaining_accounts;
        let (pot_ai, mut pot) = find_pot(rest, room_id, nonce)?;
        require!(pot.status == POT_OPEN, GameError::PotClosed);
        let (room_key, _) = Pubkey::find_program_address(&[ROOM_SEED, &room_id.to_le_bytes()], &crate::ID);
        let room_ai = rest.iter().find(|a| *a.key == room_key).ok_or(GameError::BadAccount)?;
        let owner_ok = *room_ai.owner == crate::ID || room_ai.owner.to_bytes() == DELEGATION_PROGRAM_ID.to_bytes();
        require!(owner_ok, GameError::BadAccount);
        let room: Room = {
            let d = room_ai.try_borrow_data()?;
            require!(d.len() >= DISC + ROOM_SIZE && &d[..DISC] == Room::DISCRIMINATOR, GameError::BadAccount);
            *body_ref::<Room>(&d)
        };
        let finished = room.phase == PH_ENDED || room.phase == PH_REVEALED;
        require!(room.room_id == room_id && room.pot_nonce == nonce && finished && room.winner <= TEAM_MOLE, GameError::NotSettleable);
        let pay = money::payouts(&room, &pot);
        pay_out(pot_ai, rest, &pot, &pay)?;
        pot.status = POT_SETTLED;
        pot.winner = room.winner;
        pot.paid = pay;
        let mut d = pot_ai.try_borrow_mut_data()?;
        pot.try_serialize(&mut &mut d[..])?;
        Ok(())
    }

    /// Never settled (crank died, nobody started, commit lost)? After 20 minutes anyone can
    /// return every ticket. Refund, never re-roll.
    pub fn refund<'info>(ctx: Context<'info, Settle>, room_id: u64, nonce: u64) -> Result<()> {
        let rest = ctx.remaining_accounts;
        let (pot_ai, mut pot) = find_pot(rest, room_id, nonce)?;
        require!(pot.status == POT_OPEN, GameError::PotClosed);
        require!(Clock::get()?.unix_timestamp >= pot.created_at + REFUND_AFTER_SECS, GameError::TooEarly);
        let pay = money::refunds(&pot);
        pay_out(pot_ai, rest, &pot, &pay)?;
        pot.status = POT_REFUNDED;
        pot.paid = pay;
        let mut d = pot_ai.try_borrow_mut_data()?;
        pot.try_serialize(&mut &mut d[..])?;
        Ok(())
    }

    /// Hand the room to the TEE validator.
    pub fn delegate_room(ctx: Context<DelegateRoom>, room_id: u64) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key()).unwrap_or(TEE_VALIDATOR);
        ctx.accounts.delegate_room(
            &ctx.accounts.payer,
            &[ROOM_SEED, &room_id.to_le_bytes()],
            DelegateConfig { validator: Some(validator), ..Default::default() },
        )?;
        Ok(())
    }

    // ------------------------------------------------------------ Rollup: setup (once per room)

    /// Create the sealed World (zero readers) and make the Room publicly readable.
    pub fn setup_core<'info>(ctx: Context<'info, SetupCore<'info>>) -> Result<()> {
        let (room_id, bump) = {
            let room = ctx.accounts.room.load()?;
            if room.ready_mask & READY_CORE != 0 {
                return Ok(());
            }
            (room.room_id, room.bump)
        };
        let rid = room_id.to_le_bytes();
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[bump]];
        let world_bump = expect_pda(&ctx.accounts.world, &[WORLD_SEED, &rid])?;
        let world_seeds: &[&[u8]] = &[WORLD_SEED, &rid, &[world_bump]];
        let room_ai = ctx.accounts.room.to_account_info();
        let world_ai = ctx.accounts.world.to_account_info();
        let vault = ctx.accounts.ephemeral_vault.to_account_info();
        if world_ai.data_is_empty() {
            EphemeralAccount::new(&room_ai, &world_ai, &vault)
                .with_signer_seeds(&[room_seeds, world_seeds])
                .create((DISC + WORLD_SIZE) as u32)?;
            let mut d = world_ai.try_borrow_mut_data()?;
            d[..DISC].copy_from_slice(World::DISCRIMINATOR);
            let w: &mut World = body_mut(&mut d);
            w.room_id = room_id;
            w.votes = [VOTE_NONE; MAXP];
            w.role = [ROLE_UNKNOWN; MAXP];
        }
        let wp = ctx.accounts.world_permission.to_account_info();
        expect_permission(&wp, world_ai.key)?;
        if wp.data_is_empty() {
            CreateEphemeralPermissionCpi {
                payer: room_ai.clone(),
                permissioned_account: world_ai.clone(),
                permission: wp,
                vault: vault.clone(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: true, members: vec![] },
            }
            .invoke_signed(&[room_seeds, world_seeds])?;
        }
        let rp = ctx.accounts.room_permission.to_account_info();
        expect_permission(&rp, room_ai.key)?;
        if rp.data_is_empty() {
            CreateEphemeralPermissionCpi {
                payer: room_ai.clone(),
                permissioned_account: room_ai.clone(),
                permission: rp,
                vault,
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: false, members: vec![] },
            }
            .invoke_signed(&[room_seeds])?;
        }
        ctx.accounts.room.load_mut()?.ready_mask |= READY_CORE;
        Ok(())
    }

    /// Create one seat's private View (no readers until someone sits down).
    pub fn setup_view<'info>(ctx: Context<'info, SeatAccounts<'info>>, seat: u8) -> Result<()> {
        require!((seat as usize) < MAXP, GameError::BadSeat);
        let bit = 1u32 << (8 + seat as u32);
        let (room_id, bump) = {
            let room = ctx.accounts.room.load()?;
            if room.ready_mask & bit != 0 {
                return Ok(());
            }
            (room.room_id, room.bump)
        };
        let rid = room_id.to_le_bytes();
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[bump]];
        let view_bump = expect_pda(&ctx.accounts.view, &[VIEW_SEED, &rid, &[seat]])?;
        let view_seeds: &[&[u8]] = &[VIEW_SEED, &rid, &[seat], &[view_bump]];
        let room_ai = ctx.accounts.room.to_account_info();
        let view_ai = ctx.accounts.view.to_account_info();
        let vault = ctx.accounts.ephemeral_vault.to_account_info();
        if view_ai.data_is_empty() {
            EphemeralAccount::new(&room_ai, &view_ai, &vault)
                .with_signer_seeds(&[room_seeds, view_seeds])
                .create((DISC + VIEW_SIZE) as u32)?;
            let mut d = view_ai.try_borrow_mut_data()?;
            d[..DISC].copy_from_slice(View::DISCRIMINATOR);
            let v: &mut View = body_mut(&mut d);
            v.room_id = room_id;
            v.seat = seat as u32;
            v.role = ROLE_UNKNOWN;
            v.near_station = 255;
        }
        let vp = ctx.accounts.view_permission.to_account_info();
        expect_permission(&vp, view_ai.key)?;
        if vp.data_is_empty() {
            CreateEphemeralPermissionCpi {
                payer: room_ai,
                permissioned_account: view_ai,
                permission: vp,
                vault,
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: true, members: vec![] },
            }
            .invoke_signed(&[room_seeds, view_seeds])?;
        }
        ctx.accounts.room.load_mut()?.ready_mask |= bit;
        Ok(())
    }

    // ------------------------------------------------------------ Rollup: lobby

    /// Take a seat. `signer` is the in-browser session key; `wallet` is who you play for.
    /// Your sealed salt goes straight into the World, where nobody can read it.
    /// Staked tables: `pot_nonce` names the base-layer Pot, passed as remaining account 0.
    /// The rollup reads the ticket from Solana and only seats the session key it names.
    pub fn join<'info>(ctx: Context<'info, SeatAccounts<'info>>, seat: u8, name: [u8; NAME_LEN], wallet: Pubkey, salt: [u8; 32], pot_nonce: u64) -> Result<()> {
        let s = seat as usize;
        require!(s < MAXP, GameError::BadSeat);
        let player = ctx.accounts.signer.key();
        let now = Clock::get()?.unix_timestamp;
        let (room_id, bump, members) = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.ready_mask == READY_ALL, GameError::NotReady);
            require!(room.phase == PH_LOBBY, GameError::WrongPhase);
            require!(s < room.max_players as usize, GameError::BadSeat);
            require!(room.seat_of(&player).is_none(), GameError::AlreadySeated);
            require!(!room.occupied(s), GameError::SeatTaken);
            if room.stake > 0 {
                require!(pot_nonce != 0 && wallet != Pubkey::default(), GameError::NoTicket);
                require!(room.pot_nonce == 0 || room.pot_nonce == pot_nonce, GameError::PotMismatch);
                let pot = read_pot(ctx.remaining_accounts.first().ok_or(GameError::NoTicket)?, room.room_id, pot_nonce)?;
                require!(pot.status == POT_OPEN, GameError::PotClosed);
                require!(pot.stake == room.stake, GameError::PotMismatch);
                let e = pot.entry_of(&wallet).ok_or(GameError::NoTicket)?;
                require_keys_eq!(pot.sessions[e], player, GameError::NoTicket);
                room.pot_nonce = pot_nonce;
            }
            room.players[s] = player;
            room.wallets[s] = if wallet == Pubkey::default() { player } else { wallet };
            room.names[s] = name;
            room.last_seen[s] = now as u32;
            room.alive_pub[s] = 1;
            room.n_humans = room.humans() as u8;
            let host_ok = room.seat_of(&room.host).map_or(false, |h| (now as u32).saturating_sub(room.last_seen[h]) < HOST_AWAY_SECS as u32);
            if !host_ok {
                room.host = player;
            }
            (room.room_id, room.bump, seat_members(&room, s))
        };
        {
            let mut d = ctx.accounts.world.try_borrow_mut_data()?;
            let w = world_mut(&mut d, room_id)?;
            w.salts[s] = salt;
            w.salt_set[s] = 1;
        }
        set_view_perm(&ctx, room_id, bump, seat, true, members)
    }

    /// Leave a seat (lobby or after the game). The seat's View is sealed again.
    pub fn leave<'info>(ctx: Context<'info, SeatAccounts<'info>>, seat: u8) -> Result<()> {
        let s = seat as usize;
        require!(s < MAXP, GameError::BadSeat);
        let player = ctx.accounts.signer.key();
        let now = Clock::get()?.unix_timestamp as u32;
        let (room_id, bump) = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.phase == PH_LOBBY || room.phase == PH_REVEALED, GameError::WrongPhase);
            // you can leave your own seat; anyone can clear a seat that's been idle for a while
            let mine = room.players[s] == player;
            let stale = room.players[s] != Pubkey::default() && now.saturating_sub(room.last_seen[s]) >= HOST_AWAY_SECS as u32 * 2;
            require!(mine || stale, GameError::NotSeated);
            room.clear_seat(s);
            room.n_humans = room.humans() as u8;
            if room.host == player || room.seat_of(&room.host).is_none() {
                room.host = (0..MAXP).find(|&i| room.players[i] != Pubkey::default()).map(|i| room.players[i]).unwrap_or_default();
            }
            (room.room_id, room.bump)
        };
        set_view_perm(&ctx, room_id, bump, seat, true, vec![])
    }

    /// Lobby heartbeat + a fresh sealed salt for the next deal (salts are revealed at lights-on).
    pub fn set_salt(ctx: Context<Act>, salt: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp as u32;
        let (s, room_id) = {
            let room = ctx.accounts.room.load()?;
            require!(room.phase == PH_LOBBY, GameError::WrongPhase);
            (room.seat_of(&ctx.accounts.player.key()).ok_or(GameError::NotSeated)?, room.room_id)
        };
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut d, room_id)?;
        w.salts[s] = salt;
        w.salt_set[s] = 1;
        drop(d);
        if let Ok(mut room) = ctx.accounts.room.load_mut() {
            room.last_seen[s] = now;
        }
        Ok(())
    }

    // ------------------------------------------------------------ Rollup: the heist

    /// Host starts: bots fill empty seats, VRF is requested, the 100 ms crank is scheduled.
    /// remaining accounts: view0..view7 (writable).
    pub fn start_match<'info>(ctx: Context<'info, StartMatch<'info>>, fill_to: u8, client_seed: u8) -> Result<()> {
        let player = ctx.accounts.payer.key();
        let clock = Clock::get()?;
        let now = clock.unix_timestamp as u32;
        let (task_id, room_id) = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.ready_mask == READY_ALL, GameError::NotReady);
            require!(room.phase == PH_LOBBY, GameError::WrongPhase);
            let me = room.seat_of(&player).ok_or(GameError::NotSeated)?;
            let host_away = room.seat_of(&room.host).map_or(true, |h| now.saturating_sub(room.last_seen[h]) >= HOST_AWAY_SECS as u32);
            require!(room.host == player || host_away, GameError::NotHost);
            require!(room.stake == 0 || room.pot_nonce != 0, GameError::NoTicket);
            room.last_seen[me] = now;
            let want = (fill_to as usize).max(MIN_PLAYERS).min(room.max_players as usize);
            let mut total = (0..MAXP).filter(|&i| room.occupied(i)).count();
            for i in 0..room.max_players as usize {
                if total >= want {
                    break;
                }
                if !room.occupied(i) {
                    room.is_bot[i] = 1;
                    let mut nm = [0u8; NAME_LEN];
                    let label = BOT_NAMES[i];
                    nm[..label.len().min(NAME_LEN)].copy_from_slice(&label[..label.len().min(NAME_LEN)]);
                    room.names[i] = nm;
                    room.alive_pub[i] = 1;
                    total += 1;
                }
            }
            require!(total >= MIN_PLAYERS, GameError::NotEnoughPlayers);
            room.match_no = room.match_no.wrapping_add(1);
            room.phase = PH_STARTING;
            room.start_slot = clock.slot;
            room.last_tick_slot = 0;
            room.seed_state = 0;
            room.winner = NO_SEAT;
            room.task_id = ((room.room_id % 1_000_000) * 10_000 + clock.slot % 10_000) as i64;
            (room.task_id, room.room_id)
        };
        {
            let mut d = ctx.accounts.world.try_borrow_mut_data()?;
            let w = world_mut(&mut d, room_id)?;
            w.dealt = 0;
            w.role = [ROLE_UNKNOWN; MAXP];
            w.alive = [0; MAXP];
        }
        // 1. VRF — the oracle's output is only half of the deal; the salts are the other half
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: crate::instruction::Deal::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: ctx.accounts.room.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.world.key(), is_signer: false, is_writable: true },
            ]),
            ..Default::default()
        });
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        // 2. crank: tick every 100 ms inside the TEE
        require!(ctx.remaining_accounts.len() >= MAXP, GameError::BadAccount);
        let rid = room_id.to_le_bytes();
        for (i, v) in ctx.remaining_accounts.iter().take(MAXP).enumerate() {
            let (key, _) = Pubkey::find_program_address(&[VIEW_SEED, &rid, &[i as u8]], &crate::ID);
            require_keys_eq!(v.key(), key, GameError::BadAccount);
        }
        let mut metas = vec![AccountMeta::new(ctx.accounts.room.key(), false), AccountMeta::new(ctx.accounts.world.key(), false)];
        let mut accs = vec![ctx.accounts.room.to_account_info(), ctx.accounts.world.to_account_info()];
        for v in ctx.remaining_accounts.iter().take(MAXP) {
            metas.push(AccountMeta::new(v.key(), false));
            accs.push(v.clone());
        }
        let mut cu = vec![2u8];
        cu.extend_from_slice(&1_400_000u32.to_le_bytes());
        let budget_ix = Instruction { program_id: COMPUTE_BUDGET_PROGRAM, accounts: vec![], data: cu };
        let tick_ix = Instruction { program_id: crate::ID, accounts: metas, data: anchor_lang::InstructionData::data(&crate::instruction::Tick {}) };
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &ctx.accounts.magic_program,
            instruction_accounts: &accs,
            args: ScheduleTaskArgs { task_id, execution_interval_millis: TICK_MS, iterations: TICK_ITERATIONS, instructions: vec![budget_ix, tick_ix] },
        }
        .invoke()?;
        Ok(())
    }

    /// VRF callback. Roles = H(vrf ‖ every seat's sealed salt ‖ room ‖ match): the oracle
    /// can't know the Mole (it never sees the salts) and no player can steer it.
    pub fn deal(ctx: Context<Deal>, randomness: [u8; 32]) -> Result<()> {
        let mut room = ctx.accounts.room.load_mut()?;
        if room.phase != PH_STARTING {
            return Ok(()); // late or duplicate callback: ignore
        }
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut d, room.room_id)?;
        let mixed = mix_seed(&room, w, &randomness);
        w.vrf = randomness;
        sim::deal(&mut room, w, mixed);
        room.seed_state = 1;
        Ok(())
    }

    /// If the oracle is silent for ~6 s, any seated player can deal from rollup state.
    /// Still mixed with the sealed salts; flagged in the UI as not VRF-grade.
    pub fn fallback_deal(ctx: Context<Act>) -> Result<()> {
        let clock = Clock::get()?;
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.phase == PH_STARTING, GameError::WrongPhase);
        require!(room.seat_of(&ctx.accounts.player.key()).is_some(), GameError::NotSeated);
        require!(clock.slot > room.start_slot + FALLBACK_SLOTS, GameError::TooEarly);
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut d, room.room_id)?;
        let pseudo = hashv(&[&b"fallback"[..], &clock.slot.to_le_bytes()[..], &clock.unix_timestamp.to_le_bytes()[..], ctx.accounts.player.key().as_ref()]).to_bytes();
        let mixed = mix_seed(&room, w, &pseudo);
        w.vrf = pseudo;
        sim::deal(&mut room, w, mixed);
        room.seed_state = 2;
        Ok(())
    }

    /// The one gameplay instruction. Move / hold USE / cuff / report / emergency all look
    /// identical on the wire, so not even transaction metadata says what you did.
    pub fn act(ctx: Context<Act>, input: u8, seq: u32) -> Result<()> {
        let (s, room_id) = {
            let room = ctx.accounts.room.load()?;
            require!(room.phase == PH_PLAY, GameError::WrongPhase);
            (room.seat_of(&ctx.accounts.player.key()).ok_or(GameError::NotSeated)?, room.room_id)
        };
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut d, room_id)?;
        if seq <= w.in_seq[s] && w.in_seq[s] != 0 {
            return Ok(()); // stale or replayed
        }
        w.in_seq[s] = seq;
        w.input[s] = input & (sim::IN_DIR | sim::IN_USE);
        w.edge[s] |= input & (sim::IN_CUFF | sim::IN_REPORT | sim::IN_EMERGENCY);
        Ok(())
    }

    /// Sealed ballot: stored in the World, published for everyone at once at the tally.
    pub fn vote(ctx: Context<Act>, target: u8) -> Result<()> {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.phase == PH_MEETING, GameError::WrongPhase);
        let s = room.seat_of(&ctx.accounts.player.key()).ok_or(GameError::NotSeated)?;
        require!(room.voted_mask & (1 << s) == 0, GameError::BadVote);
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut d, room.room_id)?;
        require!(w.alive[s] == 1, GameError::Dead);
        require!(target == VOTE_SKIP || ((target as usize) < MAXP && room.occupied(target as usize) && w.alive[target as usize] == 1), GameError::BadVote);
        sim::cast_vote(&mut room, w, s, target);
        Ok(())
    }

    /// Public chat: in the lobby, during meetings (living players only) and after the game.
    /// Nobody talks during the heist.
    pub fn chat(ctx: Context<Act>, len: u8, text: [u8; CHAT_LEN]) -> Result<()> {
        require!((len as usize) <= CHAT_LEN && len > 0, GameError::TooLong);
        let mut room = ctx.accounts.room.load_mut()?;
        let s = room.seat_of(&ctx.accounts.player.key()).ok_or(GameError::NotSeated)?;
        match room.phase {
            PH_LOBBY | PH_ENDED | PH_REVEALED => {}
            PH_MEETING | PH_RESULT => {
                let d = ctx.accounts.world.try_borrow_data()?;
                require!(d.len() >= DISC + WORLD_SIZE, GameError::BadAccount);
                let w: &World = body_ref(&d);
                require!(w.room_id == room.room_id, GameError::BadAccount);
                require!(w.alive[s] == 1, GameError::Dead);
            }
            _ => return err!(GameError::WrongPhase),
        }
        room.last_seen[s] = Clock::get()?.unix_timestamp as u32;
        room.push_chat(s as u8, &text[..len as usize]);
        Ok(())
    }

    /// One 100 ms step. Called by the crank; any client may call it too as a liveness
    /// fallback — the slot gate stops double-ticking.
    pub fn tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
        let clock = Clock::get()?;
        let mut room = ctx.accounts.room.load_mut()?;
        if room.phase != PH_PLAY && room.phase != PH_MEETING && room.phase != PH_RESULT {
            return Ok(());
        }
        if room.last_tick_slot != 0 && clock.slot < room.last_tick_slot + MIN_TICK_SLOTS {
            return Ok(());
        }
        room.last_tick_slot = clock.slot;
        let room_id = room.room_id;
        let accs = [
            &ctx.accounts.view0, &ctx.accounts.view1, &ctx.accounts.view2, &ctx.accounts.view3,
            &ctx.accounts.view4, &ctx.accounts.view5, &ctx.accounts.view6, &ctx.accounts.view7,
        ];
        let mut bufs = Vec::with_capacity(MAXP);
        for (i, a) in accs.iter().enumerate() {
            require_keys_eq!(*a.owner, crate::ID, GameError::BadAccount);
            let b = a.try_borrow_mut_data()?;
            require!(b.len() >= DISC + VIEW_SIZE && &b[..DISC] == View::DISCRIMINATOR, GameError::BadAccount);
            {
                let v: &View = body_ref(&b);
                require!(v.room_id == room_id && v.seat == i as u32, GameError::BadAccount);
            }
            bufs.push(b);
        }
        let mut views: Vec<&mut View> = bufs.iter_mut().map(|b| body_mut::<View>(&mut b[..])).collect();
        let mut wd = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut wd, room_id)?;
        sim::tick(&mut room, w, &mut views[..], clock.unix_timestamp);
        Ok(())
    }

    /// Lights on: World and every View flip to public, so anyone can replay the deal
    /// (VRF + salts) and check every role. remaining: [view_i, view_perm_i] x 8 (+ the Pot).
    /// Staked tables: the Room is committed to Solana with a post-commit Magic Action that
    /// runs `settle` there, so the payout happens in the same flow as the reveal.
    pub fn finish<'info>(ctx: Context<'info, Lights<'info>>) -> Result<()> {
        let (room_id, bump, pot_nonce) = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.phase == PH_ENDED, GameError::WrongPhase);
            room.phase = PH_REVEALED;
            (room.room_id, room.bump, room.pot_nonce)
        };
        flip_all(&ctx, room_id, bump, false)?;
        if pot_nonce != 0 {
            schedule_settle(&ctx, room_id, pot_nonce)?;
        }
        Ok(())
    }

    /// Back to the lobby: re-seal the World and give each View back to its seat only.
    pub fn reset<'info>(ctx: Context<'info, Lights<'info>>) -> Result<()> {
        let (room_id, bump) = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.phase == PH_REVEALED, GameError::WrongPhase);
            room.phase = PH_LOBBY;
            room.tick = 0;
            room.task_done = 0;
            room.task_total = 0;
            room.voted_mask = 0;
            room.seed_state = 0;
            room.winner = NO_SEAT;
            room.caller = NO_SEAT;
            room.reported = NO_SEAT;
            room.ejected = NO_SEAT;
            room.ejected_role = ROLE_UNKNOWN;
            if room.stake > 0 {
                // a staked heist is one pot: everyone buys a fresh ticket for the next one
                room.pot_nonce = 0;
                for i in 0..MAXP {
                    room.clear_seat(i);
                }
                room.host = Pubkey::default();
            }
            for i in 0..MAXP {
                if room.is_bot[i] == 1 {
                    room.clear_seat(i);
                }
                room.alive_pub[i] = if room.players[i] != Pubkey::default() { 1 } else { 0 };
                room.roles_pub[i] = ROLE_UNKNOWN;
                room.last_votes[i] = VOTE_NONE;
            }
            room.n_humans = room.humans() as u8;
            (room.room_id, room.bump)
        };
        {
            let mut d = ctx.accounts.world.try_borrow_mut_data()?;
            let w = world_mut(&mut d, room_id)?;
            let rid = w.room_id;
            *w = bytemuck::Zeroable::zeroed();
            w.room_id = rid;
            w.votes = [VOTE_NONE; MAXP];
            w.role = [ROLE_UNKNOWN; MAXP];
        }
        flip_all(&ctx, room_id, bump, true)
    }
}

// ---------------------------------------------------------------- helpers

pub fn mix_seed(room: &Room, w: &World, randomness: &[u8; 32]) -> [u8; 32] {
    let mut salts = [0u8; 32 * MAXP];
    for i in 0..MAXP {
        salts[i * 32..(i + 1) * 32].copy_from_slice(&w.salts[i]);
    }
    hashv(&[&b"inside-job/deal/v1"[..], &randomness[..], &salts[..], &room.room_id.to_le_bytes()[..], &room.match_no.to_le_bytes()[..]]).to_bytes()
}

pub fn pot_pda(room_id: u64, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(&[POT_SEED, &room_id.to_le_bytes(), &nonce.to_le_bytes()], &crate::ID).0
}

/// Read a Pot (in the rollup it's a read-only clone of the Solana account).
pub fn read_pot(ai: &AccountInfo, room_id: u64, nonce: u64) -> Result<Pot> {
    require_keys_eq!(*ai.key, pot_pda(room_id, nonce), GameError::BadAccount);
    require_keys_eq!(*ai.owner, crate::ID, GameError::NoTicket);
    let d = ai.try_borrow_data()?;
    Ok(Pot::try_deserialize(&mut &d[..])?)
}

fn find_pot<'a, 'info>(rest: &'a [AccountInfo<'info>], room_id: u64, nonce: u64) -> Result<(&'a AccountInfo<'info>, Pot)> {
    let key = pot_pda(room_id, nonce);
    let ai = rest.iter().find(|a| *a.key == key).ok_or(GameError::BadAccount)?;
    require!(ai.is_writable, GameError::BadAccount);
    let pot = read_pot(ai, room_id, nonce)?;
    Ok((ai, pot))
}

/// Move lamports out of the program-owned Pot. Only the stakes move; the Pot keeps its rent.
fn pay_out<'info>(pot_ai: &AccountInfo<'info>, rest: &[AccountInfo<'info>], pot: &Pot, pay: &[u64; MAXP]) -> Result<()> {
    let total: u64 = pay.iter().sum();
    let rent = Rent::get()?.minimum_balance(pot_ai.data_len());
    require!(pot_ai.lamports() >= total + rent, GameError::BadAccount);
    for e in 0..(pot.n as usize).min(MAXP) {
        if pay[e] == 0 {
            continue;
        }
        let w = rest.iter().find(|a| *a.key == pot.wallets[e]).ok_or(GameError::MissingWallet)?;
        require!(w.is_writable, GameError::MissingWallet);
        **pot_ai.try_borrow_mut_lamports()? -= pay[e];
        **w.try_borrow_mut_lamports()? += pay[e];
    }
    Ok(())
}

/// Commit the Room to Solana and run `settle` there right after (a Magic Action).
fn schedule_settle<'info>(ctx: &Context<'info, Lights<'info>>, room_id: u64, nonce: u64) -> Result<()> {
    let a = &ctx.accounts;
    let pot_ai = ctx.remaining_accounts.get(MAXP * 2).ok_or(GameError::NoTicket)?;
    let pot = read_pot(pot_ai, room_id, nonce)?;
    let mut metas: Vec<(Pubkey, bool)> = vec![(pot_ai.key(), true), (a.room.key(), false)];
    for e in 0..(pot.n as usize).min(MAXP) {
        if !metas.iter().any(|m| m.0 == pot.wallets[e]) {
            metas.push((pot.wallets[e], true));
        }
    }
    let data = anchor_lang::InstructionData::data(&crate::instruction::Settle { room_id, nonce });
    let ix = magic::commit_with_action_ix(a.payer.key(), a.room.key(), crate::ID, &data, SETTLE_CU, &metas);
    invoke(&ix, &[a.payer.to_account_info(), a.magic_context.to_account_info(), a.room.to_account_info(), a.magic_program.to_account_info()])?;
    Ok(())
}

pub fn expect_pda(target: &AccountInfo, seeds: &[&[u8]]) -> Result<u8> {
    let (key, bump) = Pubkey::find_program_address(seeds, &crate::ID);
    require_keys_eq!(*target.key, key, GameError::BadAccount);
    Ok(bump)
}

pub fn expect_permission(perm: &AccountInfo, account: &Pubkey) -> Result<()> {
    let (key, _) = EphemeralPermission::find_pda(account);
    require_keys_eq!(*perm.key, key, GameError::BadAccount);
    Ok(())
}

pub fn world_mut(d: &mut [u8], room_id: u64) -> Result<&mut World> {
    require!(d.len() >= DISC + WORLD_SIZE && &d[..DISC] == World::DISCRIMINATOR, GameError::BadAccount);
    let w: &mut World = body_mut(d);
    require!(w.room_id == room_id, GameError::BadAccount);
    Ok(w)
}

/// The keys allowed to read seat `s`'s View: its session key and its wallet.
pub fn seat_members(room: &Room, s: usize) -> Vec<Member> {
    let flags = TX_LOGS_FLAG | TX_MESSAGE_FLAG;
    let mut m = Vec::with_capacity(2);
    if room.players[s] != Pubkey::default() {
        m.push(Member { flags, pubkey: room.players[s] });
    }
    if room.wallets[s] != Pubkey::default() && room.wallets[s] != room.players[s] {
        m.push(Member { flags, pubkey: room.wallets[s] });
    }
    m
}

fn set_view_perm<'info>(ctx: &Context<'info, SeatAccounts<'info>>, room_id: u64, room_bump: u8, seat: u8, private: bool, members: Vec<Member>) -> Result<()> {
    let rid = room_id.to_le_bytes();
    let a = &ctx.accounts;
    let view_bump = expect_pda(&a.view, &[VIEW_SEED, &rid, &[seat]])?;
    expect_permission(&a.view_permission, a.view.key)?;
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[room_bump]];
    let view_seeds: &[&[u8]] = &[VIEW_SEED, &rid, &[seat], &[view_bump]];
    UpdateEphemeralPermissionCpi {
        payer: a.room.to_account_info(),
        permissioned_account: a.view.to_account_info(),
        permission: a.view_permission.to_account_info(),
        vault: a.ephemeral_vault.to_account_info(),
        magic_program: a.magic_program.to_account_info(),
        permission_program: a.permission_program.to_account_info(),
        authority: a.view.to_account_info(),
        authority_is_signer: false,
        args: EphemeralMembersArgs { is_private: private, members },
    }
    .invoke_signed(&[room_seeds, view_seeds])?;
    Ok(())
}

/// `seal = false`: everything public (lights on). `seal = true`: World sealed with no
/// readers, each View private to its seat again.
fn flip_all<'info>(ctx: &Context<'info, Lights<'info>>, room_id: u64, room_bump: u8, seal: bool) -> Result<()> {
    let rid = room_id.to_le_bytes();
    let a = &ctx.accounts;
    let room_ai = a.room.to_account_info();
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[room_bump]];
    let world_bump = expect_pda(&a.world, &[WORLD_SEED, &rid])?;
    expect_permission(&a.world_permission, a.world.key)?;
    let update = |acc: &AccountInfo<'info>, perm: &AccountInfo<'info>, seeds: &[&[u8]], private: bool, members: Vec<Member>| -> Result<()> {
        UpdateEphemeralPermissionCpi {
            payer: room_ai.clone(),
            permissioned_account: acc.clone(),
            permission: perm.clone(),
            vault: a.ephemeral_vault.to_account_info(),
            magic_program: a.magic_program.to_account_info(),
            permission_program: a.permission_program.to_account_info(),
            authority: acc.clone(),
            authority_is_signer: false,
            args: EphemeralMembersArgs { is_private: private, members },
        }
        .invoke_signed(&[room_seeds, seeds])?;
        Ok(())
    };
    update(&a.world.to_account_info(), &a.world_permission.to_account_info(), &[WORLD_SEED, &rid, &[world_bump]], seal, vec![])?;
    let rest = ctx.remaining_accounts;
    require!(rest.len() >= MAXP * 2, GameError::BadAccount);
    let room = a.room.load()?;
    let members: Vec<Vec<Member>> = (0..MAXP).map(|s| if seal { seat_members(&room, s) } else { vec![] }).collect();
    drop(room);
    for s in 0..MAXP {
        let view = &rest[s * 2];
        let perm = &rest[s * 2 + 1];
        let bump = expect_pda(view, &[VIEW_SEED, &rid, &[s as u8]])?;
        expect_permission(perm, view.key)?;
        update(view, perm, &[VIEW_SEED, &rid, &[s as u8], &[bump]], seal, members[s].clone())?;
    }
    Ok(())
}

// ---------------------------------------------------------------- account contexts

#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = DISC + ROOM_SIZE, seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: u64, nonce: u64)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    /// CHECK: the room PDA (delegated: owned by the delegation program); parsed in the handler
    #[account(seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = wallet, space = DISC + POT_SIZE, seeds = [POT_SEED, &room_id.to_le_bytes(), &nonce.to_le_bytes()], bump)]
    pub pot: Account<'info, Pot>,
    pub system_program: Program<'info, System>,
}

/// `settle` / `refund` find every account by address in the remaining accounts, so they
/// work whatever order a Magic Action (or a direct caller) passes them in.
#[derive(Accounts)]
pub struct Settle {}

#[delegate]
#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct DelegateRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the room PDA being delegated
    #[account(mut, del, seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    /// CHECK: optional validator override (localnet); defaults to the TEE validator
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct SetupCore<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World PDA, checked in the handler
    #[account(mut)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: the World's permission PDA, checked in the handler
    #[account(mut)]
    pub world_permission: UncheckedAccount<'info>,
    /// CHECK: the Room's permission PDA, checked in the handler
    #[account(mut)]
    pub room_permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SeatAccounts<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World PDA (checked by discriminator + room id)
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: View PDA, checked in the handler
    #[account(mut)]
    pub view: UncheckedAccount<'info>,
    /// CHECK: the View's permission PDA, checked in the handler
    #[account(mut)]
    pub view_permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct StartMatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: the VRF queue delegated to the rollup (fee-exempt)
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct Deal<'info> {
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World, verified by discriminator + room id
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Act<'info> {
    pub player: Signer<'info>,
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World, verified by discriminator + room id
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World, verified by discriminator + room id
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view0: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view1: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view2: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view3: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view4: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view5: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view6: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view7: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Lights<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: World PDA, checked in the handler
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: the World's permission PDA, checked in the handler
    #[account(mut)]
    pub world_permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: magic context (staked tables commit the Room at lights-on)
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
}
