//! A hand-encoded `ScheduleIntentBundle` (Magic Program) for the shapes we use:
//! commit one account, optionally followed by post-commit actions on Solana.
//!
//! The SDK's `MagicIntentBundleBuilder` produces the same bytes, but it pulls bincode/serde
//! into the SBF binary (+130 KB). The tests below build each shape with the SDK and assert
//! our encoding is byte-for-byte identical, so this can't silently drift.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};

/// `MagicBlockInstruction::ScheduleIntentBundle` (bincode enum tag)
pub const SCHEDULE_INTENT_BUNDLE: u32 = 11;
/// `CommitTypeArgs::Standalone`
const COMMIT_STANDALONE: u32 = 0;
/// `CommitTypeArgs::WithBaseActions`
const COMMIT_WITH_BASE_ACTIONS: u32 = 1;
/// `ActionArgs::new` default: no escrow
const NO_ESCROW: u8 = 255;

/// One base-layer call to run right after the commit lands.
pub struct BaseAction {
    pub destination: Pubkey,
    pub data: Vec<u8>,
    pub compute_units: u32,
    /// (pubkey, writable)
    pub accounts: Vec<(Pubkey, bool)>,
}

fn put_u32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn put_u64(v: &mut Vec<u8>, x: u64) {
    v.extend_from_slice(&x.to_le_bytes());
}

/// Commit `committed` (writable, already delegated) to Solana, then run `actions` there
/// in order. `payer` signs and is also each action's escrow authority.
pub fn commit_ix(payer: Pubkey, committed: Pubkey, actions: &[BaseAction]) -> Instruction {
    let mut d = Vec::with_capacity(64 + actions.iter().map(|a| 64 + a.data.len() + a.accounts.len() * 33).sum::<usize>());
    put_u32(&mut d, SCHEDULE_INTENT_BUNDLE);
    d.push(1); // commit: Some(..)
    if actions.is_empty() {
        put_u32(&mut d, COMMIT_STANDALONE);
        put_u64(&mut d, 1);
        d.push(2); // account index of `committed` (0 payer, 1 magic context)
    } else {
        put_u32(&mut d, COMMIT_WITH_BASE_ACTIONS);
        put_u64(&mut d, 1);
        d.push(2);
        put_u64(&mut d, actions.len() as u64);
        for a in actions {
            d.push(NO_ESCROW);
            put_u64(&mut d, a.data.len() as u64);
            d.extend_from_slice(&a.data);
            put_u32(&mut d, a.compute_units);
            d.push(0); // escrow_authority = account index 0 (payer)
            d.extend_from_slice(a.destination.as_ref());
            put_u64(&mut d, a.accounts.len() as u64);
            for (k, w) in &a.accounts {
                d.extend_from_slice(k.as_ref());
                d.push(*w as u8);
            }
        }
    }
    d.push(0); // commit_and_undelegate: None
    d.push(0); // commit_finalize: None
    d.push(0); // commit_finalize_and_undelegate: None
    put_u64(&mut d, 0); // standalone_actions: []
    Instruction {
        program_id: Pubkey::new_from_array(MAGIC_PROGRAM_ID.to_bytes()),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(Pubkey::new_from_array(MAGIC_CONTEXT_ID.to_bytes()), false),
            AccountMeta::new(committed, false),
        ],
        data: d,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
    use magicblock_magic_program_api::args::{ActionArgs, ShortAccountMeta};

    fn check(n_actions: usize) {
        let payer = Pubkey::new_unique();
        let room = Pubkey::new_unique();
        let magic_program = Pubkey::new_from_array(MAGIC_PROGRAM_ID.to_bytes());
        let ctx = Pubkey::new_from_array(MAGIC_CONTEXT_ID.to_bytes());
        let ours_actions: Vec<BaseAction> = (0..n_actions)
            .map(|k| BaseAction {
                destination: Pubkey::new_unique(),
                data: vec![9u8, 8, 7, k as u8, 42],
                compute_units: 150_000 + k as u32,
                accounts: (0..3 + k).map(|i| (Pubkey::new_unique(), i != 1)).collect(),
            })
            .collect();

        let (mut l0, mut l1, mut l2, mut l3) = (1u64, 1u64, 1u64, 1u64);
        let (mut d0, mut d1, mut d2, mut d3) = ([0u8; 0], [0u8; 0], [0u8; 0], [0u8; 0]);
        let owner = Pubkey::default();
        let payer_ai = AccountInfo::new(&payer, true, true, &mut l0, &mut d0, &owner, false);
        let ctx_ai = AccountInfo::new(&ctx, false, true, &mut l1, &mut d1, &owner, false);
        let prog_ai = AccountInfo::new(&magic_program, false, false, &mut l2, &mut d2, &owner, false);
        let room_ai = AccountInfo::new(&room, false, true, &mut l3, &mut d3, &owner, false);
        let handlers: Vec<CallHandler> = ours_actions
            .iter()
            .map(|a| CallHandler {
                args: ActionArgs::new(a.data.clone()),
                compute_units: a.compute_units,
                escrow_authority: payer_ai.clone(),
                destination_program: a.destination,
                accounts: a.accounts.iter().map(|(k, w)| ShortAccountMeta { pubkey: *k, is_writable: *w }).collect(),
            })
            .collect();
        let b = MagicIntentBundleBuilder::new(payer_ai.clone(), ctx_ai, prog_ai).commit(&[room_ai]);
        let sdk = if handlers.is_empty() { b.build() } else { b.add_post_commit_actions(handlers).build() };
        let (_infos, sdk_ix) = sdk.schedule_intent_ix;
        let ours = commit_ix(payer, room, &ours_actions);
        assert_eq!(ours.data, sdk_ix.data, "instruction data must match the SDK ({n_actions} actions)");
        assert_eq!(ours.program_id, sdk_ix.program_id);
        assert_eq!(ours.accounts.len(), sdk_ix.accounts.len());
        for (a, b) in ours.accounts.iter().zip(sdk_ix.accounts.iter()) {
            assert_eq!((a.pubkey, a.is_signer, a.is_writable), (b.pubkey, b.is_signer, b.is_writable));
        }
    }

    #[test]
    fn matches_the_sdk_encoding_byte_for_byte() {
        check(0); // commit only (deal commitment, free tables at lights-on)
        check(1); // commit + settle
        check(2); // commit + record tips + settle
    }
}
