import type { Invoice } from '@/types/api';
import { invoiceTone, type InvoiceTone } from '@/lib/invoice-tone';
import type { MessageKey } from '@/lib/i18n/en';
import { useI18n } from '@/lib/i18n/useI18n';
import { cn } from '@/lib/cn';

const labelKey: Record<InvoiceTone, MessageKey> = {
  overdue: 'status.overdue',
  partial: 'status.partial',
  unpaid: 'status.unpaid',
  settled: 'status.settled',
  cancelled: 'status.cancelled',
};

const styles: Record<InvoiceTone, string> = {
  overdue: 'bg-stamp-soft text-stamp',
  partial: 'bg-ochre-soft text-ochre',
  unpaid: 'bg-cement-200 text-ink-700',
  settled: 'bg-ledger-soft text-ledger',
  cancelled: 'bg-cement-200 text-ink-500 line-through decoration-1',
};

function Icon({ tone }: { tone: InvoiceTone }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
  switch (tone) {
    case 'overdue':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 4.5V8.5L10.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'settled':
      return (
        <svg {...common}>
          <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'partial':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 2V14A6 6 0 0 1 8 2Z" fill="currentColor" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...common}>
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
  }
}

/** Status is always icon plus text, never colour alone. */
export function StatusChip({ invoice, className }: { invoice: Invoice; className?: string }) {
  const { t } = useI18n();
  const tone = invoiceTone(invoice);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold',
        styles[tone],
        className,
      )}
    >
      <Icon tone={tone} />
      {t(labelKey[tone])}
    </span>
  );
}
