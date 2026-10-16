/**
 * Build-time configuration. Only public values are read here (see .env.example):
 * never a secret, never a database URL, never a Supabase service-role key.
 */

export interface AppEnv {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublicKey: string;
}

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; problems: string[] };

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function readEnv(source: Record<string, unknown> = import.meta.env): EnvResult {
  const get = (name: string): string => {
    const raw = source[name];
    return typeof raw === 'string' ? raw.trim() : '';
  };
  const apiBaseUrl = trimSlash(get('VITE_API_BASE_URL'));
  const supabaseUrl = trimSlash(get('VITE_SUPABASE_URL'));
  const supabasePublicKey = get('VITE_SUPABASE_PUBLIC_KEY');

  const problems: string[] = [];
  if (!apiBaseUrl) problems.push('VITE_API_BASE_URL is not set');
  if (!supabaseUrl) problems.push('VITE_SUPABASE_URL is not set');
  if (!supabasePublicKey) problems.push('VITE_SUPABASE_PUBLIC_KEY is not set');

  // Production must be HTTPS only (ARCHITECTURE.md section 10).
  if (source.PROD === true) {
    if (apiBaseUrl && !apiBaseUrl.startsWith('https://')) problems.push('VITE_API_BASE_URL must use https');
    if (supabaseUrl && !supabaseUrl.startsWith('https://')) problems.push('VITE_SUPABASE_URL must use https');
  }

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, env: { apiBaseUrl, supabaseUrl, supabasePublicKey } };
}
