// Read-only post-deploy check: exits 1 on any mismatch between devnet and what the repo says.
//  - program hash == onchain/BUILD_HASH (the solana-verify build of record; CI rebuilds it)
//  - upgrade authority, QRM mint / freeze / transfer-fee / metadata authorities == expected
//  - stake vault and treasury are QRM accounts owned by the authority
//  - no leftover deploy buffers held by the authority
// Hash = sha256 of the program bytes with trailing zero bytes trimmed (same as solana-verify
// get-program-hash; CI cross-checks the two). Usage: node scripts/onchain/post-deploy-check.mjs
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, getMint, getAccount, getTransferFeeConfig, getMetadataPointerState, getTokenMetadata,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("BHdjYZbXw6ay5qpGcrG3fGb4bmoAnZNKv3fKZ9Gxff6w");
const AUTHORITY = "9sjBajqChwe1BDCa9gxAG46qgJzMwgKPe1mi64T24ZYC"; // see public-readme/SECURITY.md
const MINT = new PublicKey("HjQdV3YTpdJmThMuxe9Tvx8zJV9fHxZo5T3cA8Fhgvsw");
const ACCOUNTS = { "stake vault": "qrm-stake-vault", treasury: "qrm-treasury" }; // seeds, see qrm.server.ts
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const WANT_HASH = readFileSync(new URL("../../onchain/BUILD_HASH", import.meta.url), "utf8").trim();

const conn = new Connection(RPC, "confirmed");
let failed = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

function programHash(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return createHash("sha256").update(bytes.subarray(0, end)).digest("hex");
}

// Program account → ProgramData (header: u32 tag, u64 slot, Option<Pubkey> authority = 45 bytes).
const prog = await conn.getAccountInfo(PROGRAM);
check(!!prog?.executable && prog.owner.equals(LOADER), "program is an executable upgradeable program");
const dataAddr = new PublicKey(prog.data.subarray(4, 36));
const pd = (await conn.getAccountInfo(dataAddr)).data;
const upgradeAuth = pd[12] === 1 ? new PublicKey(pd.subarray(13, 45)).toBase58() : "none";
check(upgradeAuth === AUTHORITY, "upgrade authority", upgradeAuth);
const live = programHash(pd.subarray(45));
check(live === WANT_HASH, "live program == build of record (onchain/BUILD_HASH)", live);

const mint = await getMint(conn, MINT, "confirmed", TOKEN_2022_PROGRAM_ID);
const fee = getTransferFeeConfig(mint);
const meta = await getTokenMetadata(conn, MINT);
for (const [what, key] of [
  ["QRM mint authority", mint.mintAuthority],
  ["QRM freeze authority", mint.freezeAuthority],
  ["QRM transfer-fee config authority", fee?.transferFeeConfigAuthority],
  ["QRM withheld-fee withdraw authority", fee?.withdrawWithheldAuthority],
  ["QRM metadata pointer authority", getMetadataPointerState(mint)?.authority],
  ["QRM metadata update authority", meta?.updateAuthority],
]) check(key?.toBase58() === AUTHORITY, what, key?.toBase58() ?? "none");

for (const [what, seed] of Object.entries(ACCOUNTS)) {
  const addr = await PublicKey.createWithSeed(new PublicKey(AUTHORITY), seed, TOKEN_2022_PROGRAM_ID);
  const acc = await getAccount(conn, addr, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null);
  check(!!acc && acc.mint.equals(MINT) && acc.owner.toBase58() === AUTHORITY, `${what} is a QRM account owned by the authority`, addr.toBase58());
}

// Buffer accounts: u32 tag 1, then Option<Pubkey> authority at offset 4 (tag) / 5 (key).
const buffers = await conn.getProgramAccounts(LOADER, {
  dataSlice: { offset: 0, length: 0 },
  filters: [{ memcmp: { offset: 0, bytes: "2UzHM" } }, { memcmp: { offset: 5, bytes: AUTHORITY } }], // "2UzHM" = [1,0,0,0]
});
check(buffers.length === 0, "no leftover deploy buffers", `${buffers.length} found`);

console.log(failed ? `post-deploy check FAILED: ${failed} problem(s)` : "post-deploy check PASSED");
process.exit(failed ? 1 : 0);
