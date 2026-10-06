// Minimal dependency-free HS256 JWT (sign + verify) for wallet session tokens.
// Server-only. Uses APP_JWT_SECRET. Not a Supabase JWT — our data plane is the pg pool,
// so this token only proves "this browser holds a verified wallet session".
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.server";

type Payload = { wallet: string; iat: number; exp: number };

const b64url = (buf: Buffer | string) =>
  (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString("base64url");

function sign(data: string): string {
  return createHmac("sha256", env("APP_JWT_SECRET")).update(data).digest("base64url");
}

export function signSession(wallet: string, ttlSeconds = 60 * 60 * 24 * 7): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ wallet, iat: now, exp: now + ttlSeconds } as Payload));
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string | undefined | null): Payload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Payload;
    if (typeof data.wallet !== "string") return null;
    if (data.exp * 1000 < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
