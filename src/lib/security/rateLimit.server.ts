// DB-backed fixed-window rate limiter (works across stateless serverless invocations).
// Throws RATE_LIMITED when a bucket exceeds `limit` requests within `windowSec`.
import { queryOne } from "../db/pool.server";

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000).toISOString();
  // Atomic upsert + increment; RETURNING gives the new count.
  const row = await queryOne<{ count: number }>(
    `insert into rate_limits (bucket, window_start, count) values ($1,$2,1)
     on conflict (bucket, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [key, windowStart],
  );
  if ((row?.count ?? 0) > limit) throw new Error("RATE_LIMITED");
}
