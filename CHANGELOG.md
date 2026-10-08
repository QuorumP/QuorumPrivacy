# Changelog

## 2026-10-08 — Solvency proofs bound to the real treasury

- Solvency proofs are now made over a real treasury account (`8EgMeBoKGRdk34YfpCUuW9xwXtgg6wbmfr6hx4sVDvGt`).
  The admin picks only a threshold; the server reads the account's balance from chain at a finalized
  slot and generates the proof. Before, the operator typed the balance in, so any number could be proven.
- The circuit range-checks `balance` and `threshold` to 64 bits. Before, a field-"negative" balance or
  threshold could pass. New proving and verifying keys.
- The commitment's opening (balance, blinding, slot) is sealed to every active auditor key.
- On chain, `verify_solvency` now only accepts the authority key. Program redeployed to devnet.
- Dashboard copy no longer claims Token-2022 Confidential Balances; on devnet the treasury balance is
  still readable on chain.

## 2026-10-08 — Long-run invariants, X-ray, audit scope

- Nightly CI runs the stake-vault invariant suite at ~105k random operations (push CI runs 450).
- Sec3 X-ray static analysis on the Anchor program in CI (pinned image; fails on any finding).
- `AUDIT-SCOPE.md` lists the in-scope files; audited commits are tagged `audit-YYYY-MM-DD`.

## 2026-10-07 — Test suite

- Every server function now runs in tests against Postgres (the real migrations, in-process) and
  a fake devnet. Covered: authorization (anonymous / member / admin) for every mutation, and
  every rejection path for ballots, tallies, proposals, delegation, treasury and sign-in.
- Stateful invariant tests on the stake vault: random concurrent stakes and unstakes, including
  failed, unconfirmed and never-sent payouts, must keep the vault exactly equal to the ledger.
- Property tests for ElGamal, ballot validity proofs, threshold decryption with DLEQ, ECIES,
  proposal commitments and the Poseidon Merkle tree.
- Instruction-level tests for the Anchor program (authority, state machine, PDA and owner
  checks, close, on-chain verifier). The devnet script also checks that non-authorities are
  rejected and that the vote account closes.
- Circuit and devnet scripts run inside the test runner; their hardcoded local paths are gone.
- CI enforces coverage (93.8% of lines in scope) and runs a mutation sample that kills 25 of 25
  planted bugs. The sample caught one weak test, which now covers forged ballots under a
  foreign key.

## 2026-10-06 — Security hardening, part 2

**Medium**
- Admin actions (create vote, settings, auditors, disclosures, solvency posts) now require an
  admin wallet; before, any signed-in wallet could call them.
- The on-chain Groth16 verifier rejects public inputs at or above the field modulus. A valid
  proof could previously be replayed with `threshold + r` to "verify" an absurd threshold.
- The members table (delegations, eligibility leaves) is no longer readable by anonymous clients.
- Unstakes have a 1 QRM minimum and stake confirmations are rate limited, so the authority's
  SOL can't be drained with dust transactions.
- Database connections verify TLS against Supabase's root CA (previously unverified).
- Tally verification pins the official tally key and checks that the published ciphertexts are
  the sum of the stored ballots.

**Low**
- Sign-in uses the standard Sign-In-With-Solana message (domain, URI, chain, issued-at, expiry),
  so wallets can flag a phishing site relaying our sign-in request.
- `register_vote` only accepts the QUORUM authority, so nobody can squat a vote's on-chain anchor.
- Sealed proposals commit to `sha256(salt || plaintext)`; the salt is published at reveal.
- Tally-node and hardware-attestation rows no longer show a verified tick; they are labelled as
  planned.

## 2026-10-06 — Security hardening

Fixes from an AI-assisted security audit. All 4 Critical and all 5 High findings are closed.

**Critical**
- Unstake could be called concurrently and pay out more than was staked. The ledger is now
  debited first under row locks; payouts are refunded only if the transfer never happened.
- One eligibility proof could be replayed by rewriting the nullifier as `"0"+N` or hex. Public
  signals must now be canonical decimals.
- A wallet could re-register a new identity and vote again. Identity commitments are now
  write-once.
- A ballot could encrypt any number (e.g. 1000 votes) or a malformed value that broke the tally.
  Every ballot now carries zero-knowledge proofs that each entry is 0 or 1 and the row sums to 1.

**High**
- Two ledger tables were writable by anonymous clients. Row-level security now denies them.
- Any wallet could end any vote early. Only the creator can tally, and only after the vote closes.
- The faucet paid from the same account that held stakes. Stakes now sit in a separate vault, and
  the faucet has a global daily budget.
- Any signed-in wallet was an eligible voter. Eligibility now requires a registered identity and
  at least 100 QRM staked, and each vote freezes its eligible set when it opens.

**Dependencies**
- TanStack Start 1.168.60 (fixes a server-function deserialization advisory in `seroval`).
- Security-critical libraries pinned to exact versions; dependency install scripts disabled.

**Tooling**
- CI: type check, tests, build, `cargo test`, clippy, cargo-audit, circomspect, Semgrep and a
  gitleaks history scan on every push.
