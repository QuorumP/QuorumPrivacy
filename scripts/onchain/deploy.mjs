// Deploy quorum_anchor to devnet (once the authority is funded). Verifies the result.
// Run with: node scripts/onchain/deploy.mjs
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const root = process.cwd();
const bin = join(homedir(), "solana", "solana-release", "bin");
const solana = join(bin, "solana.exe");
const so = join(root, "onchain", "target", "deploy", "quorum_anchor.so");
const programKp = join(root, ".devnet", "quorum_anchor-keypair.json");
const payer = join(root, ".devnet", "qrm-authority.json");

if (!existsSync(so)) { console.error("missing", so, "- run the build first"); process.exit(1); }

const authority = execSync(`"${solana}" address -k "${payer}"`).toString().trim();
const balance = execSync(`"${solana}" balance ${authority} --url devnet`).toString().trim();
console.log("authority:", authority, "| balance:", balance);
if (parseFloat(balance) < 2.4) {
  console.error(`Need ~2.4 SOL to deploy; have ${balance}. Fund ${authority} via https://faucet.solana.com (Devnet) and re-run.`);
  process.exit(1);
}

console.log("deploying…");
execSync(
  `"${solana}" program deploy "${so}" --program-id "${programKp}" --keypair "${payer}" --url devnet`,
  { stdio: "inherit" },
);
console.log("\n=== program ===");
execSync(`"${solana}" program show BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w --url devnet`, { stdio: "inherit" });
console.log("explorer: https://explorer.solana.com/address/BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w?cluster=devnet");
