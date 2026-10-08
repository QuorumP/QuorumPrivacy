<p align="center">
  <img src="public/quorum-q-logo.png" alt="QUORUM" width="112" />
</p>

<h1 align="center">QUORUM</h1>

<p align="center"><strong>Confidential governance infrastructure for Solana.</strong></p>
<p align="center"><em>Private inputs. Public proof.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/network-Solana%20devnet-8a7bd8" alt="Solana devnet" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/crypto-Ristretto255%20%2B%20Groth16-d4af4f" alt="Cryptography" />
  <img src="https://img.shields.io/badge/license-MIT-ece8d8" alt="MIT" />
</p>

---

QUORUM lets a DAO vote, propose, and manage a treasury without leaking the information that makes
governance manipulable. Ballots are encrypted in the browser, eligibility is proven with zero
knowledge, the running tally stays hidden until close, and the final result is verifiable by anyone.
Proposals stay sealed until execution, so there is no front running window. Treasury solvency is
proven by range proof against the real treasury account, with selective disclosure to auditors.

**Live app:** https://quorumprivacy.com

## Modules

| Module | What it provides |
| :-- | :-- |
| Sealed ballot voting | One hot ballots encrypted client side, ZK eligibility, threshold tally, verifiable correctness. |
| Hidden proposals | Encrypted until execution, commit reveal, released on pass or after a timelock. |
| Confidential treasury | ZK solvency proofs bound to the treasury account, selective disclosure to auditors. Confidential balances are planned. |
| Members and delegation | Eligibility (registered identity + 100 QRM staked) frozen per vote as a ZK snapshot; delegation of voting weight. |
| QRM staking | Real Token 2022 staking that settles on chain into a dedicated vault. |
| Proofs and verification | A public surface where anyone can check eligibility, tally and solvency proofs. |

## How it works

**Sealed ballot voting.** A vote is one hot encoded and encrypted with exponential ElGamal over
Ristretto255. Because the scheme is additively homomorphic, encrypted ballots are summed and only the
per option totals are decrypted. Eligibility is proven in the browser with a Groth16 proof of
membership in a Merkle tree plus a unique nullifier, which prevents double voting without revealing
identity or balance. Each ballot also carries proofs that every entry encrypts 0 or 1 and that the
row sums to 1, so a ballot can't carry extra votes. Only members with a registered identity and at
least 100 QRM staked are eligible, and each vote freezes its eligible set when it opens. Decryption
uses a 3 of 5 threshold key; each partial decryption carries a Chaum Pedersen DLEQ proof, so anyone
can verify that the announced totals are the honest decryption of the sealed ballots.

**Hidden proposals.** The body is encrypted with AES GCM and bound by a salted SHA 256 commitment. Only the
ciphertext and the commitment reach the server. The author reveals later, and the server checks the
plaintext against the commitment. Reveal is either on pass or after a timelock.

**Confidential treasury.** Solvency is proven with a Groth16 range proof over the real treasury account
(`8EgMeBoKGRdk34YfpCUuW9xwXtgg6wbmfr6hx4sVDvGt`): the server reads its balance from chain at a finalized slot and proves it meets a
public threshold, so no one types the balance in. The app publishes the proof, threshold, account and
slot but not the balance; the commitment's opening is sealed to each active auditor key. The program
verifies the proof on chain and only accepts it from the server's authority key. On devnet the account
is a plain Token-2022 account, so its balance is still readable on chain; confidential balances are planned. Individual
records are disclosed to a chosen auditor with ECIES over Ristretto255, so only that auditor can read
them.

## Architecture

```
Browser (React, client side crypto + in browser ZK proving)
   |  Sign In With Solana, sealed ballot, proof generation
   v
Server functions (typed, zod validated, session JWT)
   |
   +--> Postgres           commitments, nullifiers, proofs, encrypted records
   +--> Solana devnet       one program "quorum_anchor": eligibility root, tally hash,
                            on chain Groth16 verifier, Token 2022 staking
```

