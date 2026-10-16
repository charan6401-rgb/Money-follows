import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from './env';

/**
 * The Supabase browser client is used for authentication only (ARCHITECTURE.md section 1).
 * All business data goes through the Money Follows API. Created lazily so a missing
 * configuration shows a clear screen instead of crashing at import time.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const result = readEnv();
  if (!result.ok) throw new Error(`Missing configuration: ${result.problems.join('; ')}`);
  client = createClient(result.env.supabaseUrl, result.env.supabasePublicKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
