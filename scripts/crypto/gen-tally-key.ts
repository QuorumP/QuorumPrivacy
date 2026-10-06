// Generate (once) the tally keypair. Secret scalar persisted to .devnet/tally-secret.json
// (gitignored); prints the public key to register as TALLY_PUBKEY / VITE_TALLY_PUBKEY.
// Run with: bun scripts/crypto/gen-tally-key.ts
import { publicKeyFromSecret } from "../../src/lib/crypto/elgamal";
import { ed25519 } from "@noble/curves/ed25519";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ORDER = ed25519.CURVE.n;
const dir = join(process.cwd(), ".devnet");
mkdirSync(dir, { recursive: true });
const path = join(dir, "tally-secret.json");

let secret: bigint;
if (existsSync(path)) {
  secret = BigInt(JSON.parse(readFileSync(path, "utf8")).secret);
  console.error("(reusing existing tally secret)");
} else {
  const b = new Uint8Array(64); crypto.getRandomValues(b);
  let x = 0n; for (const v of b) x = (x << 8n) | BigInt(v);
  secret = (x % (ORDER - 1n)) + 1n;
  writeFileSync(path, JSON.stringify({ secret: secret.toString() }));
  console.error("(generated new tally secret -> .devnet/tally-secret.json)");
}
console.log(publicKeyFromSecret(secret));
