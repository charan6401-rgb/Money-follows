import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useWorkspaces } from '@/features/workspaces/hooks';
import { useWorkspaceId, workspaceStore } from '@/lib/workspace-store';
import { ErrorState, FullScreenLoading } from '@/components/ui/States';
import { useI18n } from '@/lib/i18n/useI18n';

/** UX guard only: the API verifies the token on every request (SECURITY.md). */
export function RequireAuth() {
  const { loading, session } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (!session) return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

/**
 * Makes sure a business the server still lists is selected. One business is selected
 * automatically; none sends the user to create one; several send them to the picker.
 */
export function RequireWorkspace() {
  const { t } = useI18n();
  const selected = useWorkspaceId();
  const query = useWorkspaces();
  const items = query.data?.items;
  const valid = Boolean(items && selected && items.some((w) => w.id === selected));
  const only = items && items.length === 1 ? items[0] : undefined;
  const onlyId = only?.id;

  useEffect(() => {
    if (!items) return;
    if (selected && !valid) workspaceStore.set(null); // access was lost or the id is stale
    else if (!selected && onlyId) workspaceStore.set(onlyId);
  }, [items, selected, valid, onlyId]);

  if (query.isPending) return <FullScreenLoading />;
  if (query.isError) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <ErrorState error={query.error} title={t('workspace.loadFailed')} onRetry={() => void query.refetch()} />
      </main>
    );
  }
  if (!items || items.length === 0) return <Navigate to="/workspace/new" replace />;
  if (valid) return <Outlet />;
  if (onlyId) return <FullScreenLoading />; // the effect above selects it
  return <Navigate to="/workspace" replace />;
}
