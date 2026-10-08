// Deploy (upgrade) quorum_anchor on devnet from the build of record, then run the read-only
// post-deploy check. Refuses any .so whose hash isn't onchain/BUILD_HASH, so only the
// solana-verify build (CI artifact "quorum_anchor-verifiable") can go live.
//
// Usage: node scripts/onchain/deploy.mjs [path/to/quorum_anchor.so]
//   solana CLI: on PATH, or set SOLANA_BIN. Keys: .devnet/qrm-authority.json (upgrade authority
//   + payer) and .devnet/quorum_anchor-keypair.json (program id).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const solana = process.env.SOLANA_BIN ?? "solana";
const so = resolve(process.argv[2] ?? join(root, "onchain", "target", "deploy", "quorum_anchor.so"));
const programKp = join(root, ".devnet", "quorum_anchor-keypair.json");
const payer = join(root, ".devnet", "qrm-authority.json");
// same as solana-verify get-executable-hash: sha256 with trailing zero bytes trimmed
const programHash = (b) => { let e = b.length; while (e > 0 && b[e - 1] === 0) e--; return createHash("sha256").update(b.subarray(0, e)).digest("hex"); };
const run = (args, opts = {}) => execFileSync(solana, args, { encoding: "utf8", ...opts });

if (!existsSync(so)) { console.error("missing", so); process.exit(1); }
const bytes = readFileSync(so);
const hash = programHash(bytes);
const want = readFileSync(join(root, "onchain", "BUILD_HASH"), "utf8").trim();
console.log("artifact:", so, "\nhash:    ", hash);
if (hash !== want) {
  console.error(`refusing: hash != onchain/BUILD_HASH (${want}). Deploy the CI verifiable build, or update BUILD_HASH on purpose.`);
  process.exit(1);
}

const authority = run(["address", "-k", payer]).trim();
const sol = parseFloat(run(["balance", authority, "--url", "devnet"]));
const need = (bytes.length * 2 * 6960) / 1e9 + 0.05; // buffer rent (refunded) + possible extend + fees
console.log(`authority: ${authority} | balance: ${sol} SOL | need ~${need.toFixed(2)}`);
if (sol < need) { console.error(`Fund ${authority} via https://faucet.solana.com (Devnet) and re-run.`); process.exit(1); }

console.log("deploying…");
run(["program", "deploy", so, "--program-id", programKp, "--keypair", payer, "--url", "devnet"], { stdio: "inherit" });
execFileSync(process.execPath, [join(root, "scripts", "onchain", "post-deploy-check.mjs")], { stdio: "inherit" });
