import { Link } from 'react-router-dom';
import { invoiceTone, ruleColour } from '@/lib/invoice-tone';
import { cn } from '@/lib/cn';
import { Money } from '@/components/ui/Money';
import { StatusChip } from '@/components/ui/StatusChip';
import { useDueText } from '@/features/invoices/use-due-text';
import type { Invoice } from '@/types/api';

/** A ledger line: a coloured margin rule on the left, like the red line down a ledger page. */
export function InvoiceCard({ invoice, showCustomer = true }: { invoice: Invoice; showCustomer?: boolean }) {
  const dueText = useDueText(invoice);
  const tone = invoiceTone(invoice);
  return (
    <Link
      to={`/invoices/${invoice.id}`}
      className="relative block overflow-hidden rounded-card border border-cement-300 bg-white p-4 pl-5 hover:bg-cement-50"
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1.5', ruleColour[tone])} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink-900">{invoice.invoice_number}</p>
          {showCustomer ? <p className="truncate text-ink-600">{invoice.customer.name}</p> : null}
          <p className={cn('text-sm', invoice.is_overdue ? 'font-medium text-stamp' : 'text-ink-500')}>{dueText}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Money
            paise={invoice.status === 'cancelled' ? invoice.total_paise : invoice.outstanding_paise}
            className="text-lg text-ink-900"
          />
          <StatusChip invoice={invoice} />
        </div>
      </div>
    </Link>
  );
}
