// Vitest setup: hermetic stand-ins for every I/O boundary of the server functions, so the real
// handlers (validation, authz, SQL, ledger logic) run end to end without network or secrets.
import { vi } from "vitest";
import { randomBytes } from "node:crypto";
import { pedersenDkg } from "../lib/crypto/threshold";
import { ADMIN } from "./harness";

// Never read .env.local (real DB creds and keys) in tests: env comes from here only.
vi.mock("../lib/env.server", () => ({
  env: (k: string, fallback?: string) => {
    const v = process.env[k] ?? fallback;
    if (v === undefined) throw new Error(`Missing required env var: ${k}`);
    return v;
  },
  optionalEnv: (k: string) => process.env[k],
}));

const dkg = pedersenDkg(5, 3);
Object.assign(process.env, {
  APP_JWT_SECRET: randomBytes(32).toString("hex"), // per run: nothing secret-shaped in the repo
  ADMIN_WALLETS: ADMIN,
  TALLY_PUBKEY: dkg.pubkey,
  TALLY_SHARES: JSON.stringify({ t: dkg.t, n: dkg.n, shares: dkg.shares }),
  SOLANA_RPC: "https://api.devnet.solana.com",
});
delete process.env.TALLY_SECRET;

// createServerFn(...).validator(v).handler(h) → a plain async fn({ data }) running v then h.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: ((d: unknown) => unknown) | undefined;
    const builder = {
      validator(v: (d: unknown) => unknown) { validate = v; return builder; },
      handler(h: (o: { data: unknown }) => unknown) {
        return async (o?: { data?: unknown }) => h({ data: validate ? validate(o?.data) : undefined });
      },
    };
    return builder;
  },
}));

vi.mock("@tanstack/react-start/server", async () => {
  const { session } = await import("./harness");
  return {
    getCookie: () => session.cookie,
    setCookie: (_name: string, value: string) => { session.cookie = value || undefined; },
    getRequestHost: () => "quorum.test",
  };
});

vi.mock("../lib/db/pool.server", async () => {
  const { db } = await import("./harness");
  const query = async (text: string, params?: unknown[]) => (await (await db()).query(text, params)).rows;
  return {
    query,
    queryOne: async (text: string, params?: unknown[]) => (await query(text, params))[0] ?? null,
    // PGlite runs one transaction at a time and queues other statements behind it: a conservative
    // model of row locks that still lets un-transacted check-then-act code race.
    withTransaction: async <T>(fn: (q: (t: string, p?: unknown[]) => Promise<unknown[]>) => Promise<T>) =>
      (await db()).transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)),
  };
});

vi.mock("../lib/solana/qrm.server", async () => (await import("./harness")).fakeQrm);
vi.mock("../lib/solana/anchor.server", () => ({
  anchorConfigured: () => false,
  registerVoteOnChain: async () => { throw new Error("offline"); },
  anchorTallyOnChain: async () => { throw new Error("offline"); },
}));
vi.mock("../lib/solana/groth16.server", () => ({
  groth16OnChainConfigured: () => false,
  verifySolvencyOnChain: async () => { throw new Error("offline"); },
}));
