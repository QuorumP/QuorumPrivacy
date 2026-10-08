// Create the DAO treasury account that solvency proofs are made over, and fund it once.
// A Token-2022 account owned by the authority at createWithSeed(authority, "qrm-treasury"),
// separate from the supply ATA (faucet) and the stake vault. Idempotent: skips creation if the
// account exists and only funds it while it is empty.
//
// Usage: node scripts/token/create-treasury.mjs [fundQrm=250000]
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, getMint, getAccountLenForMint, createInitializeAccount3Instruction,
  getAssociatedTokenAddressSync, createTransferCheckedInstruction,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TREASURY_SEED = "qrm-treasury"; // must match src/lib/solana/qrm.server.ts
const DECIMALS = 9;
const FUND = BigInt(process.argv[2] ?? 250_000);

const root = process.cwd();
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const auth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(root, ".devnet", "qrm-authority.json"), "utf8"))));
const mint = new PublicKey(process.env.QRM_MINT);
const treasury = await PublicKey.createWithSeed(auth.publicKey, TREASURY_SEED, TOKEN_2022_PROGRAM_ID);
const supplyAta = getAssociatedTokenAddressSync(mint, auth.publicKey, false, TOKEN_2022_PROGRAM_ID);
console.log("authority:", auth.publicKey.toBase58());
console.log("treasury: ", treasury.toBase58());

if (!(await conn.getAccountInfo(treasury))) {
  const space = getAccountLenForMint(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID));
  const tx = new Transaction().add(
    SystemProgram.createAccountWithSeed({
      fromPubkey: auth.publicKey, basePubkey: auth.publicKey, seed: TREASURY_SEED, newAccountPubkey: treasury,
      lamports: await conn.getMinimumBalanceForRentExemption(space), space, programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(treasury, mint, auth.publicKey, TOKEN_2022_PROGRAM_ID),
  );
  console.log("created treasury:", await sendAndConfirmTransaction(conn, tx, [auth]));
} else console.log("treasury exists");

const bal = BigInt((await conn.getTokenAccountBalance(treasury)).value.amount);
if (bal === 0n && FUND > 0n) {
  const tx = new Transaction().add(createTransferCheckedInstruction(
    supplyAta, mint, treasury, auth.publicKey, FUND * 10n ** BigInt(DECIMALS), DECIMALS, [], TOKEN_2022_PROGRAM_ID,
  ));
  console.log(`moved ${FUND} QRM supply -> treasury:`, await sendAndConfirmTransaction(conn, tx, [auth]));
}
console.log("treasury balance:", (await conn.getTokenAccountBalance(treasury)).value.uiAmountString, "QRM");
