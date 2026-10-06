// Server-only Postgres pool for QUORUM data access.
//
// v1 uses a direct pg pool against the Supabase Postgres (pooler endpoint) from
// TanStack Start server functions — a "thick API / dumb client": the browser never
// talks to Postgres directly, every read/write goes through an authenticated server
// function. This avoids needing the Supabase service-role API key for the data plane
// (the @supabase/supabase-js client wrappers are added separately for Realtime/Storage).
//
// NOTE for Vercel: prefer the Supabase *transaction* pooler (port 6543) in serverless.
// Discrete PG* vars are used to sidestep URL-encoding of special chars in the password.
import { Pool } from "pg";
import { env, optionalEnv } from "../env.server";
// Supabase's root CA (the pooler cert chains to it; it isn't in Node's default trust store).
import supabaseCa from "../../../supabase/prod-ca-2021.crt?raw";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;
  // Prefer the percent-encoded DATABASE_URL connection string: it has no literal '$',
  // so it survives dotenv-expand in the dev runtime (the discrete PGPASSWORD with a '$'
  // gets mangled by expansion). pg decodes the %-encoding back to the real password.
  const connectionString = optionalEnv("DATABASE_URL");
  // Serverless-safe pool sizing: each Vercel instance keeps at most ONE Postgres connection
  // and releases it quickly, so many concurrent instances stay under the pooler's client cap
  // (the session-mode Supabase pooler allows only 15 total → max:5 × 3 instances exhausted it).
  // Pair this with the transaction-mode pooler (port 6543) for real headroom.
  const shared = {
    ssl: { ca: supabaseCa }, // verified TLS, pinned to Supabase's root CA
    max: 1,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 10_000,
  };
  pool = connectionString
    ? new Pool({ connectionString, ...shared })
    : new Pool({
        host: env("PGHOST"),
        port: Number(optionalEnv("PGPORT") ?? 5432),
        user: env("PGUSER"),
        password: env("PGPASSWORD"),
        database: optionalEnv("PGDATABASE") ?? "postgres",
        ...shared,
      });
  return pool;
}

// The Supabase session-mode pooler caps concurrent clients (15) and a burst of parallel server
// functions can transiently exhaust it (EMAXCONNSESSION / "max clients reached"). Retry a few
// times with backoff so a transient spike doesn't crash the page. (Transaction-mode pooler on
// port 6543 removes the need for this — see getPool.)
function isConnLimit(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? "";
  return /EMAXCONNSESSION|max clients|too many clients|remaining connection slots/i.test(m);
}
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isConnLimit(e) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 150 * 2 ** i)); // 150 / 300 / 600 ms
    }
  }
  throw last;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await withRetry(() => getPool().query(text, params as never));
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Run fn inside a transaction on a dedicated client (BEGIN/COMMIT, ROLLBACK on throw). */
export async function withTransaction<T>(
  fn: (q: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>,
): Promise<T> {
  const client = await withRetry(() => getPool().connect());
  const q = async (text: string, params?: unknown[]) =>
    (await client.query(text, params as never)).rows;
  try {
    await client.query("begin");
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
