import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '@/lib/ApiProvider';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ApiGate } from '@/app/ApiGate';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // The API client already retries GETs; do not stack another retry layer on top.
        retry: false,
      },
      mutations: { retry: false },
    },
  });
}

export function AppProviders({ apiBaseUrl, children }: { apiBaseUrl: string; children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <I18nProvider>
      <ApiGate baseUrl={apiBaseUrl}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ApiProvider baseUrl={apiBaseUrl}>{children}</ApiProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ApiGate>
    </I18nProvider>
  );
}
