import { useState } from 'react';
import { effectiveSearch, useCustomer, useCustomers } from '@/features/customers/hooks';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useI18n } from '@/lib/i18n/useI18n';
import { formatPhone } from '@/lib/phone';
import { cn } from '@/lib/cn';
import { Button, LinkButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { ErrorState, ListSkeleton } from '@/components/ui/States';

interface Props {
  businessId: string;
  /** The chosen customer id, or '' when none is chosen yet. */
  value: string;
  onChange: (customerId: string) => void;
  error?: string | undefined;
}

/**
 * Choose which customer an invoice is for: search by name or phone, then pick one.
 * The picked customer is shown with a "Change customer" button. Only active customers are listed.
 */
export function CustomerPicker({ businessId, value, onChange, error }: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search);
  const chosen = useCustomer(businessId, value);
  const list = useCustomers(businessId, debounced, false);

  if (value) {
    return (
      <div>
        <p className="mb-1 text-sm font-semibold text-ink-700">{t('invoices.customer')}</p>
        <div className="flex items-center justify-between gap-3 rounded-control border border-cement-300 bg-white px-3 py-2">
          <p className="min-w-0 truncate font-semibold text-ink-900">
            {chosen.data ? chosen.data.name : t('common.loading')}
          </p>
          <Button variant="quiet" onClick={() => onChange('')}>
            {t('invoices.changeCustomer')}
          </Button>
        </div>
      </div>
    );
  }

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-2">
      <TextField
        label={t('invoices.customer')}
        type="search"
        placeholder={t('customers.searchPlaceholder')}
        autoComplete="off"
        hint={search.trim().length === 1 ? t('customers.minSearch') : undefined}
        error={error}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {list.isPending ? (
        <ListSkeleton rows={2} />
      ) : list.isError ? (
        <ErrorState error={list.error} title={t('customers.loadFailed')} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-control border border-dashed border-cement-300 bg-white p-4 text-center">
          <p className="text-ink-600">{effectiveSearch(debounced) ? t('customers.emptySearch') : t('customers.emptyTitle')}</p>
          <LinkButton to="/customers/new" variant="secondary" className="mt-3">
            {t('invoices.addCustomer')}
          </LinkButton>
        </div>
      ) : (
        <ul aria-label={t('invoices.chooseCustomer')} className="max-h-72 divide-y divide-cement-200 overflow-y-auto rounded-control border border-cement-300 bg-white">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChange(c.id)}
                className={cn('flex min-h-touch w-full flex-col items-start px-3 py-2 text-left hover:bg-cement-100')}
              >
                <span className="font-semibold text-ink-900">{c.name}</span>
                {c.phone ? <span className="text-sm text-ink-500">{formatPhone(c.phone)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
