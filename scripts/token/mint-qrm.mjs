// Mint the QRM governance token as a Token-2022 mint on Solana devnet, with a transfer-fee
// extension (10 bps) and on-chain metadata. Idempotent: reuses a persisted authority keypair
// and skips creation if the mint already exists. Records nothing secret to the repo.
//
// Usage: node scripts/token/mint-qrm.mjs
import {
  Connection, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction, createInitializeTransferFeeConfigInstruction,
  getOrCreateAssociatedTokenAccount, mintTo, getMint,
} from "@solana/spl-token";
import { createInitializeInstruction, pack } from "@solana/spl-token-metadata";
const TYPE_SIZE = 2, LENGTH_SIZE = 2; // TLV header sizes for the metadata extension
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

// ── persisted keypairs (gitignored) ───────────────────────────────────
const dir = join(root, ".devnet");
mkdirSync(dir, { recursive: true });
function loadOrCreate(name) {
  const path = join(dir, name);
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify([...kp.secretKey]));
  return kp;
}
const authority = loadOrCreate("qrm-authority.json");
const mintKp = loadOrCreate("qrm-mint.json");
console.log("authority:", authority.publicKey.toBase58());
console.log("mint     :", mintKp.publicKey.toBase58());

// ── already minted? ───────────────────────────────────────────────────
try {
  const existing = await getMint(connection, mintKp.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  console.log(`QRM mint already exists. supply=${existing.supply} decimals=${existing.decimals}`);
  console.log("QRM_MINT=" + mintKp.publicKey.toBase58());
  process.exit(0);
} catch { /* not created yet */ }

// ── fund authority (devnet airdrop) ───────────────────────────────────
let bal = await connection.getBalance(authority.publicKey);
if (bal < 0.3 * LAMPORTS_PER_SOL) {
  console.log("requesting devnet airdrop (1 SOL)…");
  for (let i = 0; i < 3 && bal < 0.3 * LAMPORTS_PER_SOL; i++) {
    try {
      const sig = await connection.requestAirdrop(authority.publicKey, 1 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    } catch (e) { console.log("  airdrop attempt failed:", e.message); }
    bal = await connection.getBalance(authority.publicKey);
  }
}
console.log("authority balance:", (bal / LAMPORTS_PER_SOL).toFixed(4), "SOL");
if (bal < 0.05 * LAMPORTS_PER_SOL) {
  console.error("Insufficient devnet SOL and airdrop is rate-limited. Fund the authority above via https://faucet.solana.com and re-run.");
  process.exit(1);
}

// ── build the mint with MetadataPointer + TransferFee + embedded metadata ──
const decimals = 9;
const metadata = {
  mint: mintKp.publicKey,
  name: "Quorum",
  symbol: "QRM",
  uri: "https://quorumprivacy.com/qrm.json",
  additionalMetadata: [["protocol", "QUORUM confidential governance"]],
};
const extensions = [ExtensionType.MetadataPointer, ExtensionType.TransferFeeConfig];
const mintLen = getMintLen(extensions);
const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

const tx = new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: authority.publicKey, newAccountPubkey: mintKp.publicKey,
    space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID,
  }),
  createInitializeTransferFeeConfigInstruction(
    mintKp.publicKey, authority.publicKey, authority.publicKey, 10, BigInt(5_000_000), TOKEN_2022_PROGRAM_ID,
  ), // 10 bps fee, max 0.005 QRM
  createInitializeMetadataPointerInstruction(
    mintKp.publicKey, authority.publicKey, mintKp.publicKey, TOKEN_2022_PROGRAM_ID,
  ),
  createInitializeMintInstruction(
    mintKp.publicKey, decimals, authority.publicKey, authority.publicKey, TOKEN_2022_PROGRAM_ID,
  ),
  createInitializeInstruction({
    programId: TOKEN_2022_PROGRAM_ID, mint: mintKp.publicKey, metadata: mintKp.publicKey,
    name: metadata.name, symbol: metadata.symbol, uri: metadata.uri,
    mintAuthority: authority.publicKey, updateAuthority: authority.publicKey,
  }),
);
const createSig = await sendAndConfirmTransaction(connection, tx, [authority, mintKp]);
console.log("mint created:", createSig);

// ── mint initial supply (1,000,000 QRM) to the authority ──────────────
const ata = await getOrCreateAssociatedTokenAccount(
  connection, authority, mintKp.publicKey, authority.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID,
);
const supply = BigInt(1_000_000) * BigInt(10) ** BigInt(decimals);
const mintSig = await mintTo(
  connection, authority, mintKp.publicKey, ata.address, authority, supply, [], undefined, TOKEN_2022_PROGRAM_ID,
);
console.log("minted 1,000,000 QRM:", mintSig);
console.log("\n=== DONE ===");
console.log("QRM_MINT=" + mintKp.publicKey.toBase58());
console.log("explorer: https://explorer.solana.com/address/" + mintKp.publicKey.toBase58() + "?cluster=devnet");
