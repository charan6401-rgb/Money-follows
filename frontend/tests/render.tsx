/* eslint-disable react-refresh/only-export-components -- test helper, not an app module */
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createApiClient } from '@/lib/api';
import { ApiContext } from '@/lib/api-context';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { workspaceStore } from '@/lib/workspace-store';
import type { Role } from '@/types/api';
import { BUSINESS_ID, makeWorkspace, v1 } from './mocks/handlers';
import { server } from './mocks/server';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

export interface RenderOptions {
  /** Where the router starts, for example "/invoices?filter=overdue". */
  route: string;
  /** The route pattern the page element is mounted at, for example "/invoices/:id". */
  path: string;
  role?: Role;
}

/**
 * Renders one page inside the real providers (query cache, i18n, API client pointing at MSW)
 * with a selected business. Any other route renders its path so navigation can be asserted.
 */
export function renderPage(page: ReactElement, { route, path, role = 'owner' }: RenderOptions) {
  workspaceStore.set(BUSINESS_ID);
  server.use(http.get(v1('/businesses'), () => HttpResponse.json({ items: [makeWorkspace({ role })] })));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  const client = createApiClient({
    baseUrl: 'http://api.test',
    getAccessToken: async () => 'test-token',
    refreshSession: async () => null,
    getBusinessId: () => workspaceStore.get(),
    onSessionExpired: () => {},
    onWorkspaceDenied: () => {},
    sleep: async () => {},
  });
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={client}>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path={path} element={page} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </ApiContext.Provider>
      </QueryClientProvider>
    </I18nProvider>,
  );
}
