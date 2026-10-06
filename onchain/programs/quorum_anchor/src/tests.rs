//! Instruction-level negative tests: run the real Anchor entrypoint natively against hand-built
//! accounts. Covers every instruction that doesn't CPI or resize; register_vote's `init` (system
//! program CPI) and a successful close_vote run on devnet (scripts/onchain/anchor-vote.mjs).
use super::*;
use anchor_lang::{solana_program::program_error::ProgramError, AccountSerialize, InstructionData};

const UNAUTHORIZED: u32 = 6001;
const BAD_STATE: u32 = 6002;
const INVALID_PROOF: u32 = 6003;
const CONSTRAINT_SEEDS: u32 = 2006;
const NOT_SIGNER: u32 = 3010;
const WRONG_OWNER: u32 = 3007;

fn leak<T>(t: T) -> &'static mut T {
    Box::leak(Box::new(t))
}

fn vote_pda(id: &str) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vote", id.as_bytes()], &ID)
}

fn vote_data(id: &str, authority: Pubkey, status: u8) -> Vec<u8> {
    let v = VoteAnchor {
        authority,
        vote_id: id.to_string(),
        eligibility_root: [7; 32],
        ballot_root: [0; 32],
        result_hash: [0; 32],
        status,
        bump: vote_pda(id).1,
    };
    let mut data = Vec::with_capacity(VoteAnchor::SPACE);
    v.try_serialize(&mut data).unwrap();
    data.resize(VoteAnchor::SPACE, 0);
    data
}

fn acct(key: Pubkey, signer: bool, writable: bool, lamports: u64, data: Vec<u8>, owner: Pubkey) -> AccountInfo<'static> {
    AccountInfo::new(leak(key), signer, writable, leak(lamports), leak(data).as_mut_slice(), leak(owner), false)
}

/// A vote anchor account at `address` holding vote `id` in `status`, created by `authority`.
fn vote_acct(address: Pubkey, id: &str, authority: Pubkey, status: u8) -> AccountInfo<'static> {
    acct(address, false, true, 1_000_000, vote_data(id, authority, status), ID)
}

fn signer(key: Pubkey, signed: bool) -> AccountInfo<'static> {
    acct(key, signed, true, 0, vec![], anchor_lang::system_program::ID)
}

fn run(accounts: Vec<AccountInfo<'static>>, data: Vec<u8>) -> std::result::Result<(), u32> {
    let accounts: &'static [AccountInfo<'static>] = Box::leak(accounts.into_boxed_slice());
    entry(leak(ID), accounts, Box::leak(data.into_boxed_slice())).map_err(|e| match e {
        ProgramError::Custom(c) => c,
        other => panic!("unexpected error {other:?}"),
    })
}

fn status_of(a: &AccountInfo) -> u8 {
    let d = a.try_borrow_data().unwrap();
    VoteAnchor::try_deserialize(&mut &d[..]).unwrap().status
}

const ID_: &str = "qrm-0123456789abcdef";
fn commit() -> Vec<u8> { instruction::CommitBallots { ballot_root: [1; 32] }.data() }
fn tally() -> Vec<u8> { instruction::SubmitTally { result_hash: [2; 32] }.data() }

#[test]
fn lifecycle_open_tallying_verified() {
    let auth = Pubkey::new_unique();
    let vote = vote_acct(vote_pda(ID_).0, ID_, auth, STATUS_OPEN);
    run(vec![vote.clone(), signer(auth, true)], commit()).unwrap();
    assert_eq!(status_of(&vote), STATUS_TALLYING);
    run(vec![vote.clone(), signer(auth, true)], tally()).unwrap();
    assert_eq!(status_of(&vote), STATUS_VERIFIED);
}

