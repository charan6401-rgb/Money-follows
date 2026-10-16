import type { InvoiceStatus, PaymentState } from '@/types/api';

export type InvoiceTone = 'overdue' | 'partial' | 'unpaid' | 'settled' | 'cancelled';

/** One display state per invoice, in priority order: cancelled, settled, overdue, partial, unpaid. */
export function invoiceTone(invoice: {
  status: InvoiceStatus;
  payment_state: PaymentState;
  is_overdue: boolean;
}): InvoiceTone {
  if (invoice.status === 'cancelled') return 'cancelled';
  if (invoice.payment_state === 'settled') return 'settled';
  if (invoice.is_overdue) return 'overdue';
  return invoice.payment_state;
}

/** The colour of the card's left "margin rule", like the red line down a ledger page. */
export const ruleColour: Record<InvoiceTone, string> = {
  overdue: 'bg-stamp',
  partial: 'bg-ochre',
  unpaid: 'bg-cement-300',
  settled: 'bg-ledger',
  cancelled: 'bg-cement-300',
};

