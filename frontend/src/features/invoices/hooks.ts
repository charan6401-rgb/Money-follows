import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api-context';
import { keys } from '@/lib/query-keys';
import type {
  CreateInvoiceRequest,
  Invoice,
  InvoiceDetail,
  Page,
  ReasonRequest,
  UpdateInvoiceRequest,
} from '@/types/api';

export type InvoiceFilter = 'open' | 'overdue' | 'unpaid' | 'partial' | 'settled' | 'cancelled';

export const invoiceFilters: InvoiceFilter[] = [
  'open',
  'overdue',
  'unpaid',
  'partial',
  'settled',
  'cancelled',
];

export function isInvoiceFilter(value: string | null): value is InvoiceFilter {
  return value !== null && (invoiceFilters as string[]).includes(value);
}

/** Maps the filter chips onto the documented query parameters (API.md section 5.2). */
export function filterToQuery(filter: InvoiceFilter): Record<string, string> {
  switch (filter) {
    case 'overdue':
      return { overdue: 'true' };
    case 'unpaid':
    case 'partial':
    case 'settled':
      return { payment_state: filter };
    case 'cancelled':
      return { status: 'cancelled' };
    default:
      return {};
  }
}

export function useInvoices(businessId: string, filter: InvoiceFilter, customerId?: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: keys.invoices(businessId, filter, customerId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<Invoice>>(
        '/invoices',
        { ...filterToQuery(filter), customer_id: customerId, limit: 25, cursor: pageParam },
        { signal },
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useInvoice(businessId: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.invoice(businessId, id),
    queryFn: ({ signal }) => api.get<InvoiceDetail>(`/invoices/${id}`, undefined, { signal }),
  });
}

/** Anything that changes money must refresh lists, the invoice and the dashboard numbers. */
export function useInvalidateMoney(businessId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.invoicesAll(businessId) }),
      queryClient.invalidateQueries({ queryKey: [businessId, 'invoice'] }),
      queryClient.invalidateQueries({ queryKey: [businessId, 'payments'] }),
      queryClient.invalidateQueries({ queryKey: keys.customersAll(businessId) }),
      queryClient.invalidateQueries({ queryKey: [businessId, 'customer'] }),
      queryClient.invalidateQueries({ queryKey: keys.dashboard(businessId) }),
      queryClient.invalidateQueries({ queryKey: keys.aging(businessId) }),
    ]);
  };
}

export function useCreateInvoice(businessId: string) {
  const api = useApi();
  const invalidate = useInvalidateMoney(businessId);
  return useMutation({
    mutationFn: (body: CreateInvoiceRequest) => api.post<Invoice>('/invoices', body),
    onSuccess: invalidate,
  });
}

export function useUpdateInvoice(businessId: string, id: string) {
  const api = useApi();
  const invalidate = useInvalidateMoney(businessId);
  return useMutation({
    mutationFn: (body: UpdateInvoiceRequest) => api.patch<InvoiceDetail>(`/invoices/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useCancelInvoice(businessId: string, id: string) {
  const api = useApi();
  const invalidate = useInvalidateMoney(businessId);
  return useMutation({
    mutationFn: (body: ReasonRequest) => api.post<InvoiceDetail>(`/invoices/${id}/cancel`, body),
    onSuccess: invalidate,
  });
}
