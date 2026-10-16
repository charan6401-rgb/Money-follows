import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api-context';
import { useWorkspaceId, workspaceStore } from '@/lib/workspace-store';
import type { CreateWorkspaceRequest, Role, Workspace, WorkspaceList } from '@/types/api';

export const workspacesKey = ['workspaces'] as const;

/** The businesses the signed-in user belongs to (not scoped by X-Business-Id). */
export function useWorkspaces() {
  const api = useApi();
  return useQuery({
    queryKey: workspacesKey,
    queryFn: ({ signal }) =>
      api.get<WorkspaceList>('/businesses', undefined, { businessScoped: false, signal }),
  });
}

export function useCreateWorkspace() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspaceRequest) =>
      api.post<Workspace>('/businesses', body, { businessScoped: false }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: workspacesKey });
      workspaceStore.set(created.id);
    },
  });
}

/** The selected business, if the server still lists it for this user. */
export function useCurrentWorkspace(): Workspace | undefined {
  const id = useWorkspaceId();
  const { data } = useWorkspaces();
  return id ? data?.items.find((w) => w.id === id) : undefined;
}

/**
 * Owners and admins may reverse payments, cancel invoices and so on. This only hides buttons;
 * the server enforces the role on every request (SECURITY.md, DECISIONS D-4).
 */
export function canManage(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The selected business id for pages inside the workspace guard. */
export function useBusinessId(): string {
  return useWorkspaceId() ?? '';
}