The chain stores roots and hashes, never per ballot accounts, so the on chain footprint and rent stay
minimal. All ballots and commitments live in the database; a single Merkle root per vote plus the
final result hash are anchored on chain.

## Security model

QUORUM is designed to fail closed.

| Property | How it holds |
| :-- | :-- |
| Ballot privacy | Choices are encrypted client side to a 3 of 5 threshold key. On devnet all shares run on the operator's server (see trust assumptions). |
| Ballot validity | Disjunctive Chaum Pedersen proofs: every entry is 0 or 1 and the row sums to 1. |
| Receipt freeness | Ciphertexts are re randomized, so a voter cannot prove a choice to a briber. |
| No double voting | One write-once identity per wallet, a unique nullifier per vote, and an eligible set frozen at vote creation. |
| Tally correctness | Chaum Pedersen DLEQ proofs make the totals verifiable by anyone. |
| No live tally | The running result is hidden until close, which defeats whale following. |
| Solvency without exposure | A range proof shows the treasury account's on-chain balance meets a threshold without the app publishing it (on devnet it is still readable on chain). |
| Fails closed | An invalid proof or malformed ballot is rejected and never stored. |

### Trust assumptions (devnet)

QUORUM is not yet trustless. Today:

- **The operator can decrypt individual ballots.** The tally key is 3 of 5 threshold, but all
  shares are held by one server. Tally *correctness* is still publicly verifiable.
- **One hot key holds every on-chain authority** (program upgrade, QRM mint and freeze, stake vault).
- **The Groth16 setup is single-party**, so its contributor could forge proofs.
- **Tally-node and TEE rows in the dashboard are illustrative**; no hardware attestation is verified.

The path to removing each of these is in [SECURITY.md](SECURITY.md).

## Developer SDK

The `@quorum/sdk` package exposes the same client side primitives QUORUM uses in production, so
anything you seal is compatible with the live tally. Everything runs client side: no server, no
secret keys, no trust.

```ts
import { sealBallot, verifyTally } from "@quorum/sdk";

// Seal a vote client side. Your choice never leaves the browser in the clear.
const ballot = await sealBallot(tallyPubkey, "yes", ["yes", "no", "abstain"]);

// Verify any published tally trustlessly. No server, no keys.
const { verified, totals } = verifyTally(transcript);
```

Pass `` `${voteId}|${nullifier}` `` as the fourth argument of `sealBallot` to bind its validity
proof to a ballot. See [`sdk/`](sdk/) for the full surface: `sealBallot`, `verifyTally`, `sealProposal`,
`verifyProposalReveal`, and the ECIES disclosure helpers.

## Tech stack

- **Frontend:** TanStack Start, React 19, TypeScript.
- **API:** typed server functions, validated with zod.
- **Data:** Postgres.
- **Chain:** Solana devnet, one Anchor program with an on chain BN254 Groth16 verifier.
- **Cryptography:** Ristretto255 ElGamal, Pedersen DKG threshold decryption, Chaum Pedersen DLEQ,
  Groth16 (circom + snarkjs), AES GCM, ECIES.

## Getting started

