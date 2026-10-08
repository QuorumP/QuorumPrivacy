import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "./terms";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — QUORUM" },
      { name: "description", content: "QUORUM Privacy Policy. Sealed ballots, confidential treasury, zero collection of personally identifiable governance data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return <LegalPage title="Privacy Policy" updated="June 2026" sections={SECTIONS} />;
}

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "1. Our Privacy Principle",
    p: [
      "QUORUM exists to remove the show of hands from on-chain governance. Privacy is not a setting — it is the architecture.",
      "Individual votes are sealed and proposal payloads are hidden until execution. On devnet today the threshold tally key's shares are all held by the operator's server, so the operator could technically decrypt an individual ballot; distributing those shares to independent operators is planned. The treasury is a regular Token-2022 account whose balance is public on chain.",
    ],
  },
  {
    h: "2. What QUORUM Does NOT Collect",
    p: [
      "We do not collect: your individual vote choice, your treasury balance, the plaintext of hidden proposals, your private key or seed phrase, your real-world identity, or your IP-to-wallet linkage.",
      "Sealed ballots are encrypted client-side using threshold encryption. On devnet the tally is computed by the operator's server, which decrypts only the per-option totals and publishes proofs that anyone can use to verify them. Only the eligibility root, the ballot-commitment root and the result hash are written on-chain.",
    ],
  },
  {
    h: "3. What Is Public On-Chain",
    p: [
      "By the nature of Solana, the following are public: your wallet address; the fact that an eligible wallet cast a ballot in a given vote (without the choice); aggregate vote results; QRM stake amounts; tally-node identities; published ZK proofs and attestations; confidential-treasury solvency proofs.",
      "Treasury balances and transfers are not encrypted on devnet today: the treasury is a regular Token-2022 account and its balance is public on chain. Solvency proofs publish a threshold and a commitment, not the amount. Token-2022 Confidential Balances are planned. Auditor-key holders configured by each DAO can read records disclosed to them.",
    ],
  },
  {
    h: "4. Interface Telemetry",
    p: [
      "The QUORUM web interface uses minimal, privacy-preserving operational telemetry (e.g. aggregate page-view counts and error reports). We do not use third-party advertising trackers. We do not sell data. There are no cookies that link your wallet to your browser fingerprint.",
    ],
  },
  {
    h: "5. Wallet Connection",
    p: [
      "When you connect Phantom or Solflare, the interface receives your public key only. Connection is used exclusively to prove eligibility (via ZK) and to submit signed, encrypted ballots. We never request signature of arbitrary messages or transactions you did not initiate.",
    ],
  },
  {
    h: "6. Email Subscriptions",
    p: [
      "If you submit an email for protocol updates, that email is stored only for sending those updates. You can unsubscribe at any time. We do not link email addresses to wallets or votes.",
    ],
  },
  {
    h: "7. Selective Disclosure",
    p: [
      "DAOs may configure auditor keys allowing targeted disclosure of specific treasury records to designated parties (e.g. members, regulators). Disclosure is per-record and per-auditor — QUORUM itself has no master key and cannot decrypt your DAO's data.",
    ],
  },
  {
    h: "8. Children",
    p: [
      "The Services are not directed at individuals under 18.",
    ],
  },
  {
    h: "9. Changes",
    p: [
      "Updates to this policy will be posted here. Material changes will be announced via the protocol updates channel.",
    ],
  },
];

