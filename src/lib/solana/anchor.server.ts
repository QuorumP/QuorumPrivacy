// Server-side calls to the deployed quorum_anchor devnet program. Server-only (holds the
// authority keypair). All calls are best-effort: callers treat failures as non-fatal so the
// DB stays the source of truth even if devnet/RPC hiccups.
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import idl from "./idl.json";

export function anchorConfigured(): boolean {
  return !!process.env.ANCHOR_AUTHORITY_SECRET;
}

// Minimal wallet for AnchorProvider (anchor's own `Wallet` isn't exported from its ESM index).
class KeypairWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() { return this.payer.publicKey; }
  async signTransaction<T>(tx: T): Promise<T> {
    const anyTx = tx as { partialSign?: (k: Keypair) => void; sign?: (k: Keypair[]) => void };
    if (anyTx.partialSign) anyTx.partialSign(this.payer); else anyTx.sign?.([this.payer]);
    return tx;
  }
  async signAllTransactions<T>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((t) => this.signTransaction(t)));
  }
}

function getProgram() {
  const secret = process.env.ANCHOR_AUTHORITY_SECRET;
  if (!secret) throw new Error("ANCHOR_NOT_CONFIGURED");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(connection, new KeypairWallet(authority), { commitment: "confirmed" });
  const program = new Program(idl, provider);
  return { program, authority, programId: new PublicKey((idl as { address: string }).address) };
}

// 32-byte big-endian encoding of a decimal/hex field element or arbitrary big int string.
export function to32(value: string): number[] {
  const n = value.startsWith("0x") ? BigInt(value) : BigInt(value);
  const out = new Array(32).fill(0);
  let x = n;
  for (let i = 31; i >= 0 && x > 0n; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

function votePda(programId: PublicKey, voteId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vote"), Buffer.from(voteId)], programId)[0];
}

export async function registerVoteOnChain(voteId: string, eligibilityRoot: string): Promise<string> {
  const { program, authority, programId } = getProgram();
  const vote = votePda(programId, voteId);
  return program.methods
    .registerVote(voteId, to32(eligibilityRoot))
    .accounts({ vote, authority: authority.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}

// Anchor the ballot-commitment root, then the final tally hash (both signed by the authority).
export async function anchorTallyOnChain(
  voteId: string,
  ballotRoot: string,
  resultHash: string,
): Promise<string> {
  const { program, authority, programId } = getProgram();
  const vote = votePda(programId, voteId);
  await program.methods.commitBallots(to32(ballotRoot))
    .accounts({ vote, authority: authority.publicKey }).rpc();
  return program.methods.submitTally(to32(resultHash))
    .accounts({ vote, authority: authority.publicKey }).rpc();
}
