import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — QUORUM" },
      { name: "description", content: "QUORUM Terms of Service. Confidential governance infrastructure on Solana." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return <LegalPage title="Terms of Service" updated="June 2026" sections={SECTIONS} />;
}

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "1. Acceptance of Terms",
    p: [
      "By accessing or using QUORUM (the “Protocol”), including the quorum.app interface, the QUORUM Voting App, the DAO Console, the Proof Explorer, the QRM token-2022 contracts, the staking program, and the Realms integration adapter (collectively, the “Services”), you agree to be bound by these Terms of Service.",
      "If you do not agree, do not use the Services. The Services are provided on an as-is, as-available basis.",
    ],
  },
  {
    h: "2. Nature of the Protocol",
    p: [
      "QUORUM is confidential governance infrastructure: sealed-ballot voting, hidden-until-execution proposals, confidential treasury with selective disclosure, and a staked tally network operating on Solana.",
      "The Protocol is non-custodial. QUORUM does not take custody of your wallet, votes, or treasury assets. Eligibility is proven with zero-knowledge proofs; ballots are encrypted client-side before submission.",
    ],
  },
  {
    h: "3. Wallets and Eligibility",
    p: [
      "You are solely responsible for the security of your Solana wallet (Phantom, Solflare, or compatible) and any private keys. QUORUM will never ask for seed phrases.",
      "Voting eligibility is determined per-DAO by snapshot rules configured by that DAO. QUORUM enforces eligibility cryptographically and does not adjudicate disputes between members of a DAO.",
    ],
  },
  {
    h: "4. QRM Token",
    p: [
      "QRM is a Token-2022 utility token used to stake tally nodes, secure the confidential counting network, and participate in protocol governance. QRM is not an investment contract, security, or claim on revenue of any entity.",
      "Acquiring, holding, or staking QRM may be restricted in your jurisdiction. You are responsible for compliance with applicable laws, including securities, tax, and sanctions regulations.",
    ],
  },
  {
    h: "5. Staking and Slashing",
    p: [
      "Stakers and tally-node operators agree to the slashing conditions encoded in the staking program, including penalties for ballot leakage, censorship, false tally, and prolonged unavailability. Slashing is executed by the protocol and is irreversible.",
    ],
  },
  {
    h: "6. No Live Tally; No Vote Markets",
    p: [
      "QUORUM intentionally hides running results until a vote closes. Attempts to circumvent ballot confidentiality, including operating side-channels, vote-buying markets, or coercion infrastructure, are prohibited and may result in eligibility revocation by participating DAOs.",
    ],
  },
  {
    h: "7. Confidential Treasury",
    p: [
      "Confidential treasury balances and transfers use Token-2022 Confidential Balances. Selective disclosure to auditors is governed by auditor keys held by the DAO. QUORUM has no access to plaintext treasury data.",
    ],
  },
  {
    h: "8. No Warranties",
    p: [
      "The Services are provided “as is” without warranties of any kind. QUORUM disclaims all implied warranties of merchantability, fitness for a particular purpose, and non-infringement. Cryptographic protocols may contain bugs; you should review audits before use.",
    ],
  },
  {
    h: "9. Limitation of Liability",
    p: [
      "To the maximum extent permitted by law, QUORUM, its contributors, and affiliates shall not be liable for any indirect, incidental, special, consequential, or exemplary damages, including loss of funds, votes, or data, arising from your use of the Services.",
    ],
  },
  {
    h: "10. Changes",
    p: [
      "These Terms may be updated as the Protocol evolves. Continued use of the Services after an update constitutes acceptance of the revised Terms.",
    ],
  },
];

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { h: string; p: string[] }[] }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0b1f", color: "#ece8d8", fontFamily: "'Sarabun', system-ui, sans-serif" }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@200;400;500&display=swap" />
      <header style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "1.5rem 3.125rem", borderBottom: "1px solid rgba(212,175,79,0.25)",
        background: "rgba(10,11,31,0.85)", backdropFilter: "blur(16px)", position: "sticky", top: 0, zIndex: 30,
      }}>
        <Link to="/" style={{ color: "#ece8d8", textDecoration: "none", letterSpacing: "0.35em", fontWeight: 500 }}>
          QUORU<span style={{ color: "#d4af4f" }}>M</span>
        </Link>
        <nav style={{ display: "flex", gap: "1.5rem" }}>
          <Link to="/" style={navLink}>Home</Link>
          <Link to="/dashboard" style={navLink}>Dashboard</Link>
          <Link to="/docs" style={navLink}>Docs</Link>
          <Link to="/terms" style={navLink}>Terms</Link>
          <Link to="/privacy" style={navLink}>Privacy</Link>
        </nav>
      </header>
      <main style={{ maxWidth: "52rem", margin: "0 auto", padding: "4rem 2rem 6rem" }}>
        <div style={{ fontSize: "0.75rem", letterSpacing: "0.22em", textTransform: "uppercase", color: "#d4af4f", marginBottom: "1rem" }}>
          ( QRM ) · Legal · Last updated {updated}
        </div>
        <h1 style={{ fontSize: "min(4rem, 8vw)", fontWeight: 200, margin: 0, letterSpacing: "-0.01em" }}>{title}</h1>
        <div style={{ marginTop: "3rem", display: "grid", gap: "2.5rem" }}>
          {sections.map((s) => (
            <section key={s.h}>
              <h2 style={{ fontSize: "1.3rem", fontWeight: 500, color: "#d4af4f", marginBottom: "0.75rem" }}>{s.h}</h2>
              {s.p.map((para, i) => (
                <p key={i} style={{ opacity: 0.8, lineHeight: 1.7, marginBottom: "0.75rem" }}>{para}</p>
              ))}
            </section>
          ))}
        </div>
      </main>
      <footer style={{ padding: "2rem", textAlign: "center", opacity: 0.55, fontSize: "0.8rem", borderTop: "1px solid rgba(212,175,79,0.2)" }}>
        © 2026 QUORUM. Confidential Governance Infrastructure on Solana.
      </footer>
    </div>
  );
}

const navLink: React.CSSProperties = {
  color: "#ece8d8", textDecoration: "none", fontSize: "0.85rem",
  textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.8,
};
