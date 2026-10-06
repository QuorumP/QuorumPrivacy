// Server-side Supabase client (service-role). Used for Storage (encrypted proposal
// payloads / proof artifacts) and any admin operations. The primary data plane uses the
// pg pool in src/lib/db/pool.server.ts; this client is for Supabase-specific features.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (set these from the Supabase
// dashboard → Settings → API). Throws lazily on first use if they are missing.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.server";

let client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  client = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
