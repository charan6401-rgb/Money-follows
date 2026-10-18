import { useParams } from 'react-router-dom';
import { errorMessageKey } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/useI18n';
import { formatPhone } from '@/lib/phone';
import { Button, LinkButton } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { FocusPage } from '@/components/layout/FocusPage';
import { useCustomer, useUpdateCustomer } from '@/features/customers/hooks';
import { InvoiceCard } from '@/features/invoices/InvoiceCard';
import { useInvoices } from '@/features/invoices/hooks';
import { useBusinessId } from '@/features/workspaces/hooks';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const businessId = useBusinessId();
  const customer = useCustomer(businessId, id);
  const invoices = useInvoices(businessId, 'open', id);
  const update = useUpdateCustomer(businessId, id);

  if (customer.isPending) {
    return (
      <FocusPage title={t('customers.title')} backTo="/customers">
        <ListSkeleton rows={3} />
      </FocusPage>
    );
  }
  if (customer.isError) {
    return (
      <FocusPage title={t('customers.title')} backTo="/customers">
        <ErrorState error={customer.error} title={t('customers.loadFailed')} onRetry={() => void customer.refetch()} />
      </FocusPage>
    );
  }

  const c = customer.data;
  const items = invoices.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <FocusPage
      title={c.name}
      backTo="/customers"
      footer={
        c.is_active ? (
          <LinkButton to={`/invoices/new?customer=${c.id}`} block>
            {t('customers.addInvoice')}
          </LinkButton>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <section className="rounded-card border border-cement-300 bg-white p-5">
          <p className="text-ink-600">{t('customers.outstanding')}</p>
          <Money paise={c.outstanding_paise} className="text-3xl text-ink-900" />
          {c.overdue_paise > 0 ? (
            <p className="mt-1 text-stamp">
              {t('customers.overdue')} <Money paise={c.overdue_paise} />
            </p>
          ) : null}
          <p className="mt-1 text-sm text-ink-500">{t('customers.openInvoices', { n: c.open_invoice_count })}</p>
          <dl className="mt-4 space-y-1 border-t border-cement-200 pt-4">
            <div>
              <dt className="sr-only">{t('customers.phone')}</dt>
              <dd className="text-ink-900">{c.phone ? formatPhone(c.phone) : '-'}</dd>
            </div>
            {c.notes ? (
              <div>
                <dt className="sr-only">{t('customers.notes')}</dt>
                <dd className="whitespace-pre-wrap text-ink-700">{c.notes}</dd>
              </div>
            ) : null}
            {!c.is_active ? <p className="text-ink-500">{t('status.inactive')}</p> : null}
          </dl>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <LinkButton to={`/customers/${c.id}/edit`} variant="secondary">
              {t('common.edit')}
            </LinkButton>
            <Button
              variant="quiet"
              loading={update.isPending}
              onClick={() => update.mutate({ is_active: !c.is_active })}
            >
              {c.is_active ? t('customers.deactivate') : t('customers.reactivate')}
            </Button>
          </div>
          {update.isError ? (
            <p role="alert" className="mt-2 text-sm font-medium text-stamp">
              {t(errorMessageKey(update.error))}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="customer-invoices" className="space-y-3">
          <h2 id="customer-invoices" className="font-serif text-xl text-ink-900">
            {t('customers.invoices')}
          </h2>
          {invoices.isPending ? (
            <ListSkeleton rows={2} />
          ) : invoices.isError ? (
            <ErrorState error={invoices.error} title={t('invoices.loadFailed')} onRetry={() => void invoices.refetch()} />
          ) : items.length === 0 ? (
            <p className="text-ink-600">{t('customers.noInvoices')}</p>
          ) : (
            <ul className="space-y-3">
              {items.map((invoice) => (
                <li key={invoice.id}>
                  <InvoiceCard invoice={invoice} showCustomer={false} />
                </li>
              ))}
            </ul>
          )}
          {invoices.hasNextPage ? (
            <Button variant="secondary" block loading={invoices.isFetchingNextPage} onClick={() => void invoices.fetchNextPage()}>
              {t('common.loadMore')}
            </Button>
          ) : null}
        </section>
      </div>
    </FocusPage>
  );
}
