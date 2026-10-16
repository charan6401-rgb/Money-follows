import { useSyncExternalStore } from 'react';

/**
 * The currently selected business. It is only a selector sent as `X-Business-Id`;
 * the server re-checks membership and role on every request (SECURITY.md).
 * Held in a tiny external store so the API client can read it outside React.
 */
const STORAGE_KEY = 'mf.workspace';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStored(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

let current: string | null = readStored();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const workspaceStore = {
  get(): string | null {
    return current;
  },
  set(id: string | null): void {
    if (id === current) return;
    current = id;
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not persisting only means the picker shows again after a reload.
    }
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useWorkspaceId(): string | null {
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.get, () => null);
}
