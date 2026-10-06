import { createFileRoute, Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — QUORUM" },
      { name: "description", content: "QUORUM protocol documentation: sealed ballot voting, hidden proposals, confidential treasury, ZK eligibility, QRM staking, on chain anchoring, and the @quorum/sdk." },
    ],
  }),
  component: DocsPage,
});

const palette = {
  bg: "#0a0b1f",
  bgDeep: "#06071a",
  gold: "#d4af4f",
  fg: "#ece8d8",
  muted: "rgba(236,232,216,0.66)",
  indigo: "#8a7bd8",
  border: "rgba(212,175,79,0.22)",
  borderSoft: "rgba(236,232,216,0.09)",
  panel: "rgba(20,22,50,0.45)",
};

type NavItem = { id: string; label: string };

const SECTIONS: NavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "auth", label: "Wallet Authentication" },
  { id: "voting", label: "Sealed Ballot Voting" },
  { id: "proposals", label: "Hidden Proposals" },
  { id: "treasury", label: "Confidential Treasury" },
  { id: "members", label: "Members and Delegation" },
  { id: "staking", label: "QRM Staking" },
  { id: "proofs", label: "Proofs and Verification" },
  { id: "onchain", label: "On Chain Anchoring" },
  { id: "sdk", label: "Developer SDK" },
  { id: "security", label: "Security Model" },
];

/* ── small presentational primitives ── */

function Code({ children }: { children: string }) {
  return (
    <pre style={{
      margin: "1rem 0 0", padding: "1rem 1.25rem", borderRadius: "0.85rem",
      background: "rgba(5,6,18,0.72)", border: `1px solid ${palette.borderSoft}`,
      color: palette.fg, fontSize: "0.82rem", overflowX: "auto", lineHeight: 1.6,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    }}>{children}</pre>
  );
}