#[test]
fn only_the_vote_authority_can_advance_it() {
    let auth = Pubkey::new_unique();
    let mallory = Pubkey::new_unique();
    let open = vote_acct(vote_pda(ID_).0, ID_, auth, STATUS_OPEN);
    assert_eq!(run(vec![open, signer(mallory, true)], commit()), Err(UNAUTHORIZED));
    let tallying = vote_acct(vote_pda(ID_).0, ID_, auth, STATUS_TALLYING);
    assert_eq!(run(vec![tallying, signer(mallory, true)], tally()), Err(UNAUTHORIZED));
}

#[test]
fn authority_must_sign() {
    let auth = Pubkey::new_unique();
    let vote = vote_acct(vote_pda(ID_).0, ID_, auth, STATUS_OPEN);
    assert_eq!(run(vec![vote, signer(auth, false)], commit()), Err(NOT_SIGNER));
}

#[test]
fn no_skipping_or_replaying_states() {
    let auth = Pubkey::new_unique();
    let pda = vote_pda(ID_).0;
    // tally before ballots are committed
    assert_eq!(run(vec![vote_acct(pda, ID_, auth, STATUS_OPEN), signer(auth, true)], tally()), Err(BAD_STATE));
    // re-commit (would overwrite the ballot root) / re-tally (would overwrite the result)
    assert_eq!(run(vec![vote_acct(pda, ID_, auth, STATUS_TALLYING), signer(auth, true)], commit()), Err(BAD_STATE));
    assert_eq!(run(vec![vote_acct(pda, ID_, auth, STATUS_VERIFIED), signer(auth, true)], commit()), Err(BAD_STATE));
    assert_eq!(run(vec![vote_acct(pda, ID_, auth, STATUS_VERIFIED), signer(auth, true)], tally()), Err(BAD_STATE));
}

#[test]
fn rejects_a_vote_account_at_the_wrong_address_or_owner() {
    let auth = Pubkey::new_unique();
    // vote X's data placed at vote Y's PDA
    let wrong = vote_acct(vote_pda("qrm-other").0, ID_, auth, STATUS_OPEN);
    assert_eq!(run(vec![wrong, signer(auth, true)], commit()), Err(CONSTRAINT_SEEDS));
    // right address, but the account belongs to another program (forged data)
    let forged = acct(vote_pda(ID_).0, false, true, 1_000_000, vote_data(ID_, auth, STATUS_OPEN), Pubkey::new_unique());
    assert_eq!(run(vec![forged, signer(auth, true)], commit()), Err(WRONG_OWNER));
}

#[test]
fn only_the_authority_can_close() {
    // The successful close resizes the account, which writes its length into the 8 bytes before
    // the data pointer — memory that only exists in the runtime's serialized input, not in a
    // test Vec. That path runs on devnet instead (scripts/onchain/anchor-vote.mjs).
    let auth = Pubkey::new_unique();
    let mallory = Pubkey::new_unique();
    let close = instruction::CloseVote {}.data();
    let vote = vote_acct(vote_pda(ID_).0, ID_, auth, STATUS_VERIFIED);
    assert_eq!(run(vec![vote.clone(), signer(mallory, true)], close), Err(UNAUTHORIZED));
    assert_eq!(vote.lamports(), 1_000_000);
}

mod tv {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/test_vector.rs"));
}

#[test]
fn verify_solvency_instruction() {
    let ix = |pub0: [u8; 32]| instruction::VerifySolvency {
        proof_a: tv::PROOF_A, proof_b: tv::PROOF_B, proof_c: tv::PROOF_C, threshold: pub0, commitment: tv::PUB1,
    }.data();
    let who = Pubkey::new_unique();
    run(vec![signer(who, true)], ix(tv::PUB0)).unwrap();
    let mut bad = tv::PUB0;
    bad[31] ^= 1;
    assert_eq!(run(vec![signer(who, true)], ix(bad)), Err(INVALID_PROOF));
    assert_eq!(run(vec![signer(who, false)], ix(tv::PUB0)), Err(NOT_SIGNER));
}
