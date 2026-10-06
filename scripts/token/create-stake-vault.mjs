// Create the dedicated QRM stake vault and fund it with everything currently staked.
// The vault is a Token-2022 account owned by the authority at createWithSeed(authority,
// "qrm-stake-vault") — separate from the authority ATA that holds the supply and feeds the
// faucet. Idempotent: skips creation if the account exists and only tops up the shortfall
// between the DB stake ledger and the vault balance. Run BEFORE deploying code that reads it.
//
// Usage: node scripts/token/create-stake-vault.mjs
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, getMint, getAccountLenForMint, createInitializeAccount3Instruction,
  getAssociatedTokenAddressSync, createTransferCheckedInstruction,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ssl } from "../db/ssl.mjs";

const VAULT_SEED = "qrm-stake-vault"; // must match src/lib/solana/qrm.server.ts
const DECIMALS = 9;

const root = process.cwd();
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const conn = new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
const auth = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(root, ".devnet", "qrm-authority.json"), "utf8"))));
const mint = new PublicKey(process.env.QRM_MINT);
const vault = await PublicKey.createWithSeed(auth.publicKey, VAULT_SEED, TOKEN_2022_PROGRAM_ID);
const supplyAta = getAssociatedTokenAddressSync(mint, auth.publicKey, false, TOKEN_2022_PROGRAM_ID);
console.log("authority:", auth.publicKey.toBase58());
console.log("vault:    ", vault.toBase58());

// 1. create + initialize the vault account (owner = authority)
if (!(await conn.getAccountInfo(vault))) {
  const space = getAccountLenForMint(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID));
  const tx = new Transaction().add(
    SystemProgram.createAccountWithSeed({
      fromPubkey: auth.publicKey, basePubkey: auth.publicKey, seed: VAULT_SEED, newAccountPubkey: vault,
      lamports: await conn.getMinimumBalanceForRentExemption(space), space, programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(vault, mint, auth.publicKey, TOKEN_2022_PROGRAM_ID),
  );
  console.log("created vault:", await sendAndConfirmTransaction(conn, tx, [auth]));
} else console.log("vault exists");

// 2. top up the vault to the DB stake ledger total (stakes credited so far sit in the supply ATA)
const db = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE ?? "postgres", ssl,
});
await db.connect();
const { rows } = await db.query(`select coalesce(sum(amount),0)::numeric total from stakes where status='active'`);
await db.end();
const ledger = Number(rows[0].total);
const vaultBal = (await conn.getTokenAccountBalance(vault)).value.uiAmount ?? 0;
const shortfall = ledger - vaultBal;
console.log(`ledger ${ledger} QRM · vault ${vaultBal} QRM · shortfall ${shortfall > 0 ? shortfall : 0}`);
if (shortfall > 0) {
  // Token-2022 withholds a transfer fee (10 bps) in the destination, so send a little extra.
  const ui = Math.ceil(shortfall * 1.002) + 1;
  const tx = new Transaction().add(createTransferCheckedInstruction(
    supplyAta, mint, vault, auth.publicKey, BigInt(ui) * 10n ** BigInt(DECIMALS), DECIMALS, [], TOKEN_2022_PROGRAM_ID,
  ));
  console.log(`moved ${ui} QRM supply -> vault:`, await sendAndConfirmTransaction(conn, tx, [auth]));
  console.log("vault now:", (await conn.getTokenAccountBalance(vault)).value.uiAmount, "QRM");
}
