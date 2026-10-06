// Validates src/lib/crypto/tally.server.ts in THRESHOLD mode using the real .env.local
// group key + shares. Run with: bun scripts/crypto/tally-server-test.ts
import { readFileSync } from "node:fs";
const root = process.cwd();
for (const line of readFileSync(`${root}/.env.local`, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const { tallyBallots, tallyConfigured } = await import("../../src/lib/crypto/tally.server.ts");
const { encryptOneHot } = await import("../../src/lib/crypto/elgamal.ts");

const pub = process.env.VITE_TALLY_PUBKEY as string;
const choices = [0, 0, 1, 2, 0, 1, 0]; // expect yes=4, no=2, abstain=1
const enc = choices.map((c) => JSON.stringify(encryptOneHot(pub, c, 3)));

console.log("tallyConfigured:", tallyConfigured());
const res = tallyBallots(enc);
console.log("mode:", res.mode, "| counts [yes,no,abstain]:", res.counts, "| tallied:", res.tallied);
const ok = res.mode === "threshold" && JSON.stringify(res.counts) === JSON.stringify([4, 2, 1]);
console.log("threshold tally via server lib:", ok ? "YES ✓" : "NO ✗");
process.exit(ok ? 0 : 1);
