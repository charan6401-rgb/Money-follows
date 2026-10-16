import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';

export interface AuthValue {
  /** True until the first session check finishes. */
  loading: boolean;
  session: Session | null;
  email: string | null;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  refreshSession: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
