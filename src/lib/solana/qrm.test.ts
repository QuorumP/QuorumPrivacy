// confirmStakeTransfer is the only thing standing between a submitted signature and a ledger
// credit: it must credit exactly the vault's QRM delta from a tx the caller signed, and 0 otherwise.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const rpc = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock("@solana/web3.js", async (orig) => ({
  ...(await orig<typeof import("@solana/web3.js")>()),
  Connection: class { getParsedTransaction = async () => rpc.tx; },
}));

const authority = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();
const user = Keypair.generate().publicKey.toBase58();
let vault: string;
let confirmStakeTransfer: (sig: string, wallet: string) => Promise<number>;

beforeAll(async () => {
  process.env.ANCHOR_AUTHORITY_SECRET = JSON.stringify([...authority.secretKey]);
  process.env.QRM_MINT = mint;
  vault = (await PublicKey.createWithSeed(authority.publicKey, "qrm-stake-vault", TOKEN_2022_PROGRAM_ID)).toBase58();
  ({ confirmStakeTransfer } = await vi.importActual<typeof import("./qrm.server")>("./qrm.server"));
});

const key = (k: string, signer = false) => ({ pubkey: new PublicKey(k), signer });
const bal = (accountIndex: number, ui: number, m = mint) => ({ accountIndex, mint: m, uiTokenAmount: { uiAmount: ui } });
function tx(o: { signer?: string; keys?: string[]; pre?: number; post?: number; mint?: string; err?: unknown } = {}) {
  const keys = o.keys ?? [user, vault];
  const signer = o.signer ?? user;
  return {
    transaction: { message: { accountKeys: keys.map((k) => key(k, k === signer)) } },
    meta: { err: o.err ?? null, preTokenBalances: [bal(1, o.pre ?? 1000, o.mint)], postTokenBalances: [bal(1, o.post ?? 1250, o.mint)] },
  };
}

describe("confirmStakeTransfer", () => {
  it("credits the vault's actual balance delta", async () => {
    rpc.tx = tx();
    expect(await confirmStakeTransfer("sig", user)).toBe(250);
  });

  it.each([
    ["missing tx", () => null],
    ["failed tx", () => tx({ err: { InstructionError: [0, "Custom"] } })],
    ["signed by someone else", () => tx({ signer: Keypair.generate().publicKey.toBase58() })],
    ["vault not touched", () => tx({ keys: [user, Keypair.generate().publicKey.toBase58()] })],
    ["another token's balance", () => tx({ mint: Keypair.generate().publicKey.toBase58() })],
    ["vault balance went down", () => tx({ pre: 1250, post: 1000 })],
  ])("credits 0 for: %s", async (_name, t) => {
    rpc.tx = t();
    expect(await confirmStakeTransfer("sig", user)).toBe(0);
  });
});
