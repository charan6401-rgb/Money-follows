import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessageKey } from '@/lib/errors';
import { fieldMessage } from '@/lib/form';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { FocusPage } from '@/components/layout/FocusPage';
import { useInvoice, useUpdateInvoice } from '@/features/invoices/hooks';
import { makeInvoiceEditSchema, type InvoiceEditValues } from '@/features/invoices/schemas';
import { useBusinessId } from '@/features/workspaces/hooks';
import type { InvoiceDetail } from '@/types/api';

function EditForm({ businessId, invoice }: { businessId: string; invoice: InvoiceDetail }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const update = useUpdateInvoice(businessId, invoice.id);
  const schema = useMemo(() => makeInvoiceEditSchema(invoice.invoice_date), [invoice.invoice_date]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<InvoiceEditValues>({
    resolver: zodResolver(schema),
    defaultValues: { due_date: invoice.due_date, notes: invoice.notes ?? '' },
  });

  const onSubmit = handleSubmit((values) => {
    const notes = values.notes.trim();
    const body: { due_date?: string; notes?: string | null } = {};
    if (values.due_date !== invoice.due_date) body.due_date = values.due_date;
    if (notes !== (invoice.notes ?? '')) body.notes = notes === '' ? null : notes;
    if (Object.keys(body).length === 0) {
      navigate(`/invoices/${invoice.id}`, { replace: true });
      return;
    }
    update.mutate(body, { onSuccess: () => navigate(`/invoices/${invoice.id}`, { replace: true }) });
  });

  return (
    <FocusPage
      title={t('invoices.editTitle')}
      backTo={`/invoices/${invoice.id}`}
      footer={
        <Button type="submit" form="invoice-edit-form" block loading={update.isPending}>
          {t('common.save')}
        </Button>
      }
    >
      <form id="invoice-edit-form" onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <p className="rounded-control bg-cement-200 px-3 py-2 text-ink-700">{t('invoices.editHint')}</p>
        <TextField label={t('invoices.due')} type="date" error={fieldMessage(t, errors.due_date)} {...register('due_date')} />
        <TextAreaField
          label={t('invoices.notes')}
          optionalLabel={t('common.optional')}
          maxLength={1000}
          error={fieldMessage(t, errors.notes)}
          {...register('notes')}
        />
        {update.isError ? (
          <p role="alert" className="text-sm font-medium text-stamp">
            {t(errorMessageKey(update.error))}
          </p>
        ) : null}
      </form>
    </FocusPage>
  );
}

export function InvoiceEditPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const businessId = useBusinessId();
  const invoice = useInvoice(businessId, id);
  if (invoice.isPending) {
    return (
      <FocusPage title={t('invoices.editTitle')} backTo={`/invoices/${id}`}>
        <ListSkeleton rows={2} />
      </FocusPage>
    );
  }
  if (invoice.isError) {
    return (
      <FocusPage title={t('invoices.editTitle')} backTo="/invoices">
        <ErrorState error={invoice.error} title={t('invoices.loadFailed')} onRetry={() => void invoice.refetch()} />
      </FocusPage>
    );
  }
  if (invoice.data.status !== 'open') {
    return (
      <FocusPage title={t('invoices.editTitle')} backTo={`/invoices/${id}`}>
        <p role="alert" className="text-ink-700">{t('err.invoice_not_open')}</p>
      </FocusPage>
    );
  }
  return <EditForm businessId={businessId} invoice={invoice.data} />;
}
