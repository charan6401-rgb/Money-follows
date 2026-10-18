import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { todayIST } from '@/lib/dates';
import { errorMessageKey } from '@/lib/errors';
import { fieldMessage } from '@/lib/form';
import { newIdempotencyKey } from '@/lib/idempotency';
import { useI18n } from '@/lib/i18n/useI18n';
import { formatPaise, paiseToRupeeString, rupeeStringToPaise } from '@/lib/money';
import { Button } from '@/components/ui/Button';
import { ConfirmSheet } from '@/components/ui/ConfirmSheet';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { Money } from '@/components/ui/Money';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { FocusPage } from '@/components/layout/FocusPage';
import { useInvoice } from '@/features/invoices/hooks';
import { useRecordPayment } from '@/features/payments/hooks';
import {
  makePaymentSchema,
  paymentMethods,
  toPaymentRequest,
  type PaymentFormValues,
} from '@/features/payments/schemas';
import { useBusinessId } from '@/features/workspaces/hooks';
import type { InvoiceDetail } from '@/types/api';

function PaymentForm({ businessId, invoice }: { businessId: string; invoice: InvoiceDetail }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const record = useRecordPayment(businessId, invoice.id);
  const schema = useMemo(
    () => makePaymentSchema(invoice.invoice_date, invoice.outstanding_paise),
    [invoice.invoice_date, invoice.outstanding_paise],
  );
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [values, setValues] = useState<PaymentFormValues | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  // One key per distinct request body. A retry of the SAME body reuses the key, so the server
  // can never record it twice; a changed body (for example "save anyway") gets a new key.
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const lastAllow = useRef(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: '', paid_on: todayIST(), method: 'upi', reference: '', note: '' },
  });

  const toReview = handleSubmit((v) => {
    record.reset();
    setValues(v);
    setStep('review');
  });

  const send = (allowDuplicate: boolean) => {
    if (!values) return;
    lastAllow.current = allowDuplicate;
    const body = toPaymentRequest(values, allowDuplicate);
    const fingerprint = JSON.stringify(body);
    if (keyRef.current?.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: newIdempotencyKey() };
    record.mutate(
      { body, idempotencyKey: keyRef.current.key },
      {
        onSuccess: () => navigate(`/invoices/${invoice.id}`, { replace: true, state: { saved: 'pay.saved' } }),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'possible_duplicate_payment') setDuplicate(true);
        },
      },
    );
  };

  const paise = values ? (rupeeStringToPaise(values.amount) ?? 0) : 0;
  const balanceAfter = invoice.outstanding_paise - paise;
  const unknownOutcome = record.error instanceof ApiError && record.error.outcomeUnknown;
  const shownError =
    record.isError && !unknownOutcome && !(record.error instanceof ApiError && record.error.code === 'possible_duplicate_payment');

  if (step === 'review' && values) {
    return (
      <FocusPage
        title={t('pay.reviewTitle')}
        backTo={`/invoices/${invoice.id}`}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={record.isPending} onClick={() => setStep('form')}>
              {t('pay.changeDetails')}
            </Button>
            <Button loading={record.isPending} onClick={() => send(false)}>
              {t('pay.confirm')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <dl className="space-y-3 rounded-card border border-cement-300 bg-white p-5">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">{t('pay.reviewInvoice')}</dt>
              <dd className="font-semibold text-ink-900">{invoice.invoice_number}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">{t('pay.reviewAmount')}</dt>
              <dd><Money paise={paise} className="text-xl text-ink-900" /></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">{t('pay.method')}</dt>
              <dd className="text-ink-900">{t(`pay.method.${values.method}`)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-600">{t('pay.reviewBalanceAfter')}</dt>
              <dd><Money paise={balanceAfter} className="text-ink-900" /></dd>
            </div>
          </dl>
          {balanceAfter === 0 ? <p className="font-medium text-ledger">{t('pay.reviewSettles')}</p> : null}

          {unknownOutcome ? (
            <div role="alert" className="rounded-card border border-ochre bg-ochre-soft p-4">
              <h2 className="font-semibold text-ochre">{t('pay.unknown.title')}</h2>
              <p className="mt-1 text-ink-700">{t('pay.unknown.body')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => send(lastAllow.current)} loading={record.isPending}>
                  {t('pay.unknown.retry')}
                </Button>
                <Link
                  to={`/invoices/${invoice.id}`}
                  className="inline-flex min-h-touch items-center rounded-control border border-cement-300 bg-white px-5 font-semibold"
                >
                  {t('pay.unknown.check')}
                </Link>
              </div>
            </div>
          ) : null}
          {shownError ? (
            <p role="alert" className="text-sm font-medium text-stamp">
              {t(errorMessageKey(record.error))}
            </p>
          ) : null}
        </div>

        <ConfirmSheet
          open={duplicate}
          title={t('pay.duplicate.title')}
          body={t('pay.duplicate.body')}
          confirmLabel={t('pay.duplicate.confirm')}
          cancelLabel={t('common.cancel')}
          busy={record.isPending}
          onClose={() => setDuplicate(false)}
          onConfirm={() => {
            setDuplicate(false);
            send(true);
          }}
        />
      </FocusPage>
    );
  }

  return (
    <FocusPage
      title={t('pay.title')}
      backTo={`/invoices/${invoice.id}`}
      footer={
        <Button type="submit" form="payment-form" block>
          {t('pay.review')}
        </Button>
      }
    >
      <form id="payment-form" onSubmit={(event) => void toReview(event)} noValidate className="space-y-4">
        <p className="text-ink-700">
          {invoice.invoice_number} · {invoice.customer.name} · <Money paise={invoice.outstanding_paise} />
        </p>
        <div>
          <TextField
            label={t('pay.amount')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            hint={t('pay.amountHint', { amount: formatPaise(invoice.outstanding_paise) })}
            error={fieldMessage(t, errors.amount)}
            {...register('amount')}
          />
          <Button
            variant="quiet"
            className="mt-1"
            onClick={() => setValue('amount', paiseToRupeeString(invoice.outstanding_paise), { shouldValidate: true })}
          >
            {t('pay.payFull')}
          </Button>
        </div>
        <TextField
          label={t('pay.date')}
          type="date"
          min={invoice.invoice_date}
          max={todayIST()}
          error={fieldMessage(t, errors.paid_on)}
          {...register('paid_on')}
        />
        <SelectField label={t('pay.method')} {...register('method')}>
          {paymentMethods.map((m) => (
            <option key={m} value={m}>
              {t(`pay.method.${m}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t('pay.reference')}
          optionalLabel={t('common.optional')}
          hint={t('pay.referenceHint')}
          autoComplete="off"
          maxLength={60}
          error={fieldMessage(t, errors.reference)}
          {...register('reference')}
        />
        <TextAreaField
          label={t('pay.note')}
          optionalLabel={t('common.optional')}
          maxLength={500}
          error={fieldMessage(t, errors.note)}
          {...register('note')}
        />
      </form>
    </FocusPage>
  );
}

export function PaymentFormPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const businessId = useBusinessId();
  const invoice = useInvoice(businessId, id);
  if (invoice.isPending) {
    return (
      <FocusPage title={t('pay.title')} backTo={`/invoices/${id}`}>
        <ListSkeleton rows={2} />
      </FocusPage>
    );
  }
  if (invoice.isError) {
    return (
      <FocusPage title={t('pay.title')} backTo="/invoices">
        <ErrorState error={invoice.error} title={t('invoices.loadFailed')} onRetry={() => void invoice.refetch()} />
      </FocusPage>
    );
  }
  if (invoice.data.status !== 'open' || invoice.data.outstanding_paise <= 0) {
    return (
      <FocusPage title={t('pay.title')} backTo={`/invoices/${id}`}>
        <p role="alert" className="text-ink-700">{t('pay.blocked')}</p>
      </FocusPage>
    );
  }
  return <PaymentForm businessId={businessId} invoice={invoice.data} />;
}
