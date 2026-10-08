# Audit scope

**Audited version:** tag `audit-2026-10-08` (commit `2ccae37`, AI audit-grade rescore 9.1/10). Previous: `audit-2026-10-07` (`db8a57d`). Each new audit adds a tag `audit-YYYY-MM-DD`
on the commit it reviewed; diff two tags to see what changed between audits.
**Network:** Solana devnet only. Mainnet is out of scope until a separate external audit.

## In scope

Everything that enforces a rule or holds funds.

| Area | Files |
|---|---|
| On-chain program (`quorum_anchor`) | `onchain/programs/quorum_anchor/src/lib.rs`, `groth16.rs`, `groth16_vk.rs`, `Cargo.toml`, `onchain/Cargo.lock` |
| ZK circuits | `circuits/eligibility.circom`, `circuits/solvency.circom` |
| Verifying keys / proving artifacts | `src/lib/zk/verification_key.json`, `src/lib/zk/solvency_vkey.json`, `public/zk/*.zkey`, `public/zk/*.wasm` |
| Server functions (API surface) | `src/fn/actions.ts`, `src/fn/auth.ts`, `src/fn/data.ts`, `src/fn/zk.ts` |
| Auth + sessions | `src/lib/auth/jwt.server.ts`, `src/lib/auth/session.server.ts` |
| Ballot / tally crypto | `src/lib/crypto/elgamal.ts`, `threshold.ts`, `tally.server.ts`, `proposal.ts`, `ecies.ts` |
| ZK proving/verification + Merkle tree | `src/lib/zk/verify.server.ts`, `solvency.server.ts`, `tree.server.ts`, `poseidon.ts` |
| Token, staking, treasury, on-chain calls | `src/lib/solana/qrm.server.ts`, `anchor.server.ts`, `groth16.server.ts`, `idl.json` |
| Rate limiting | `src/lib/security/rateLimit.server.ts` |
| Database schema + RLS | `supabase/migrations/0001`–`0010` |
| Config / env handling | `src/lib/env.server.ts`, `src/lib/db/pool.server.ts` |

## Out of scope

- UI (`src/routes/`, `src/components/`), styling, marketing copy.
- Browser-only helpers that hold no authority: `src/lib/solana/stake.browser.ts`, `src/lib/zk/prove.ts`,
  `src/lib/supabase/browser.ts`, error reporting, `src/lib/utils.ts`.
- Tests (`**/*.test.ts`, `onchain/programs/quorum_anchor/src/tests.rs`, `test_vector.rs`) and `scripts/` —
  reviewed for correctness of the claims they back, not as attack surface.
- Third-party dependencies beyond `cargo audit` / lockfile review.

## Known and accepted risks

See [SECURITY.md](SECURITY.md): tally key on one server, single-party trusted setup, one hot authority key.
