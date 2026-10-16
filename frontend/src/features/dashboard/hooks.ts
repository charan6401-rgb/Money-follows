import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api-context';
import { keys } from '@/lib/query-keys';
import type { AgingReport, DashboardSummary } from '@/types/api';

export function useDashboardSummary(businessId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.dashboard(businessId),
    queryFn: ({ signal }) => api.get<DashboardSummary>('/dashboard/summary', undefined, { signal }),
  });
}

export function useAgingReport(businessId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.aging(businessId),
    queryFn: ({ signal }) =>
      api.get<AgingReport>('/reports/invoice-aging', { limit: 5, offset: 0 }, { signal }),
  });
}
