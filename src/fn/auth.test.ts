// Sign-In-With-Solana: real Ed25519 signatures over the server-built, domain-bound message.
import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { requestNonce, verifySignature, getMe, logout } from "./auth";
import { session, signOut, outcome, sql } from "../test/harness";

function keypair() {
  const kp = nacl.sign.keyPair();
  return { wallet: bs58.encode(kp.publicKey), sign: (m: string) => Buffer.from(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey)).toString("base64") };
}

describe("SIWS", () => {
  it("signs in once per nonce and issues a session", async () => {
    signOut();
    const u = keypair();
    const { nonce, message } = await requestNonce({ data: { wallet: u.wallet } });
    expect(message).toContain("quorum.test wants you to sign in");
    expect(message).toContain(`Nonce: ${nonce}`);
    const signature = u.sign(message);
    await expect(verifySignature({ data: { wallet: u.wallet, nonce, signature } })).resolves.toEqual({ wallet: u.wallet });
    await expect(getMe()).resolves.toEqual({ wallet: u.wallet });
    expect(await outcome(verifySignature({ data: { wallet: u.wallet, nonce, signature } }))).toBe("NONCE_ALREADY_USED");
    const [m] = await sql(`select 1 from members where wallet=$1`, [u.wallet]);
    expect(m).toBeTruthy();
    await logout();
    await expect(getMe()).resolves.toEqual({ wallet: null });
  });

  it("concurrent replays of one signature yield exactly one session", async () => {
    const u = keypair();
    const { nonce, message } = await requestNonce({ data: { wallet: u.wallet } });
    const signature = u.sign(message);
    const r = await Promise.all(Array.from({ length: 5 }, () => outcome(verifySignature({ data: { wallet: u.wallet, nonce, signature } }))));
    expect(r.filter((x) => x === "ok")).toHaveLength(1);
  });

  it("rejects signatures by another key, over another domain, or for another wallet's nonce", async () => {
    signOut();
    const u = keypair(), mallory = keypair();
    const { nonce, message } = await requestNonce({ data: { wallet: u.wallet } });
    expect(await outcome(verifySignature({ data: { wallet: u.wallet, nonce, signature: mallory.sign(message) } }))).toBe("BAD_SIGNATURE");
    const phished = message.replaceAll("quorum.test", "quorum-airdrop.example");
    expect(await outcome(verifySignature({ data: { wallet: u.wallet, nonce, signature: u.sign(phished) } }))).toBe("BAD_SIGNATURE");
    expect(await outcome(verifySignature({ data: { wallet: mallory.wallet, nonce, signature: mallory.sign(message) } }))).toBe("INVALID_NONCE");
    expect(session.cookie).toBeUndefined();
  });

  it("rejects expired nonces", async () => {
    const u = keypair();
    const { nonce, message } = await requestNonce({ data: { wallet: u.wallet } });
    await sql(`update auth_nonces set expires_at = now() - interval '1 second' where nonce=$1`, [nonce]);
    expect(await outcome(verifySignature({ data: { wallet: u.wallet, nonce, signature: u.sign(message) } }))).toBe("NONCE_EXPIRED");
  });

  it("rate-limits nonce requests per wallet and validates input", async () => {
    const u = keypair();
    for (let i = 0; i < 10; i++) await requestNonce({ data: { wallet: u.wallet } });
    expect(await outcome(requestNonce({ data: { wallet: u.wallet } }))).toBe("RATE_LIMITED");
    expect(await outcome(requestNonce({ data: { wallet: "short" } }))).toBe("INVALID_INPUT");
  });
});
