// Browser Supabase client — used only for Realtime subscriptions (e.g. live ballot_count)
// and public Storage reads. All privileged data access goes through TanStack Start server
// functions, not this client. Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.
//
// Lazily created so the app still runs before the anon key is configured; callers should
// guard on `isSupabaseConfigured()` before subscribing to Realtime.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return Boolean(url && key && !key.startsWith("__SET_ME__"));
}

export function getSupabaseBrowser(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (client) return client;
  client = createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false } },
  );
  return client;
}
