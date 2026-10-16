import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/useI18n';
import { formatDate } from '@/lib/dates';
import { Money } from '@/components/ui/Money';
import { LinkButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { AgingStrip } from '@/features/dashboard/AgingStrip';
import { useAgingReport, useDashboardSummary } from '@/features/dashboard/hooks';
import { useBusinessId } from '@/features/workspaces/hooks';

export function DashboardPage() {
  const { t } = useI18n();
  const businessId = useBusinessId();
  const summary = useDashboardSummary(businessId);
  const aging = useAgingReport(businessId);

  if (summary.isPending) {
    return (
      <div role="status" aria-label={t('common.loading')} className="space-y-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (summary.isError) {
    return (
      <ErrorState error={summary.error} title={t('dash.loadFailed')} onRetry={() => void summary.refetch()} />
    );
  }

  const s = summary.data;
  if (s.open_invoice_count === 0 && s.total_outstanding_paise === 0) {
    return (
      <>
        <h1 className="mb-4 font-serif text-2xl text-ink-900">{t('dash.title')}</h1>
        <EmptyState
          title={t('dash.emptyTitle')}
          body={t('dash.emptyBody')}
          action={<LinkButton to="/customers/new">{t('customers.new')}</LinkButton>}
        />
      </>
    );
  }

  const attention: Array<{ label: string; value: number }> = [
    { label: t('dash.promisesDue'), value: s.promises_due_today },
    { label: t('dash.promisesOverdue'), value: s.promises_overdue },
    { label: t('dash.disputes'), value: s.open_disputes },
  ].filter((a) => a.value > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl text-ink-900">{t('dash.title')}</h1>
        <p className="text-sm text-ink-500">{t('dash.asOf', { date: formatDate(s.as_of) })}</p>
      </div>

      <section className="grid gap-4 md:grid-cols-5">
        <div className="rounded-card border border-cement-300 bg-white p-5 md:col-span-3">
          <p className="text-ink-600">{t('dash.totalOutstanding')}</p>
          <Money paise={s.total_outstanding_paise} className="mt-1 block text-4xl text-ink-900 md:text-5xl" />
          <p className="mt-1 text-ink-600">{t('dash.openInvoices', { n: s.open_invoice_count })}</p>
        </div>
        <div className="rounded-card border border-stamp-ring bg-stamp-soft p-5 md:col-span-2">
          <p className="text-stamp">{t('dash.overdue')}</p>
          <Money paise={s.overdue_outstanding_paise} className="mt-1 block text-3xl text-stamp" />
          <p className="mt-1 text-ink-700">{t('dash.overdueCount', { n: s.overdue_invoice_count })}</p>
        </div>
      </section>

      <section className="rounded-card border border-cement-300 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className="font-serif text-xl text-ink-900">{t('dash.collected')}</h2>
          <Money paise={s.collected_last_30_days_paise} className="text-2xl text-ledger" />
        </div>
        <p className="mt-1 text-sm text-ink-500">{t('dash.collectedHint')}</p>
        {attention.length > 0 ? (
          <dl className="mt-4 grid grid-cols-1 gap-2 border-t border-cement-200 pt-4 sm:grid-cols-3">
            {attention.map((a) => (
              <div key={a.label}>
                <dt className="text-sm text-ink-600">{a.label}</dt>
                <dd className="num text-xl text-ink-900">{a.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section className="rounded-card border border-cement-300 bg-white p-5">
        <h2 className="font-serif text-xl text-ink-900">{t('dash.aging')}</h2>
        <p className="mb-4 text-sm text-ink-500">{t('dash.agingHint')}</p>
        {aging.isPending ? (
          <Skeleton className="h-52 w-full" />
        ) : aging.isError ? (
          <ErrorState error={aging.error} title={t('dash.loadFailed')} onRetry={() => void aging.refetch()} />
        ) : (
          <AgingStrip buckets={aging.data.buckets} />
        )}
      </section>

      {aging.data && aging.data.items.length > 0 ? (
        <section className="rounded-card border border-cement-300 bg-white p-5">
          <h2 className="font-serif text-xl text-ink-900">{t('dash.longestOverdue')}</h2>
          <ul className="mt-2 divide-y divide-cement-200">
            {aging.data.items.map((item) => (
              <li key={item.invoice_id}>
                <Link
                  to={`/invoices/${item.invoice_id}`}
                  className="flex min-h-touch items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink-900">{item.customer_name}</span>
                    <span className="block truncate text-sm text-ink-500">
                      {item.invoice_number}, {t('invoices.overdueDays', { n: item.days_overdue })}
                    </span>
                  </span>
                  <Money paise={item.outstanding_paise} className="text-lg text-stamp" />
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/invoices?filter=overdue" className="mt-2 inline-flex min-h-touch items-center font-semibold text-ink-900 underline">
            {t('dash.viewOverdue')}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
