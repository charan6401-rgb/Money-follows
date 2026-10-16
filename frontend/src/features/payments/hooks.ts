import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api-context';
import { keys } from '@/lib/query-keys';
import { useInvalidateMoney } from '@/features/invoices/hooks';
import type {
  CreatePaymentRequest,
  Page,
  Payment,
  PaymentCreated,
  PaymentReversed,
  ReasonRequest,
} from '@/types/api';

export function usePayments(businessId: string, invoiceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: keys.payments(businessId, invoiceId),
    queryFn: ({ signal }) =>
      api.get<Page<Payment>>(`/invoices/${invoiceId}/payments`, { status: 'all' }, { signal }),
  });
}

export interface RecordPaymentArgs {
  body: CreatePaymentRequest;
  /** Generated once per form opening and reused on every retry (API.md section 1). */
  idempotencyKey: string;
}

export function useRecordPayment(businessId: string, invoiceId: string) {
  const api = useApi();
  const invalidate = useInvalidateMoney(businessId);
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: RecordPaymentArgs) =>
      api.post<PaymentCreated>(`/invoices/${invoiceId}/payments`, body, { idempotencyKey }),
    onSuccess: invalidate,
  });
}

export function useReversePayment(businessId: string, paymentId: string) {
  const api = useApi();
  const invalidate = useInvalidateMoney(businessId);
  return useMutation({
    mutationFn: (body: ReasonRequest) =>
      api.post<PaymentReversed>(`/payments/${paymentId}/reverse`, body),
    onSuccess: invalidate,
  });
}
