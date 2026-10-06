import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QUORUM — Confidential Governance Infrastructure on Solana" },
      { name: "description", content: "The Secret Ballot, Brought On-Chain. Sealed votes, provable tally, confidential treasury for serious onchain organizations." },
      { property: "og:title", content: "QUORUM — Confidential Governance on Solana" },
      { property: "og:description", content: "Private inputs. Public proof. Confidential governance infrastructure for DAOs, protocols and foundations." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/clarix.html"
      title="Clarix"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: 0,
        margin: 0,
        padding: 0,
        display: "block",
      }}
    />
  );
}
