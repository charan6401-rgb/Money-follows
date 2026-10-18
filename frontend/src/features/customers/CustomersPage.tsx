import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/useI18n';
import { formatPhone } from '@/lib/phone';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Button, LinkButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States';
import { effectiveSearch, useCustomers } from '@/features/customers/hooks';
import { useBusinessId } from '@/features/workspaces/hooks';
import type { CustomerListItem } from '@/types/api';

function CustomerCard({ customer }: { customer: CustomerListItem }) {
  const { t } = useI18n();
  return (
    <Link
      to={`/customers/${customer.id}`}
      className="block rounded-card border border-cement-300 bg-white p-4 hover:bg-cement-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink-900">{customer.name}</p>
          <p className="text-sm text-ink-500">
            {customer.phone ? formatPhone(customer.phone) : '-'}
            {customer.is_active ? '' : ` (${t('status.inactive')})`}
          </p>
        </div>
        <div className="text-right">
          <Money paise={customer.outstanding_paise} className="text-lg text-ink-900" />
          {customer.overdue_paise > 0 ? (
            <p className="text-sm text-stamp">
              {t('customers.overdue')} <Money paise={customer.overdue_paise} />
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function CustomersPage() {
  const { t } = useI18n();
  const businessId = useBusinessId();
  const [search, setSearch] = useState('');
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const debounced = useDebouncedValue(search);
  const query = useCustomers(businessId, debounced, inactiveOnly);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const searching = effectiveSearch(debounced) !== '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink-900">{t('customers.title')}</h1>
        <LinkButton to="/customers/new">{t('customers.new')}</LinkButton>
      </div>

      <div className="space-y-2 md:flex md:items-end md:gap-4 md:space-y-0">
        <div className="md:max-w-sm md:flex-1">
          <TextField
            label={t('customers.searchLabel')}
            type="search"
            placeholder={t('customers.searchPlaceholder')}
            value={search}
            hint={search.trim().length === 1 ? t('customers.minSearch') : undefined}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <label className="flex min-h-touch items-center gap-2 text-ink-700">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={inactiveOnly}
            onChange={(event) => setInactiveOnly(event.target.checked)}
          />
          {t('customers.showInactive')}
        </label>
      </div>

      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} title={t('customers.loadFailed')} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        searching ? (
          <EmptyState title={t('customers.emptySearch')} />
        ) : (
          <EmptyState
            title={t('customers.emptyTitle')}
            body={t('customers.emptyBody')}
            action={<LinkButton to="/customers/new">{t('customers.new')}</LinkButton>}
          />
        )
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {items.map((c) => (
              <li key={c.id}>
                <CustomerCard customer={c} />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-card border border-cement-300 bg-white md:block">
            <table className="w-full text-left">
              <thead className="border-b border-cement-200 bg-cement-50 text-sm text-ink-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('customers.col.name')}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t('customers.col.phone')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{t('customers.overdue')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{t('customers.outstanding')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cement-200">
                {items.map((c) => (
                  <tr key={c.id} className="hover:bg-cement-50">
                    <td className="px-4 py-3">
                      <Link to={`/customers/${c.id}`} className="font-semibold text-ink-900 underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                      {c.is_active ? null : <span className="ml-2 text-sm text-ink-500">({t('status.inactive')})</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{formatPhone(c.phone)}</td>
                    <td className="px-4 py-3 text-right text-stamp">
                      {c.overdue_paise > 0 ? <Money paise={c.overdue_paise} /> : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money paise={c.outstanding_paise} className="text-ink-900" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {query.hasNextPage ? (
            <Button
              variant="secondary"
              block
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
