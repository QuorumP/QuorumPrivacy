// Validate the actual src/lib/solana/anchor.server.ts + tally.server.ts against devnet.
// Loads .env.local, registers a fresh vote on-chain, anchors a tally, and runs a tally
// roundtrip. Run with: bun scripts/onchain/test-lib.ts
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const root = process.cwd();
for (const line of readFileSync(`${root}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const { registerVoteOnChain, anchorTallyOnChain, anchorConfigured } = await import("../../src/lib/solana/anchor.server.ts");
const { tallyBallots, tallyConfigured } = await import("../../src/lib/crypto/tally.server.ts");
const { encryptOneHot } = await import("../../src/lib/crypto/elgamal.ts");

console.log("anchorConfigured:", anchorConfigured(), "| tallyConfigured:", tallyConfigured());

const voteId = "qrm-lib-" + randomBytes(2).toString("hex");
const root32hex = BigInt("0x" + createHash("sha256").update("elig:" + voteId).digest("hex")).toString();
const sig1 = await registerVoteOnChain(voteId, root32hex);
console.log("registerVoteOnChain ✓", sig1.slice(0, 16), "…");

const ballotRoot = "0x" + createHash("sha256").update("ballots").digest("hex");
const resultHash = "0x" + createHash("sha256").update(JSON.stringify({ yes: 2, no: 1, abstain: 0 })).digest("hex");
const sig2 = await anchorTallyOnChain(voteId, ballotRoot, resultHash);
console.log("anchorTallyOnChain  ✓", sig2.slice(0, 16), "…");

// tally lib roundtrip using the configured TALLY_SECRET's matching pubkey
const pub = process.env.VITE_TALLY_PUBKEY;
const enc = [0, 0, 1].map((c) => JSON.stringify(encryptOneHot(pub, c, 3)));
const { counts } = tallyBallots(enc);
console.log("tallyBallots counts [yes,no,abstain]:", counts, counts.join() === "2,1,0" ? "✓" : "✗");
console.log("explorer:", `https://explorer.solana.com/tx/${sig2}?cluster=devnet`);
