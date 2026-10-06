// Server-side QRM (Token-2022) operations on devnet. The mint authority keypair
// (ANCHOR_AUTHORITY_SECRET — same key that holds the 1,000,000 QRM supply) doubles as the
// faucet source and the stake vault owner, so no extra secret is needed. All amounts are UI
// units (whole QRM); QRM has 9 decimals.
//
// Design: the stake vault is a dedicated Token-2022 account owned by the authority, at an
// address derived from the authority + VAULT_SEED (no extra secret or env var). It is kept
// apart from the authority's ATA, which holds the supply and feeds the faucet, so a faucet
// drain can never reach staked funds. Staking is a
// real on-chain Token-2022 transfer FROM the user's wallet TO the vault (signed in the browser);
// the server confirms that transfer on devnet before crediting the DB stake ledger. Unstaking
// and the faucet are authority-signed transfers back out. The DB remains the accounting source
// of truth (per the plan), now backed by verifiable on-chain settlement.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
  getMint,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";

export const QRM_DECIMALS = 9;

export function qrmConfigured(): boolean {
  return !!process.env.ANCHOR_AUTHORITY_SECRET && !!process.env.QRM_MINT;
}

function rpc(): Connection {
  return new Connection(process.env.SOLANA_RPC ?? "https://api.devnet.solana.com", "confirmed");
}

function authority(): Keypair {
  const secret = process.env.ANCHOR_AUTHORITY_SECRET;
  if (!secret) throw new Error("QRM_NOT_CONFIGURED");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
}

function mint(): PublicKey {
  const m = process.env.QRM_MINT;
  if (!m) throw new Error("QRM_NOT_CONFIGURED");
  return new PublicKey(m);
}

export const VAULT_SEED = "qrm-stake-vault";

/** The stake vault account (created once by scripts/token/create-stake-vault.mjs). */
export function vaultAccount(): Promise<PublicKey> {
  return PublicKey.createWithSeed(authority().publicKey, VAULT_SEED, TOKEN_2022_PROGRAM_ID);
}

/** Public context the browser needs to build a Token-2022 transfer to the vault. */
export async function stakeContext() {
  return {
    mint: mint().toBase58(),
    vault: (await vaultAccount()).toBase58(),
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    decimals: QRM_DECIMALS,
    rpc: process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
  };
}

const toBase = (ui: number) => BigInt(Math.round(ui * 10 ** QRM_DECIMALS));

/** Authority sends `ui` QRM from the supply (faucet) to `toWallet` and waits. Returns the tx sig. */
export async function transferFromAuthority(toWallet: string, ui: number): Promise<string> {
  const sig = await sendFromAuthority(toWallet, ui);
  await confirmSig(sig);
  return sig;
}

/** Wait for confirmation. true = landed OK, false = landed but failed; throws on timeout. */
export async function confirmSig(sig: string): Promise<boolean> {
  const res = await rpc().confirmTransaction(sig, "confirmed");
  return !res.value.err;
}

/**
 * Authority-signed transfer of `ui` QRM to `toWallet`, returned as soon as it is broadcast (the
 * caller confirms). `from`: "supply" = the authority ATA (faucet), "vault" = the stake vault.
 */
export async function sendFromAuthority(toWallet: string, ui: number, from: "supply" | "vault" = "supply"): Promise<string> {
  const conn = rpc();
  const auth = authority();
  const m = mint();
  const dest = new PublicKey(toWallet);
  const srcAta = from === "vault"
    ? await vaultAccount()
    : getAssociatedTokenAddressSync(m, auth.publicKey, false, TOKEN_2022_PROGRAM_ID);
  // create/lookup the recipient ATA (authority pays rent)
  const destAcc = await getOrCreateAssociatedTokenAccount(
    conn, auth, m, dest, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID,
  );
  const ix = createTransferCheckedInstruction(
    srcAta, m, destAcc.address, auth.publicKey, toBase(ui), QRM_DECIMALS, [], TOKEN_2022_PROGRAM_ID,
  );
  const tx = new Transaction().add(ix);
  return conn.sendTransaction(tx, [auth]);
}

/**
 * Confirm that a browser-signed transaction really transferred QRM from `fromWallet` to the
 * vault. Returns the vault's actual balance delta in UI units (0 if the tx is invalid/unrelated).
 * Robust to Token-2022 transfer fees: we read pre/post token balances rather than trusting inputs.
 */
export async function confirmStakeTransfer(signature: string, fromWallet: string): Promise<number> {
  const conn = rpc();
  const tx = await conn.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0, commitment: "confirmed",
  });
  if (!tx || tx.meta?.err) return 0;

  const vault = (await vaultAccount()).toBase58();
  const mintStr = mint().toBase58();
  const keys = tx.transaction.message.accountKeys.map((k) =>
    (typeof k === "string" ? k : k.pubkey.toBase58()));

  // the wallet must have signed this tx (it moved its own tokens)
  const signed = tx.transaction.message.accountKeys.some(
    (k) => typeof k !== "string" && k.signer && k.pubkey.toBase58() === fromWallet,
  );
  if (!signed) return 0;

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const vaultIdx = keys.indexOf(vault);
  if (vaultIdx < 0) return 0;
  const preAmt = pre.find((b) => b.accountIndex === vaultIdx && b.mint === mintStr)?.uiTokenAmount.uiAmount ?? 0;
  const postAmt = post.find((b) => b.accountIndex === vaultIdx && b.mint === mintStr)?.uiTokenAmount.uiAmount ?? 0;
  const delta = (postAmt ?? 0) - (preAmt ?? 0);
  return delta > 0 ? delta : 0;
}

/** Mint address getter for callers that only need the string. */
export async function qrmMintInfo() {
  const info = await getMint(rpc(), mint(), "confirmed", TOKEN_2022_PROGRAM_ID);
  return { decimals: info.decimals, supply: info.supply.toString() };
}