function Callout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      margin: "1.25rem 0 0", padding: "1rem 1.25rem", borderRadius: "0.85rem",
      background: "rgba(212,175,79,0.06)", border: `1px dashed ${palette.border}`,
    }}>
      <div style={{ fontSize: "0.68rem", letterSpacing: "0.2em", textTransform: "uppercase", color: palette.gold, marginBottom: "0.4rem" }}>{label}</div>
      <div style={{ fontSize: "0.9rem", opacity: 0.82, lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function DefTable({ rows, head }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <div style={{ marginTop: "1rem", overflowX: "auto", borderRadius: "0.85rem", border: `1px solid ${palette.borderSoft}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem", minWidth: "34rem" }}>
        <thead>
          <tr>
            <th style={thStyle}>{head[0]}</th>
            <th style={thStyle}>{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b], i) => (
            <tr key={i}>
              <td style={{ ...tdStyle, color: palette.gold, whiteSpace: "nowrap", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.8rem" }}>{a}</td>
              <td style={{ ...tdStyle, opacity: 0.82 }}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "0.7rem 1rem", fontSize: "0.68rem", letterSpacing: "0.16em",
  textTransform: "uppercase", color: palette.muted, borderBottom: `1px solid ${palette.borderSoft}`,
  background: "rgba(255,255,255,0.02)",
};
const tdStyle: React.CSSProperties = {
  padding: "0.7rem 1rem", borderBottom: `1px solid ${palette.borderSoft}`, verticalAlign: "top",
};

function Section({ id, title, kicker, children }: { id: string; title: string; kicker?: string; children: ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: "6rem", marginBottom: "3.5rem" }}>
      {kicker && <div style={{ fontSize: "0.68rem", letterSpacing: "0.2em", textTransform: "uppercase", color: palette.gold, marginBottom: "0.5rem" }}>{kicker}</div>}
      <h2 style={{ fontSize: "1.7rem", fontWeight: 300, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
      <div style={{ marginTop: "1rem", fontSize: "0.95rem", lineHeight: 1.75, color: palette.fg }}>{children}</div>
    </section>
  );
}

function P({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ margin: "0 0 0.9rem", opacity: 0.85, ...style }}>{children}</p>;
}

function Mono({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "0.85em", color: palette.indigo }}>{children}</code>;
}

/* ── page ── */

function DocsPage() {
  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse at top right, rgba(138,123,216,0.14), transparent 55%), ${palette.bgDeep}`,
      color: palette.fg, fontFamily: "'Sarabun', system-ui, -apple-system, sans-serif",
    }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@200;400;500;600&display=swap" />
      <style>{`
        html { scroll-behavior: smooth; }
        .docs-shell { display: grid; grid-template-columns: 16rem minmax(0, 1fr); gap: 2.5rem; max-width: 78rem; margin: 0 auto; padding: 3rem 2rem 6rem; }
        .docs-side { position: sticky; top: 5.5rem; align-self: start; max-height: calc(100vh - 7rem); overflow-y: auto; }
        .docs-side a { display: block; padding: 0.4rem 0.75rem; border-radius: 0.55rem; color: ${palette.muted}; text-decoration: none; font-size: 0.85rem; border-left: 2px solid transparent; }
        .docs-side a:hover { color: ${palette.fg}; background: rgba(255,255,255,0.03); }
        .docs-nav a { color: ${palette.fg}; text-decoration: none; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.14em; opacity: 0.78; }
        .docs-nav a:hover { opacity: 1; color: ${palette.gold}; }
        .docs-nav a.active { color: ${palette.gold}; opacity: 1; }
        @media (max-width: 860px) {
          .docs-shell { grid-template-columns: 1fr; gap: 1.5rem; padding: 1.5rem 1.15rem 4rem; }
          .docs-side { position: static; max-height: none; border: 1px solid ${palette.borderSoft}; border-radius: 0.9rem; padding: 0.75rem; margin-bottom: 1rem; }
          .docs-nav { gap: 0.9rem !important; }
          .docs-nav .hide-sm { display: none; }
        }
      `}</style>

      {/* top navbar */}
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "1.15rem 2rem", borderBottom: `1px solid ${palette.border}`,
        background: "rgba(10,11,31,0.85)", backdropFilter: "blur(16px)",
        position: "sticky", top: 0, zIndex: 30,
      }}>
        <Link to="/" style={{ color: palette.fg, textDecoration: "none", letterSpacing: "0.32em", fontWeight: 500 }}>
          QUORU<span style={{ color: palette.gold }}>M</span>
        </Link>
        <nav className="docs-nav" style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <Link to="/" className="hide-sm">Home</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/docs" className="active">Docs</Link>
          <Link to="/terms" className="hide-sm">Terms</Link>
          <Link to="/privacy" className="hide-sm">Privacy</Link>
        </nav>
      </header>

      <div className="docs-shell">
        {/* sidebar */}
        <aside className="docs-side">
          <div style={{ fontSize: "0.66rem", letterSpacing: "0.2em", textTransform: "uppercase", color: palette.gold, padding: "0 0.75rem 0.6rem" }}>
            Documentation
          </div>
          <nav>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}>{s.label}</a>
            ))}
          </nav>
        </aside>

        {/* content */}
        <main style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.72rem", letterSpacing: "0.22em", textTransform: "uppercase", color: palette.gold, marginBottom: "0.9rem" }}>
            ( QRM ) · Protocol Documentation
          </div>
          <h1 style={{ fontSize: "min(3.4rem, 8vw)", fontWeight: 200, margin: 0, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
            Confidential governance,<br /><span style={{ color: palette.gold }}>documented end to end.</span>
          </h1>
          <p style={{ marginTop: "1.25rem", fontSize: "1.05rem", lineHeight: 1.7, opacity: 0.8, maxWidth: "44rem" }}>
            QUORUM is confidential governance infrastructure for Solana organizations. Private inputs,
            public proof. This guide explains how each module works, what runs in your browser, what
            runs on the server, and what is settled on chain.
          </p>

          <div style={{ height: "2.5rem" }} />

          <Section id="overview" kicker="Introduction" title="Overview">
            <P>
              QUORUM lets a DAO vote, propose, and manage a treasury without leaking the information
              that makes governance manipulable. Ballots are encrypted in your browser, eligibility is
              proven with zero knowledge, the running tally stays hidden until close, and the final
              result is verifiable by anyone. Proposals stay sealed until execution, so there is no
              front running window. Treasury records stay confidential, with solvency proven by range
              proof and selective disclosure to auditors.
            </P>
            <P>The protocol is organized into modules, each backed by real cryptography rather than a placeholder:</P>
            <DefTable
              head={["Module", "What it provides"]}
              rows={[
                ["Voting", "Sealed ballots, ZK eligibility, threshold tally, verifiable correctness."],
                ["Proposals", "Hidden until execution, commit reveal, on pass or timelock."],
                ["Treasury", "Confidential balances, ZK solvency proofs, auditor disclosure."],
                ["Members", "Eligibility snapshot and private delegation of voting weight."],
                ["Staking", "Real Token 2022 QRM staking that settles on chain on devnet."],
                ["Proofs", "A public surface where anyone verifies the protocol was honest."],
              ]}
            />
          </Section>

          <Section id="architecture" kicker="How it fits together" title="Architecture">
            <P>
              The frontend is a TanStack Start React application. The governance API is a set of typed
              server functions, not a separate service, each validated with zod. Persistent state lives
              in Supabase Postgres. Cryptographic settlement happens on Solana devnet through a single
              consolidated program.
            </P>
            <Code>{`Browser (React, client side crypto + in browser ZK proving)
   |  Sign In With Solana, sealed ballot, proof generation
   v
Server functions (createServerFn, zod validated, session JWT)
   |
   +--> Supabase Postgres   commitments, nullifiers, proofs, encrypted records
   +--> Solana devnet        program "quorum_anchor": eligibility root, tally hash,
                             on chain Groth16 verifier, QRM Token 2022 staking`}</Code>
            <P>
              A deliberate design choice keeps cost near zero: the chain stores roots and hashes, never
              per ballot accounts. All ballots and commitments live in Postgres, and a single Merkle
              root per vote plus the final result hash are anchored on chain.
            </P>
            <Callout label="Source">
              Server functions live in <Mono>src/fn</Mono>. Client crypto lives in <Mono>src/lib/crypto</Mono>.
              Solana helpers live in <Mono>src/lib/solana</Mono>. The on chain program is under <Mono>onchain/</Mono>.
            </Callout>
          </Section>

          <Section id="auth" kicker="Sign In With Solana" title="Wallet Authentication">
            <P>
              Authentication proves wallet ownership without a password. The client requests a nonce,
              the wallet signs a canonical message, and the server verifies the signature with tweetnacl
              and issues a session cookie. QUORUM never asks for a seed phrase and never takes custody.
            </P>
            <Code>{`// client
const { nonce, message } = await requestNonce({ data: { wallet } });
const signature = await wallet.signMessage(message);
await verifySignature({ data: { wallet, nonce, signature } });
// server sets an HttpOnly session cookie; getMe() restores the session`}</Code>
            <P>
              Nonces are single use and expire, which prevents replay. Ballots are never linked to the
              session: the session gates spam, but the stored ballot is anonymous by construction.
            </P>
          </Section>

          <Section id="voting" kicker="Module I" title="Sealed Ballot Voting">
            <P>
              A voter proves eligibility with a zero knowledge proof, encrypts the choice in the browser,
              and submits a sealed ballot. No one, including QUORUM, can read the choice until the tally
              runs. The running count of ballots is public, the choices are not.
            </P>
            <P><strong style={{ color: palette.gold }}>1. Encrypt the choice.</strong> The vote is one hot encoded over the option set and encrypted with exponential ElGamal over Ristretto255. Because the scheme is additively homomorphic, encrypted ballots can be summed and only the totals decrypted.</P>
            <P><strong style={{ color: palette.gold }}>2. Prove eligibility.</strong> The browser generates a Groth16 proof of membership in the eligibility Merkle tree plus a unique nullifier, without revealing identity or balance. The nullifier prevents double voting.</P>
            <P><strong style={{ color: palette.gold }}>3. Tally with a threshold key.</strong> Decryption uses a 3 of 5 threshold key produced by a Pedersen DKG, so no single party holds the secret. The server sums the ciphertexts and recovers only the per option totals.</P>
            <P><strong style={{ color: palette.gold }}>4. Prove the tally is honest.</strong> Each partial decryption carries a Chaum Pedersen DLEQ proof. Anyone can verify that the announced totals are the honest decryption of the sealed ballots, with no trust in the server.</P>
            <Callout label="Receipt free">
              The protocol re randomizes ciphertexts so a voter cannot prove to a briber what they
              submitted. The participation receipt proves that you voted, never how you voted.
            </Callout>
            <DefTable
              head={["Server function", "Purpose"]}
              rows={[
                ["castBallot", "Verify the ZK proof against the live root, store the nullifier and ciphertext."],
                ["runTally", "Sum ciphertexts, threshold decrypt, write totals plus a DLEQ transcript."],
                ["verifyTally", "Re verify the DLEQ transcript so totals are provably correct."],
              ]}
            />
          </Section>

          <Section id="proposals" kicker="Module II" title="Hidden Proposals">
            <P>
              Proposals are submitted encrypted. Only their existence, author eligibility, and voting
              rules are public. The content is revealed at execution or after a timelock, which removes
              the front running window entirely.
            </P>
            <P>
              The body is encrypted in the browser with AES GCM and bound by a SHA 256 commitment. Only
              the ciphertext and the commitment reach the server. The author keeps the plaintext and
              reveals later, at which point the server checks the plaintext against the commitment.
            </P>
            <Code>{`const { encPayload, commitHash } = await sealProposal(text); // client side
await submitProposal({ data: { encPayload, commitHash, reveal: "on_pass" } });
// later, only the author can reveal:
await revealProposal({ data: { proposalId, plaintext } }); // commit is verified`}</Code>
            <P>Reveal policy is either <Mono>on_pass</Mono>, released once the vote passes, or <Mono>timelock</Mono>, released after a set window. The server rejects a reveal whose plaintext does not match the commitment.</P>
          </Section>

          <Section id="treasury" kicker="Module III" title="Confidential Treasury">
            <P>
              Treasury holdings stay confidential while remaining accountable. Solvency is proven with a
              zero knowledge range proof, and individual records can be disclosed to a chosen auditor
              without exposing the rest of the treasury.
            </P>
            <P><strong style={{ color: palette.gold }}>Solvency proofs.</strong> The operator enters the real reserve balance and a public threshold. The browser generates a Groth16 range proof that reserves are at least the threshold, and only the proof and a commitment leave. The balance stays hidden. The proof is also verified on chain by the program.</P>
            <P><strong style={{ color: palette.gold }}>Selective disclosure.</strong> A single record is encrypted to one auditor public key with ECIES over Ristretto255. Only the holder of that auditor secret can read it.</P>
            <DefTable
              head={["Server function", "Purpose"]}
              rows={[
                ["recordSolvencyProof", "Store a ZK range proof of reserves, optionally verified on chain."],
                ["issueDisclosure", "Encrypt one record to an auditor public key (ECIES)."],
                ["addAuditor, revokeAuditor", "Manage the auditor keys authorized for disclosure."],
              ]}
            />
          </Section>

          <Section id="members" kicker="Module IV" title="Members and Delegation">
            <P>
              Eligibility is committed as a zero knowledge Merkle snapshot. Members can vote, or privately
              delegate their voting weight to another eligible member, without exposing balances or
              linking identities. Delegated weight is aggregated privately at tally time.
            </P>
            <Code>{`await setDelegation({ data: { delegate } });   // delegate must be an eligible member
await clearDelegation();                        // vote your own weight again`}</Code>
            <P>The server enforces two rules: you cannot delegate to yourself, and the target must already be an eligible member. Nullifiers continue to prevent double voting across delegation.</P>
          </Section>

          <Section id="staking" kicker="Network" title="QRM Staking">
            <P>
              QRM is a Token 2022 mint on devnet. Staking is a real on chain transfer from your wallet to
              the protocol vault, confirmed by the server before the ledger is credited. Tally nodes stake
              QRM to run the confidential counting network and earn per vote fees. Misbehavior, such as
              leaking a ballot, censoring, or a false tally, is slashed.
            </P>
            <Code>{`await qrmFaucet();                              // devnet drip of QRM
const sig = await wallet.signAndSendTransaction(stakeTx); // Token 2022 transfer to the vault
await confirmStake({ data: { signature: sig } });         // server confirms on devnet, credits
await unstakeQrm({ data: { amount } });                   // vault returns QRM, debits the ledger`}</Code>
            <Callout label="Browser note">
              The Solana SDK expects the global <Mono>Buffer</Mono>, which browsers do not provide by
              default. QUORUM polyfills it before the SDK runs, so the wallet transfer builds correctly.
            </Callout>
          </Section>

          <Section id="proofs" kicker="Public trust surface" title="Proofs and Verification">
            <P>
              The Proofs surface publishes every closed vote, tally attestation, treasury solvency proof,
              and tally node record with one click verification. Verification requires no wallet and no
              trust in QUORUM, which is the point: an outsider can confirm the protocol was honest.
            </P>
            <P>Two levels of verification exist. A record level check confirms a verified proof exists for a reference. A cryptographic check re runs the DLEQ math on the tally transcript itself.</P>
          </Section>

          <Section id="onchain" kicker="Settlement" title="On Chain Anchoring">
            <P>
              A single Anchor program, <Mono>quorum_anchor</Mono>, is deployed to Solana devnet. It anchors
              the eligibility root and the tally result hash, and it embeds a real BN254 Groth16 verifier
              built on the <Mono>alt_bn128</Mono> syscalls, which verifies solvency proofs on chain. The
              footprint is intentionally tiny: roots and hashes, never per ballot accounts, so rent stays
              minimal and vote accounts are closable.
            </P>
            <DefTable
              head={["Anchored item", "Meaning"]}
              rows={[
                ["eligibility_root", "The Merkle root of the eligibility snapshot for a vote."],
                ["tally hash", "A commitment to the final result and the correctness transcript."],
                ["solvency proof", "A treasury range proof verified on chain by the program."],
              ]}
            />
          </Section>

          <Section id="sdk" kicker="For integrators" title="Developer SDK">
            <P>
              The <Mono>@quorum/sdk</Mono> package exposes the same client side primitives QUORUM uses in
              production, so anything you seal is compatible with the live tally. Everything runs client
              side: no server, no secret keys, no trust. You seal with public inputs, and you verify with
              only the published transcript.
            </P>
            <Code>{`npm add @quorum/sdk

import { sealBallot, verifyTally } from "@quorum/sdk";

// Seal a vote client side. Your choice never leaves the browser in the clear.
const ballot = await sealBallot(tallyPubkey, "yes", ["yes", "no", "abstain"]);

// Verify any published tally trustlessly. No server, no keys.
const { verified, totals } = verifyTally(transcript);`}</Code>
            <DefTable
              head={["Export", "Purpose"]}
              rows={[
                ["sealBallot", "Encrypt a one hot vote to the tally key, returns ciphertext and commitment."],
                ["verifyTally", "Trustlessly verify announced totals with DLEQ proofs."],
                ["sealProposal, verifyProposalReveal", "Commit a hidden proposal and check a later reveal."],
                ["generateAuditorKey, encryptToAuditor, decryptAsAuditor", "ECIES selective disclosure."],
              ]}
            />
            <P style={{ marginTop: "1rem" }}>The current release covers sealing and verification. Driving a deployment, such as creating votes or submitting ballots, uses authenticated server functions and is paired with your own transport.</P>
          </Section>

          <Section id="security" kicker="Guarantees" title="Security Model">
            <P>QUORUM is designed to fail closed. Each guarantee is enforced by cryptography, not by policy.</P>
            <DefTable
              head={["Property", "How it holds"]}
              rows={[
                ["Ballot privacy", "Choices are encrypted client side to a threshold key; no single party can decrypt."],
                ["Receipt freeness", "Ciphertexts are re randomized, so a voter cannot prove a choice to a briber."],
                ["No double voting", "A unique nullifier per voter per vote, enforced in the database and at tally."],
                ["Tally correctness", "Chaum Pedersen DLEQ proofs make the totals verifiable by anyone."],
                ["No live tally", "The running result is hidden until close, which defeats whale following."],
                ["Solvency without exposure", "A range proof proves reserves meet a threshold while the balance stays hidden."],
                ["Fails closed", "An invalid proof is rejected; no valid proof means no execution."],
              ]}
            />
            <Callout label="Status">
              QUORUM runs on Solana devnet. A mainnet promotion is gated behind third party audits. Review
              audits before relying on the protocol with real value.
            </Callout>
          </Section>

          <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: `1px solid ${palette.borderSoft}`, display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Link to="/dashboard" style={{
              display: "inline-flex", alignItems: "center", padding: "0.7rem 1.5rem", borderRadius: "2rem",
              background: palette.gold, color: palette.bg, textDecoration: "none", fontWeight: 500,
              fontSize: "0.78rem", letterSpacing: "0.14em", textTransform: "uppercase",
            }}>Open the Dashboard</Link>
          </div>
        </main>
      </div>

      <footer style={{ padding: "2rem", textAlign: "center", opacity: 0.55, fontSize: "0.8rem", borderTop: `1px solid ${palette.border}` }}>
        © 2026 QUORUM. Confidential Governance Infrastructure on Solana.
      </footer>
    </div>
  );
}
