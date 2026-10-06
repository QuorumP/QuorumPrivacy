// Exercises the Sign-In-With-Solana crypto exactly as src/fn/auth.ts does: build the canonical
// message, sign it with the real test wallet (Ed25519), and verify with tweetnacl + PublicKey.
// Also runs negatives: wrong wallet, tampered message.
import nacl from "tweetnacl";
import { Keypair, PublicKey } from "@solana/web3.js";

const kp = Keypair.generate(); // any keypair: SIWS proves ownership, it needs no funds
const wallet = kp.publicKey.toBase58();

function buildSignMessage(wallet, nonce) {
  return [
    "QUORUM — Confidential Governance", "",
    "Sign in to prove wallet ownership.",
    "This is free, does not approve any transaction, and reveals nothing.", "",
    `Wallet: ${wallet}`, `Nonce: ${nonce}`,
  ].join("\n");
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

const nonce = Buffer.from(nacl.randomBytes(24)).toString("base64url");
const msg = new TextEncoder().encode(buildSignMessage(wallet, nonce));

// client signs (nacl secretKey = 64-byte expanded key, same as Keypair.secretKey)
const sig = nacl.sign.detached(msg, kp.secretKey);
const sigB64 = Buffer.from(sig).toString("base64"); // client sends base64; server decodes base64

console.log("wallet:", wallet);
// server side re-derivation (never trusts client text)
const serverMsg = new TextEncoder().encode(buildSignMessage(wallet, nonce));
const serverSig = Uint8Array.from(Buffer.from(sigB64, "base64"));
const pubkeyBytes = new PublicKey(wallet).toBytes();

ok(nacl.sign.detached.verify(serverMsg, serverSig, pubkeyBytes), "valid signature verifies (server re-derives message)");

// negative: different wallet's pubkey cannot verify
const other = Keypair.generate();
ok(!nacl.sign.detached.verify(serverMsg, serverSig, other.publicKey.toBytes()), "signature rejected under a DIFFERENT wallet pubkey");

// negative: tampered nonce → server rebuilds a different message → verify fails
const tampered = new TextEncoder().encode(buildSignMessage(wallet, nonce + "x"));
ok(!nacl.sign.detached.verify(tampered, serverSig, pubkeyBytes), "signature rejected when message/nonce is tampered");

console.log(`\n[auth] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
