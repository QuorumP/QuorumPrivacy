// Sign-In-With-Solana server functions.
// Flow: requestNonce -> client signMessage -> verifySignature (Ed25519) -> HttpOnly session cookie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import { query, queryOne } from "../lib/db/pool.server";
import { issueSession, clearSession, getWallet } from "../lib/auth/session.server";
import { rateLimit } from "../lib/security/rateLimit.server";
import { getRequestHost } from "@tanstack/react-start/server";

const Wallet = z.string().min(32).max(48);
const NONCE_TTL_MS = 5 * 60_000;

/**
 * Canonical Sign-In-With-Solana message, rebuilt server-side at verify (never trust client text).
 * Binding the domain lets wallets warn when a phishing site relays our nonce for signing.
 */
export function buildSignMessage(wallet: string, nonce: string, domain: string, expiresAt: Date): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    wallet,
    "",
    "Sign in to QUORUM to prove wallet ownership. This is free, does not approve any transaction, and reveals nothing.",
    "",
    `URI: https://${domain}`,
    "Version: 1",
    "Chain ID: devnet",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(expiresAt.getTime() - NONCE_TTL_MS).toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

export const requestNonce = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ wallet: Wallet }).parse(d))
  .handler(async ({ data }) => {
    await rateLimit(`nonce:${data.wallet}`, 10, 60); // 10 nonce requests / wallet / min
    const nonce = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await query(`insert into auth_nonces (wallet, nonce, expires_at) values ($1,$2,$3)`, [
      data.wallet,
      nonce,
      expiresAt.toISOString(),
    ]);
    return { nonce, message: buildSignMessage(data.wallet, nonce, getRequestHost(), expiresAt) };
  });

export const verifySignature = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ wallet: Wallet, nonce: z.string().min(8), signature: z.string().min(16) }).parse(d),
  )
  .handler(async ({ data }) => {
    const row = await queryOne<{ id: string; consumed_at: string | null; expires_at: string }>(
      `select id, consumed_at, expires_at from auth_nonces where nonce=$1 and wallet=$2`,
      [data.nonce, data.wallet],
    );
    if (!row) throw new Error("INVALID_NONCE");
    if (row.consumed_at) throw new Error("NONCE_ALREADY_USED");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("NONCE_EXPIRED");

    const messageBytes = new TextEncoder().encode(
      buildSignMessage(data.wallet, data.nonce, getRequestHost(), new Date(row.expires_at)),
    );
    const sigBytes = Uint8Array.from(Buffer.from(data.signature, "base64"));
    const pubkeyBytes = new PublicKey(data.wallet).toBytes();
    if (!nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes)) {
      throw new Error("BAD_SIGNATURE");
    }

    // Atomic consume: only one concurrent request can flip consumed_at (closes replay race).
    const consumed = await queryOne<{ id: string }>(
      `update auth_nonces set consumed_at=now() where id=$1 and consumed_at is null returning id`,
      [row.id],
    );
    if (!consumed) throw new Error("NONCE_ALREADY_USED");
    await query(`insert into members (wallet) values ($1) on conflict (wallet) do nothing`, [
      data.wallet,
    ]);
    issueSession(data.wallet);
    return { wallet: data.wallet };
  });

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  return { wallet: getWallet() };
});

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  clearSession();
  return { ok: true };
});
