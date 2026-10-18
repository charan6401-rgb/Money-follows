import { formatDate } from '@/lib/dates';
import { useI18n } from '@/lib/i18n/useI18n';
import type { Invoice } from '@/types/api';

/** The due line: how late, or when it is due. Shared by the list, the table and the customer page. */
export function useDueText(invoice: Pick<Invoice, 'is_overdue' | 'days_overdue' | 'due_date'>): string {
  const { t } = useI18n();
  return invoice.is_overdue
    ? t('invoices.overdueDays', { n: invoice.days_overdue })
    : t('invoices.dueOn', { date: formatDate(invoice.due_date) });
}
