//! A hand-encoded `ScheduleIntentBundle` (Magic Program) for exactly one shape:
//! commit one account, then run one post-commit action on Solana.
//!
//! The SDK's `MagicIntentBundleBuilder` produces the same bytes, but it pulls bincode/serde
//! into the SBF binary (+130 KB). The test below builds the intent with the SDK and asserts
//! our encoding is byte-for-byte identical, so this can't silently drift.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};

/// `MagicBlockInstruction::ScheduleIntentBundle` (bincode enum tag)
pub const SCHEDULE_INTENT_BUNDLE: u32 = 11;
/// `CommitTypeArgs::WithBaseActions`
const COMMIT_WITH_BASE_ACTIONS: u32 = 1;
/// `ActionArgs::new` default: no escrow
const NO_ESCROW: u8 = 255;

fn put_u32(v: &mut Vec<u8>, x: u32) {
    v.extend_from_slice(&x.to_le_bytes());
}
fn put_u64(v: &mut Vec<u8>, x: u64) {
    v.extend_from_slice(&x.to_le_bytes());
}

/// Commit `committed` (writable, already delegated) and then call `destination` on Solana
/// with `action_data` and `action_accounts` (pubkey, writable). `payer` signs and is also
/// the action's escrow authority.
pub fn commit_with_action_ix(
    payer: Pubkey,
    committed: Pubkey,
    destination: Pubkey,
    action_data: &[u8],
    compute_units: u32,
    action_accounts: &[(Pubkey, bool)],
) -> Instruction {
    let mut d = Vec::with_capacity(96 + action_data.len() + action_accounts.len() * 33);
    put_u32(&mut d, SCHEDULE_INTENT_BUNDLE);
    // commit: Some(WithBaseActions { committed_accounts: [2], base_actions: [one] })
    d.push(1);
    put_u32(&mut d, COMMIT_WITH_BASE_ACTIONS);
    put_u64(&mut d, 1);
    d.push(2); // account index of `committed` (0 payer, 1 magic context)
    put_u64(&mut d, 1);
    // BaseActionArgs
    d.push(NO_ESCROW);
    put_u64(&mut d, action_data.len() as u64);
    d.extend_from_slice(action_data);
    put_u32(&mut d, compute_units);
    d.push(0); // escrow_authority = account index 0 (payer)
    d.extend_from_slice(destination.as_ref());
    put_u64(&mut d, action_accounts.len() as u64);
    for (k, w) in action_accounts {
        d.extend_from_slice(k.as_ref());
        d.push(*w as u8);
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

    #[test]
    fn matches_the_sdk_encoding_byte_for_byte() {
        let payer = Pubkey::new_unique();
        let room = Pubkey::new_unique();
        let magic_program = Pubkey::new_from_array(MAGIC_PROGRAM_ID.to_bytes());
        let ctx = Pubkey::new_from_array(MAGIC_CONTEXT_ID.to_bytes());
        let dest = Pubkey::new_unique();
        let accs: Vec<(Pubkey, bool)> = (0..5).map(|i| (Pubkey::new_unique(), i != 1)).collect();
        let data = vec![9u8, 8, 7, 6, 5, 4, 3, 2, 1, 0, 42, 42];

        let (mut l0, mut l1, mut l2, mut l3) = (1u64, 1u64, 1u64, 1u64);
        let (mut d0, mut d1, mut d2, mut d3) = ([0u8; 0], [0u8; 0], [0u8; 0], [0u8; 0]);
        let owner = Pubkey::default();
        let payer_ai = AccountInfo::new(&payer, true, true, &mut l0, &mut d0, &owner, false);
        let ctx_ai = AccountInfo::new(&ctx, false, true, &mut l1, &mut d1, &owner, false);
        let prog_ai = AccountInfo::new(&magic_program, false, false, &mut l2, &mut d2, &owner, false);
        let room_ai = AccountInfo::new(&room, false, true, &mut l3, &mut d3, &owner, false);
        let handler = CallHandler {
            args: ActionArgs::new(data.clone()),
            compute_units: 150_000,
            escrow_authority: payer_ai.clone(),
            destination_program: dest,
            accounts: accs.iter().map(|(k, w)| ShortAccountMeta { pubkey: *k, is_writable: *w }).collect(),
        };
        let sdk = MagicIntentBundleBuilder::new(payer_ai.clone(), ctx_ai, prog_ai)
            .commit(&[room_ai])
            .add_post_commit_actions([handler])
            .build();
        let (_infos, sdk_ix) = sdk.schedule_intent_ix;
        let ours = commit_with_action_ix(payer, room, dest, &data, 150_000, &accs);
        assert_eq!(ours.data, sdk_ix.data, "instruction data must match the SDK");
        assert_eq!(ours.program_id, sdk_ix.program_id);
        assert_eq!(ours.accounts.len(), sdk_ix.accounts.len());
        for (a, b) in ours.accounts.iter().zip(sdk_ix.accounts.iter()) {
            assert_eq!((a.pubkey, a.is_signer, a.is_writable), (b.pubkey, b.is_signer, b.is_writable));
        }
    }
}
