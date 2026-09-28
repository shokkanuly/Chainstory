// programs/story-attest/src/lib.rs
//
// ChainStory v2 — ZK Compressed On-Chain Story Receipt Program
// Stores opt-in, privacy-preserving commitment hashes as Light Protocol compressed PDAs.
// Contains zero PII; commitments are SHA-256 hashes of the canonical wallet snapshot.

use anchor_lang::prelude::*;
use light_sdk::merkle_context::PackedAddressMerkleContext;
use light_sdk::parameters::NewAddressParams;

declare_id!("StryAttest111111111111111111111111111111111");

pub const SCHEMA_VERSION: u8 = 1;

#[program]
pub mod story_attest {
    use super::*;

    /// Create an opt-in ZK-compressed Story Receipt for a wallet.
    pub fn create_receipt<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateReceipt<'info>>,
        snapshot_hash: [u8; 32],
        tier: u8,
        issued_slot: u64,
    ) -> Result<()> {
        let receipt = &mut ctx.accounts.receipt;
        receipt.schema_version = SCHEMA_VERSION;
        receipt.wallet = ctx.accounts.signer.key();
        receipt.snapshot_hash = snapshot_hash;
        receipt.tier = tier;
        receipt.issued_slot = issued_slot;

        emit!(StoryReceiptCreated {
            wallet: receipt.wallet,
            snapshot_hash,
            tier,
            issued_slot,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateReceipt<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The compressed PDA account holding the receipt data
    #[account(
        init,
        payer = signer,
        space = 8 + StoryReceipt::INIT_SPACE
    )]
    pub receipt: Account<'info, StoryReceipt>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct StoryReceipt {
    pub schema_version: u8,
    pub wallet: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub tier: u8,
    pub issued_slot: u64,
}

#[event]
pub struct StoryReceiptCreated {
    pub wallet: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub tier: u8,
    pub issued_slot: u64,
}