Requires [Bun](https://bun.sh) 1.3+ and Node 24 (`.nvmrc`). No credentials are included in this
repository.

```bash
bun install --frozen-lockfile   # exact, locked dependencies; install scripts are disabled
cp .env.example .env.local      # fill in every value (each one is described in the file)
bun run dev                     # start the app
bun run test                    # unit, server-function, property and circuit tests (no network)
bun run test:coverage           # same, with coverage thresholds
bun run test:mutants            # mutation sample: plants known bugs, expects the tests to catch them
bun run test:devnet             # against the deployed devnet program (needs a funded key in .devnet/)
bun run build                   # production build
```

Server-function tests need no database or RPC: they run against an in-process Postgres with the
real migrations and a fake devnet (`src/test/`). See [SECURITY.md](SECURITY.md) for the
invariants each suite holds.

**Database.** Apply the migrations in `supabase/migrations/` in order, either all at once with
`node scripts/db/apply-migrations.mjs` or one file with `node scripts/db/apply-one.mjs <file>`.

**Tally key.** `bun scripts/crypto/dkg.ts` generates a 3 of 5 key: set `TALLY_PUBKEY` and
`VITE_TALLY_PUBKEY` to the public key it prints and `TALLY_SHARES` to the JSON it prints.

**Token and vault.** `node scripts/token/mint-qrm.mjs` creates the QRM mint, then
`node scripts/token/create-stake-vault.mjs` creates the stake vault. Run the vault script before
deploying, and again after migrating stakes (it only tops up the shortfall).

**Program.** Toolchain pins: `onchain/rust-toolchain.toml`, Anchor 1.1.2 and Solana 4.1.0
(`onchain/Anchor.toml`). Build with `cargo-build-sbf` in `onchain/`, then deploy with
`node scripts/onchain/deploy.mjs`.

## Deployments (devnet)

| Item | Address |
| :-- | :-- |
| Program `quorum_anchor` | [`BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w`](https://explorer.solana.com/address/BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w?cluster=devnet) |
| QRM mint (Token-2022) | [`HjQdV3YTpdJmThMuxe9Tvx8zJV9fHxZo5T3cA8Fhgvsw`](https://explorer.solana.com/address/HjQdV3YTpdJmThMuxe9Tvx8zJV9fHxZo5T3cA8Fhgvsw?cluster=devnet) |
| Stake vault | [`DUbNMfraNdmo3R4L8Yfmhybw5pUmUcKUAGPnKZqw3jBz`](https://explorer.solana.com/address/DUbNMfraNdmo3R4L8Yfmhybw5pUmUcKUAGPnKZqw3jBz?cluster=devnet) |
| Treasury (solvency proofs) | [`8EgMeBoKGRdk34YfpCUuW9xwXtgg6wbmfr6hx4sVDvGt`](https://explorer.solana.com/address/8EgMeBoKGRdk34YfpCUuW9xwXtgg6wbmfr6hx4sVDvGt?cluster=devnet) |
| Upgrade / mint authority | [`9sjBajqChwe1BDCa9gxAG46qgJzMwgKPe1mi64T24ZYC`](https://explorer.solana.com/address/9sjBajqChwe1BDCa9gxAG46qgJzMwgKPe1mi64T24ZYC?cluster=devnet) |

**Build of record.** The live program is the `solana-verify build` of this source (Docker image
`solanafoundation/solana-verifiable-build:4.1.0@sha256:6468b89a…`, solana-verify 0.5.2). Its hash is in
[`onchain/BUILD_HASH`](onchain/BUILD_HASH):

```
45c1b0284bd4deb6d8dac3565132329baea4342f7c37ffeb9d84f2f20718052b
```

Reproduce it yourself:

```bash
cd onchain && solana-verify build --library-name quorum_anchor   --base-image solanafoundation/solana-verifiable-build:4.1.0@sha256:6468b89ae21d87b8eb002f894ac3f3442dbd8bcf5ea93414051e96e00d03b5ab
solana-verify get-executable-hash target/deploy/quorum_anchor.so
solana-verify get-program-hash -u devnet BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w
```

CI rebuilds it on every push and fails if the build, `BUILD_HASH` and the live program disagree.
`node scripts/onchain/post-deploy-check.mjs` (read-only) also checks the upgrade and mint authorities,
the vault and treasury accounts, and leftover deploy buffers. `scripts/onchain/deploy.mjs` only deploys a
binary whose hash is `BUILD_HASH`.

## Project structure

```
src/lib/crypto   ElGamal, threshold DKG, DLEQ, proposal seal, ECIES
src/lib/zk       Groth16 eligibility and solvency proving
src/lib/solana   Token 2022 staking, on chain verifier, program client
src/fn           the governance API (server functions)
src/routes       the app and the dashboard
onchain          the quorum_anchor Solana program
sdk              @quorum/sdk, the client side primitives
circuits         the circom circuits
```

## Status

QUORUM runs on Solana devnet. Mainnet is gated behind the checklist in [SECURITY.md](SECURITY.md),
including a third party security audit. Security fixes are listed in [CHANGELOG.md](CHANGELOG.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

MIT
