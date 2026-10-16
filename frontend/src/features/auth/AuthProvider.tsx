import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { workspaceStore } from '@/lib/workspace-store';
import { AuthContext, type AuthValue } from './auth-context';

/**
 * Supabase is used for authentication only. All business data goes through the REST API.
 * Sign-in is an email one-time code (DECISIONS D-12).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      sessionRef.current = data.session;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      sessionRef.current = next;
      setSession(next);
      setLoading(false);
      if (event === 'SIGNED_OUT') {
        // Drop every cached business record and forget the workspace (ARCHITECTURE section 9).
        queryClient.clear();
        workspaceStore.set(null);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const sendCode = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) throw error;
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await getSupabase().auth.signOut();
    } finally {
      queryClient.clear();
      workspaceStore.set(null);
      sessionRef.current = null;
      setSession(null);
    }
  }, [queryClient]);

  const getAccessToken = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const refreshSession = useCallback(async () => {
    const { data, error } = await getSupabase().auth.refreshSession();
    if (error || !data.session) return null;
    return data.session.access_token;
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      loading,
      session,
      email: session?.user.email ?? null,
      sendCode,
      verifyCode,
      signOut,
      getAccessToken,
      refreshSession,
    }),
    [loading, session, sendCode, verifyCode, signOut, getAccessToken, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
