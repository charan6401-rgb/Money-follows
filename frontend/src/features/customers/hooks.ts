import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api-context';
import { keys } from '@/lib/query-keys';
import type {
  CreateCustomerRequest,
  Customer,
  CustomerCreated,
  CustomerListItem,
  Page,
  UpdateCustomerRequest,
} from '@/types/api';

/** The API needs at least 2 characters for a search; shorter text lists everything. */
export function effectiveSearch(text: string): string {
  const trimmed = text.trim();
  return trimmed.length >= 2 ? trimmed : '';
}

export function useCustomers(businessId: string, search: string, includeInactive: boolean) {
  const api = useApi();
  const q = effectiveSearch(search);
  return useInfiniteQuery({
    queryKey: keys.customers(businessId, q, includeInactive),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<CustomerListItem>>(
        '/customers',
        { q, is_active: includeInactive ? undefined : true, limit: 25, cursor: pageParam },
        { signal },
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useCustomer(businessId: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.customer(businessId, id),
    queryFn: ({ signal }) => api.get<Customer>(`/customers/${id}`, undefined, { signal }),
  });
}

export function useCreateCustomer(businessId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCustomerRequest) => api.post<CustomerCreated>('/customers', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.customersAll(businessId) }),
  });
}

export function useUpdateCustomer(businessId: string, id: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCustomerRequest) => api.patch<Customer>(`/customers/${id}`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.customersAll(businessId) });
      await queryClient.invalidateQueries({ queryKey: keys.customer(businessId, id) });
    },
  });
}
