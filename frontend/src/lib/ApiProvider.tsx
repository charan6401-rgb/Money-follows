import { useMemo, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createApiClient } from '@/lib/api';
import { ApiContext } from '@/lib/api-context';
import { workspaceStore } from '@/lib/workspace-store';
import { useAuth } from '@/features/auth/auth-context';

export function ApiProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();

  // The client is built once; the latest callbacks are read through a ref.
  const authRef = useRef(auth);
  authRef.current = auth;

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl,
        getAccessToken: () => authRef.current.getAccessToken(),
        refreshSession: () => authRef.current.refreshSession(),
        getBusinessId: () => workspaceStore.get(),
        onSessionExpired: () => {
          void authRef.current.signOut();
        },
        onWorkspaceDenied: () => {
          // Back to the picker, and drop anything cached for the business we lost.
          workspaceStore.set(null);
          void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        },
      }),
    [baseUrl, queryClient],
  );

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
