// Shared state for server-function tests: the PGlite database, the signed-in wallet, and a fake
// devnet that models the QRM stake vault. setup.ts wires the app's I/O modules to these.
import type { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";
import { signSession } from "../lib/auth/jwt.server";
import { createTestDb } from "./db";

let dbPromise: Promise<PGlite> | undefined;
export const db = () => (dbPromise ??= createTestDb());

export async function sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  return (await (await db()).query<T>(text, params)).rows;
}

// ── session ──
export const ADMIN = "AdminWa11et1111111111111111111111111111111111";
export const session = { cookie: undefined as string | undefined };
export const signIn = (wallet: string) => { session.cookie = signSession(wallet); };
export const signOut = () => { session.cookie = undefined; };

// Base58-shaped 44-char wallet strings (the server only checks length and equality).
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const newWallet = () => Array.from(randomBytes(44), (b) => B58[b % 58]).join("");

// ── fake devnet: token balances + the stake vault ──
// `confirm` picks how the next broadcast vault payout resolves:
//   ok      → lands, tokens move, confirmSig = true
//   failed  → lands with an error, nothing moves, confirmSig = false
//   timeout → lands later (tokens move) but confirmSig throws: the server can't tell yet
type Pending = { to: string; amount: number; from: "supply" | "vault" };
export const chain = {
  vault: 0,
  balances: new Map<string, number>(),
  pending: new Map<string, Pending>(),
  stakeTxs: new Map<string, { wallet: string; amount: number }>(), // browser-signed stakes
  confirm: "ok" as "ok" | "failed" | "timeout",
  sendThrows: false,
  reset() {
    this.vault = 0; this.balances.clear(); this.pending.clear(); this.stakeTxs.clear();
    this.confirm = "ok"; this.sendThrows = false;
  },
  bal(w: string) { return this.balances.get(w) ?? 0; },
  /** The user signs a vault transfer in their browser; returns the tx signature. */
  userStake(wallet: string, amount: number) {
    const sig = randomBytes(48).toString("hex");
    this.balances.set(wallet, this.bal(wallet) - amount);
    this.vault += amount;
    this.stakeTxs.set(sig, { wallet, amount });
    return sig;
  },
};

export const fakeQrm = {
  qrmConfigured: () => true,
  stakeContext: async () => ({ mint: "QRMmint", vault: "QRMvault", tokenProgram: "Token2022", decimals: 9, rpc: "devnet" }),
  async sendFromAuthority(to: string, amount: number, from: "supply" | "vault" = "supply") {
    if (chain.sendThrows) throw new Error("RPC_DOWN");
    const sig = randomBytes(48).toString("hex");
    chain.pending.set(sig, { to, amount, from });
    return sig;
  },
  async confirmSig(sig: string) {
    const p = chain.pending.get(sig);
    if (!p) throw new Error("unknown sig");
    chain.pending.delete(sig);
    if (chain.confirm === "failed") return false;
    if (p.from === "vault") {
      if (chain.vault < p.amount) return false; // the token program would reject the overdraw
      chain.vault -= p.amount;
    }
    chain.balances.set(p.to, chain.bal(p.to) + p.amount);
    if (chain.confirm === "timeout") throw new Error("TransactionExpiredTimeoutError");
    return true;
  },
  async transferFromAuthority(to: string, amount: number) {
    const sig = await fakeQrm.sendFromAuthority(to, amount);
    await fakeQrm.confirmSig(sig);
    return sig;
  },
  async confirmStakeTransfer(sig: string, wallet: string) {
    const t = chain.stakeTxs.get(sig);
    return t && t.wallet === wallet ? t.amount : 0;
  },
};

/** Sum of the DB stake ledger (active rows). */
export async function ledgerTotal(wallet?: string): Promise<number> {
  const [r] = await sql<{ t: string }>(
    `select coalesce(sum(amount),0)::text t from stakes where status='active' ${wallet ? "and wallet=$1" : ""}`,
    wallet ? [wallet] : [],
  );
  return Number(r.t);
}

/** Run an async fn and return its error message (or "ok"). */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) {
    return (e as Error).name === "ZodError" ? "INVALID_INPUT" : (e as Error).message;
  }
}
