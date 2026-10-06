// Server-only session helpers built on the HttpOnly cookie + HS256 JWT.
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { signSession, verifySession } from "./jwt.server";

export const SESSION_COOKIE = "quorum_session";

export function issueSession(wallet: string) {
  setCookie(SESSION_COOKIE, signSession(wallet), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession() {
  setCookie(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Returns the authenticated wallet or null. */
export function getWallet(): string | null {
  return verifySession(getCookie(SESSION_COOKIE))?.wallet ?? null;
}

/** Returns the authenticated wallet or throws (use in protected server functions). */
export function requireWallet(): string {
  const wallet = getWallet();
  if (!wallet) throw new Error("UNAUTHENTICATED");
  return wallet;
}

/** True when `wallet` is listed in the comma-separated ADMIN_WALLETS env var. */
export function isAdmin(wallet: string): boolean {
  return (process.env.ADMIN_WALLETS ?? "").split(",").map((s) => s.trim()).includes(wallet);
}

/** Returns the authenticated wallet if it is an admin, otherwise throws FORBIDDEN. */
export function requireAdmin(): string {
  const wallet = requireWallet();
  if (!isAdmin(wallet)) throw new Error("FORBIDDEN");
  return wallet;
}
