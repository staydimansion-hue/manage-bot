import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "./config";

let cached: SupabaseClient | null = null;

/**
 * Returns a service-role Supabase client, or null when credentials are missing
 * (so the app can build without live env). Callers must handle null.
 */
export function getSupabase(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (cached) return cached;
  cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Like getSupabase but throws if unavailable — use in request handlers. */
export function requireSupabase(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return client;
}
