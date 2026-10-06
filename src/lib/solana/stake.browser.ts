// Browser-side helpers to build a Token-2022 QRM stake transfer and read the wallet's QRM
// balance. Kept in its own module so @solana/spl-token is code-split out of the main bundle
// (only loaded when the user actually stakes).
import { ensureBuffer } from "./buffer-polyfill"; // called in each fn below (used export ⇒ not tree-shaken)
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction } from "@solana/spl-token";

export type StakeCtx = {
  mint: string;
  vault: string;
  tokenProgram: string;
  decimals: number;
  rpc: string;
};

/** Build an unsigned transfer of `amountUi` QRM from the owner's ATA to the vault. */
export async function buildStakeTx(ctx: StakeCtx, ownerAddr: string, amountUi: number): Promise<Transaction> {
  ensureBuffer();
  const owner = new PublicKey(ownerAddr);
  const mint = new PublicKey(ctx.mint);
  const vault = new PublicKey(ctx.vault);
  const tokenProgram = new PublicKey(ctx.tokenProgram);
  const ownerAta = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const base = BigInt(Math.round(amountUi * 10 ** ctx.decimals));
  const ix = createTransferCheckedInstruction(
    ownerAta, mint, vault, owner, base, ctx.decimals, [], tokenProgram,
  );
  const conn = new Connection(ctx.rpc, "confirmed");
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  tx.feePayer = owner;
  tx.recentBlockhash = blockhash;
  tx.add(ix);
  return tx;
}

/** The wallet's current QRM balance (UI units); 0 if it has no QRM account yet. */
export async function walletQrmBalance(ctx: StakeCtx, ownerAddr: string): Promise<number> {
  ensureBuffer();
  const conn = new Connection(ctx.rpc, "confirmed");
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(ctx.mint), new PublicKey(ownerAddr), false, new PublicKey(ctx.tokenProgram),
  );
  try {
    const bal = await conn.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0; // no ATA yet
  }
}
