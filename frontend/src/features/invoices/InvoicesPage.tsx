import { Link, useSearchParams } from 'react-router-dom';
import { formatDate } from '@/lib/dates';
import { useI18n } from '@/lib/i18n/useI18n';
import { cn } from '@/lib/cn';
import type { MessageKey } from '@/lib/i18n/en';
import { Button, LinkButton } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States';
import { InvoiceCard } from '@/features/invoices/InvoiceCard';
import { useDueText } from '@/features/invoices/use-due-text';
import { invoiceFilters, isInvoiceFilter, useInvoices, type InvoiceFilter } from '@/features/invoices/hooks';
import { useBusinessId } from '@/features/workspaces/hooks';
import type { Invoice } from '@/types/api';

const filterLabel: Record<InvoiceFilter, MessageKey> = {
  open: 'invoices.filter.open',
  overdue: 'invoices.filter.overdue',
  unpaid: 'invoices.filter.unpaid',
  partial: 'invoices.filter.partial',
  settled: 'invoices.filter.settled',
  cancelled: 'invoices.filter.cancelled',
};

function TableRow({ invoice }: { invoice: Invoice }) {
  const dueText = useDueText(invoice);
  return (
    <tr className="hover:bg-cement-50">
      <td className="px-4 py-3">
        <Link to={`/invoices/${invoice.id}`} className="font-semibold text-ink-900 underline-offset-2 hover:underline">
          {invoice.invoice_number}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink-700">{invoice.customer.name}</td>
      <td className={cn('px-4 py-3', invoice.is_overdue ? 'font-medium text-stamp' : 'text-ink-600')}>
        {invoice.is_overdue ? dueText : formatDate(invoice.due_date)}
      </td>
      <td className="px-4 py-3">
        <StatusChip invoice={invoice} />
      </td>
      <td className="px-4 py-3 text-right">
        <Money
          paise={invoice.status === 'cancelled' ? invoice.total_paise : invoice.outstanding_paise}
          className="text-ink-900"
        />
      </td>
    </tr>
  );
}

export function InvoicesPage() {
  const { t } = useI18n();
  const businessId = useBusinessId();
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('filter');
  const filter: InvoiceFilter = isInvoiceFilter(rawFilter) ? rawFilter : 'open';
  const query = useInvoices(businessId, filter);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const choose = (next: InvoiceFilter) => {
    setParams(next === 'open' ? {} : { filter: next }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink-900">{t('invoices.title')}</h1>
        <LinkButton to="/invoices/new">{t('invoices.new')}</LinkButton>
      </div>

      <div role="group" aria-label={t('invoices.filter.label')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {invoiceFilters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={f === filter}
            onClick={() => choose(f)}
            className={cn(
              'min-h-touch shrink-0 rounded-full border px-4 font-semibold transition-colors',
              f === filter
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-cement-300 bg-white text-ink-700 hover:bg-cement-100',
            )}
          >
            {t(filterLabel[f])}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} title={t('invoices.loadFailed')} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        filter === 'open' ? (
          <EmptyState
            title={t('invoices.emptyTitle')}
            body={t('invoices.emptyBody')}
            action={<LinkButton to="/invoices/new">{t('invoices.new')}</LinkButton>}
          />
        ) : (
          <EmptyState title={t('invoices.emptyFiltered')} />
        )
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {items.map((invoice) => (
              <li key={invoice.id}>
                <InvoiceCard invoice={invoice} />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-card border border-cement-300 bg-white md:block">
            <table className="w-full text-left">
              <thead className="border-b border-cement-200 bg-cement-50 text-sm text-ink-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('invoices.col.invoice')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('invoices.col.customer')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('invoices.col.due')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('invoices.col.status')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{t('invoices.col.outstanding')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cement-200">
                {items.map((invoice) => (
                  <TableRow key={invoice.id} invoice={invoice} />
                ))}
              </tbody>
            </table>
          </div>

          {query.hasNextPage ? (
            <Button variant="secondary" block loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {t('common.loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
