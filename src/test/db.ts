// In-process Postgres (PGlite) with the real migrations applied, standing in for the Supabase
// pool in tests. Exposes the same query/queryOne/withTransaction API as pool.server.ts.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

// Supabase ships these roles and the realtime publication; plain Postgres doesn't.
const SUPABASE_SHIM = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  end $$;
  create publication supabase_realtime;
`;

export async function createTestDb() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_SHIM);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  }
  return db;
}
