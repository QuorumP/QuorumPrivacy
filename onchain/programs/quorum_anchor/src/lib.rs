use anchor_lang::prelude::*;

declare_id!("BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w");

mod groth16;
#[cfg(test)]
mod tests;

/// The QUORUM authority: the only key that may register (open) a vote anchor. Without this,
/// anyone could init a vote's PDA first (its seed is only the public vote id) and anchor a
/// fake eligibility root. Move to the multisig before mainnet (SECURITY.md handoff plan).
pub const QUORUM_AUTHORITY: Pubkey = pubkey!("9sjBajqChwe1BDCa9gxAG46qgJzMwgKPe1mi64T24ZYC");

/// QUORUM on-chain anchor — cost-minimal. Stores ONLY roots/hashes per vote (no per-ballot
/// accounts): the eligibility Merkle root, the ballot-commitment root, and the final tally
/// result hash. One small, closable PDA per vote. All ballots/commitments live off-chain in
/// Supabase; only these anchors are committed on devnet.
#[program]
pub mod quorum_anchor {
    use super::*;

    /// Register a vote and anchor its eligibility snapshot root.
    pub fn register_vote(
        ctx: Context<RegisterVote>,
        vote_id: String,
        eligibility_root: [u8; 32],
    ) -> Result<()> {
        require!(vote_id.len() <= MAX_ID, QuorumError::IdTooLong);
        let v = &mut ctx.accounts.vote;
        v.authority = ctx.accounts.authority.key();
        v.vote_id = vote_id;
        v.eligibility_root = eligibility_root;
        v.ballot_root = [0u8; 32];
        v.result_hash = [0u8; 32];
        v.status = STATUS_OPEN;
        v.bump = ctx.bumps.vote;
        Ok(())
    }

    /// Anchor the ballot-commitment Merkle root (one root for all ballots) and move to tallying.
    pub fn commit_ballots(ctx: Context<UpdateVote>, ballot_root: [u8; 32]) -> Result<()> {
        let v = &mut ctx.accounts.vote;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), QuorumError::Unauthorized);
        require!(v.status == STATUS_OPEN, QuorumError::BadState);
        v.ballot_root = ballot_root;
        v.status = STATUS_TALLYING;
        Ok(())
    }

    /// Anchor the final tally result hash (gate for execution) and mark verified.
    pub fn submit_tally(ctx: Context<UpdateVote>, result_hash: [u8; 32]) -> Result<()> {
        let v = &mut ctx.accounts.vote;
        require_keys_eq!(v.authority, ctx.accounts.authority.key(), QuorumError::Unauthorized);
        require!(v.status == STATUS_TALLYING, QuorumError::BadState);
        v.result_hash = result_hash;
        v.status = STATUS_VERIFIED;
        Ok(())
    }

    /// Reclaim rent once a vote is archived (closable PDA — keeps on-chain footprint near zero).
    pub fn close_vote(ctx: Context<CloseVote>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.vote.authority,
            ctx.accounts.authority.key(),
            QuorumError::Unauthorized
        );
        Ok(())
    }

    /// Verify a Groth16 solvency proof (reserves ≥ threshold) ON-CHAIN via alt_bn128 pairing.
    /// Fails the transaction if the proof is invalid, so an unbacked solvency claim cannot be
    /// recorded. `proof_a` must be pre-negated by the client. Public inputs: [threshold, commitment].
    /// This is the reusable on-chain Groth16 verification path (same shape a tally-correctness
    /// proof would use).
    pub fn verify_solvency(
        _ctx: Context<VerifyProof>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        threshold: [u8; 32],
        commitment: [u8; 32],
    ) -> Result<()> {
        require!(
            groth16::verify(&proof_a, &proof_b, &proof_c, &[threshold, commitment]),
            QuorumError::InvalidProof
        );
        msg!("QUORUM: solvency proof verified on-chain (reserves >= threshold)");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct VerifyProof<'info> {
    // Only the server key may attest: it reads the real treasury balance and generates the proof
    // itself, so a proof from any other signer would carry a self-chosen balance.
    #[account(address = QUORUM_AUTHORITY @ QuorumError::Unauthorized)]
    pub authority: Signer<'info>,
}

const MAX_ID: usize = 32;
const STATUS_OPEN: u8 = 0;
const STATUS_TALLYING: u8 = 1;
const STATUS_VERIFIED: u8 = 2;

#[account]
pub struct VoteAnchor {
    pub authority: Pubkey,        // 32
    pub vote_id: String,          // 4 + 32
    pub eligibility_root: [u8; 32], // 32
    pub ballot_root: [u8; 32],    // 32
    pub result_hash: [u8; 32],    // 32
    pub status: u8,               // 1
    pub bump: u8,                 // 1
}

impl VoteAnchor {
    // discriminator(8) + fields
    const SPACE: usize = 8 + 32 + (4 + MAX_ID) + 32 + 32 + 32 + 1 + 1;
}

#[derive(Accounts)]
#[instruction(vote_id: String)]
pub struct RegisterVote<'info> {
    #[account(
        init,
        payer = authority,
        space = VoteAnchor::SPACE,
        seeds = [b"vote", vote_id.as_bytes()],
        bump
    )]
    pub vote: Account<'info, VoteAnchor>,
    #[account(mut, address = QUORUM_AUTHORITY @ QuorumError::Unauthorized)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateVote<'info> {
    #[account(mut, seeds = [b"vote", vote.vote_id.as_bytes()], bump = vote.bump)]
    pub vote: Account<'info, VoteAnchor>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseVote<'info> {
    #[account(mut, close = authority, seeds = [b"vote", vote.vote_id.as_bytes()], bump = vote.bump)]
    pub vote: Account<'info, VoteAnchor>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[error_code]
pub enum QuorumError {
    #[msg("vote id too long (max 32)")]
    IdTooLong,
    #[msg("unauthorized")]
    Unauthorized,
    #[msg("invalid state transition")]
    BadState,
    #[msg("groth16 proof failed on-chain verification")]
    InvalidProof,
}
