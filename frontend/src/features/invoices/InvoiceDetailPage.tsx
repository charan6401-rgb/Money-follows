import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { formatDate } from '@/lib/dates';
import { formatPaise } from '@/lib/money';
import { en, type MessageKey } from '@/lib/i18n/en';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button, LinkButton } from '@/components/ui/Button';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { Money } from '@/components/ui/Money';
import { StatusChip } from '@/components/ui/StatusChip';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { FocusPage } from '@/components/layout/FocusPage';
import { useCancelInvoice, useInvoice } from '@/features/invoices/hooks';
import { usePayments, useReversePayment } from '@/features/payments/hooks';
import { canManage, useBusinessId, useCurrentWorkspace } from '@/features/workspaces/hooks';
import type { Payment } from '@/types/api';

function savedKey(state: unknown): MessageKey | null {
  const value = (state as { saved?: unknown } | null)?.saved;
  return typeof value === 'string' && value in en ? (value as MessageKey) : null;
}

function PaymentRow({ businessId, payment, canReverse }: { businessId: string; payment: Payment; canReverse: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const reverse = useReversePayment(businessId, payment.id);
  const reversed = payment.status === 'reversed';
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">
            {formatDate(payment.paid_on)} · {t(`pay.method.${payment.method}`)}
          </p>
          {payment.reference ? <p className="truncate text-sm text-ink-500">{payment.reference}</p> : null}
          {reversed ? (
            <p className="text-sm text-stamp">
              {t('pay.status.reversed')}
              {payment.reversed_at ? `. ${t('pay.reversedNote', { date: formatDate(payment.reversed_at.slice(0, 10)), reason: payment.reversal_reason ?? '' })}` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Money paise={payment.amount_paise} className={reversed ? 'text-ink-500 line-through' : 'text-ink-900'} />
          {canReverse && !reversed ? (
            <Button variant="quiet" className="min-h-0 py-1 text-sm" onClick={() => setOpen(true)}>
              {t('pay.reverse')}
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmSheet
        open={open}
        title={t('pay.reverse.title')}
        body={t('pay.reverse.body', { amount: formatPaise(payment.amount_paise) })}
        reasonLabel={t('pay.reverse.reason')}
        confirmLabel={t('pay.reverse.confirm')}
        cancelLabel={t('pay.reverse.keep')}
        destructive
        busy={reverse.isPending}
        error={reverse.error}
        onClose={() => setOpen(false)}
        onConfirm={(reason) => reverse.mutate({ reason }, { onSuccess: () => setOpen(false) })}
      />
    </li>
  );
}

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const location = useLocation();
  const businessId = useBusinessId();
  const manage = canManage(useCurrentWorkspace()?.role);
  const invoice = useInvoice(businessId, id);
  const payments = usePayments(businessId, id);
  const cancel = useCancelInvoice(businessId, id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const saved = savedKey(location.state);

  if (invoice.isPending) {
    return (
      <FocusPage title={t('invoices.title')} backTo="/invoices">
        <ListSkeleton rows={3} />
      </FocusPage>
    );
  }
  if (invoice.isError) {
    return (
      <FocusPage title={t('invoices.title')} backTo="/invoices">
        <ErrorState error={invoice.error} title={t('invoices.loadFailed')} onRetry={() => void invoice.refetch()} />
      </FocusPage>
    );
  }

  const inv = invoice.data;
  const isOpen = inv.status === 'open';
  const canPay = isOpen && inv.outstanding_paise > 0;

  return (
    <FocusPage
      title={inv.invoice_number}
      backTo="/invoices"
      footer={
        canPay ? (
          <LinkButton to={`/invoices/${inv.id}/pay`} block>
            {t('invoices.recordPayment')}
          </LinkButton>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {saved ? (
          <p role="status" className="rounded-control bg-ledger-soft px-3 py-2 font-medium text-ledger">
            {t(saved)}
          </p>
        ) : null}

        <section className="rounded-card border border-cement-300 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ink-600">{t('invoices.outstanding')}</p>
              <Money paise={inv.outstanding_paise} className="text-3xl text-ink-900" />
            </div>
            <StatusChip invoice={inv} />
          </div>
          <p className="mt-3">
            <Link to={`/customers/${inv.customer.id}`} className="font-semibold text-ink-900 underline underline-offset-2">
              {inv.customer.name}
            </Link>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-cement-200 pt-4 text-sm">
            <div>
              <dt className="text-ink-500">{t('invoices.total')}</dt>
              <dd><Money paise={inv.total_paise} className="text-ink-900" /></dd>
            </div>
            <div>
              <dt className="text-ink-500">{t('invoices.paid')}</dt>
              <dd><Money paise={inv.paid_paise} className="text-ink-900" /></dd>
            </div>
            {inv.adjusted_paise > 0 ? (
              <div>
                <dt className="text-ink-500">{t('invoices.adjusted')}</dt>
                <dd><Money paise={inv.adjusted_paise} className="text-ink-900" /></dd>
              </div>
            ) : null}
            <div>
              <dt className="text-ink-500">{t('invoices.date')}</dt>
              <dd className="text-ink-900">{formatDate(inv.invoice_date)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">{t('invoices.due')}</dt>
              <dd className={inv.is_overdue ? 'font-medium text-stamp' : 'text-ink-900'}>
                {formatDate(inv.due_date)}
                {inv.is_overdue ? ` (${t('invoices.overdueDays', { n: inv.days_overdue })})` : ''}
              </dd>
            </div>
            <div className="col-span-2 text-ink-500">{t('invoices.fy', { label: inv.fy_label })}</div>
          </dl>
          {inv.notes ? <p className="mt-4 whitespace-pre-wrap border-t border-cement-200 pt-4 text-ink-700">{inv.notes}</p> : null}
          {inv.has_open_dispute ? <p className="mt-3 font-medium text-ochre">{t('invoices.disputeOpen')}</p> : null}
          {inv.pending_promise_date ? (
            <p className="mt-1 text-ink-700">{t('invoices.promiseOn', { date: formatDate(inv.pending_promise_date) })}</p>
          ) : null}
          {inv.status === 'cancelled' ? (
            <p className="mt-3 text-ink-600">
              {t('invoices.cancelledNote', { date: formatDate(inv.cancelled_at?.slice(0, 10)), reason: inv.cancel_reason ?? '' })}
            </p>
          ) : null}
          {isOpen && inv.payment_state === 'settled' ? <p className="mt-3 text-ledger">{t('invoices.settledNote')}</p> : null}
        </section>

        <section aria-labelledby="payments-heading" className="rounded-card border border-cement-300 bg-white p-5">
          <h2 id="payments-heading" className="font-serif text-xl text-ink-900">{t('invoices.payments')}</h2>
          {payments.isPending ? (
            <div className="mt-3"><ListSkeleton rows={1} /></div>
          ) : payments.isError ? (
            <div className="mt-3">
              <ErrorState error={payments.error} title={t('invoices.loadFailed')} onRetry={() => void payments.refetch()} />
            </div>
          ) : payments.data.items.length === 0 ? (
            <p className="mt-2 text-ink-600">{t('invoices.noPayments')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-cement-200">
              {payments.data.items.map((p) => (
                <PaymentRow key={p.id} businessId={businessId} payment={p} canReverse={manage} />
              ))}
            </ul>
          )}
        </section>

        {isOpen ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <LinkButton to={`/invoices/${inv.id}/edit`} variant="secondary">
              {t('invoices.edit')}
            </LinkButton>
            {manage ? (
              <Button variant="quiet" className="text-stamp" onClick={() => setCancelOpen(true)}>
                {t('invoices.cancelInvoice')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmSheet
        open={cancelOpen}
        title={t('invoices.cancel.title')}
        body={t('invoices.cancel.body')}
        reasonLabel={t('invoices.cancel.reason')}
        confirmLabel={t('invoices.cancel.confirm')}
        cancelLabel={t('invoices.cancel.keep')}
        destructive
        busy={cancel.isPending}
        error={cancel.error}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason) => cancel.mutate({ reason }, { onSuccess: () => setCancelOpen(false) })}
      />
    </FocusPage>
  );
}
