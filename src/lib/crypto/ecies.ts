// ECIES over Ristretto255 for auditor selective disclosure: encrypt a record so that ONLY
// the holder of a specific auditor secret key can decrypt it. Ephemeral ECDH → SHA-256 KDF →
// AES-GCM. Isomorphic (browser + server).
import { RistrettoPoint, ed25519 } from "@noble/curves/ed25519";

const ORDER = ed25519.CURVE.n;
const G = RistrettoPoint.BASE;

function randScalar(): bigint {
  const b = new Uint8Array(64);
  crypto.getRandomValues(b);
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return (x % (ORDER - 1n)) + 1n;
}

const hexToBytes = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
const bytesToHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function auditorKeypair(): { secret: string; pubkey: string } {
  const s = randScalar();
  return { secret: s.toString(), pubkey: G.multiply(s).toHex() };
}

async function aesKeyFromPoint(pt: { toHex: () => string }): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", hexToBytes(pt.toHex()) as BufferSource);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Encrypt to an auditor pubkey. Output: ephemeralPubHex.ivB64.ctB64
export async function eciesEncrypt(pubHex: string, plaintext: string): Promise<string> {
  const P = RistrettoPoint.fromHex(pubHex);
  const e = randScalar();
  const E = G.multiply(e);
  const shared = P.multiply(e); // e·P
  const key = await aesKeyFromPoint(shared);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  return `${E.toHex()}.${b64(iv)}.${b64(ct)}`;
}

// Decrypt with the auditor secret. Throws if the package is malformed or not for this key.
export async function eciesDecrypt(secret: string, pkg: string): Promise<string> {
  const [ehex, ivb, ctb] = pkg.split(".");
  const E = RistrettoPoint.fromHex(ehex);
  const shared = E.multiply(BigInt(secret) % ORDER); // s·E = e·P
  const key = await aesKeyFromPoint(shared);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivb) }, key, unb64(ctb));
  return new TextDecoder().decode(pt);
}

export { bytesToHex };
