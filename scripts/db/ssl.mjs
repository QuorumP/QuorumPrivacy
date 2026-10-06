// Verified TLS for scripts that talk to Supabase Postgres. The pooler's certificate chains to
// Supabase's own root CA (not in Node's default trust store), so pin it instead of disabling
// verification. Same CA file the server bundles in src/lib/db/pool.server.ts.
import { readFileSync } from "node:fs";

export const ssl = { ca: readFileSync(new URL("../../supabase/prod-ca-2021.crt", import.meta.url), "utf8") };
