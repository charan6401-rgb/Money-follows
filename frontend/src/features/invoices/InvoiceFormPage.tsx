import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { addDays, todayIST } from '@/lib/dates';
import { errorMessageKey } from '@/lib/errors';
import { fieldMessage } from '@/lib/form';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button } from '@/components/ui/Button';
import { TextAreaField, TextField } from '@/components/ui/Field';
import { FocusPage } from '@/components/layout/FocusPage';
import { CustomerPicker } from '@/features/invoices/CustomerPicker';
import { useCreateInvoice } from '@/features/invoices/hooks';
import { invoiceSchema, toInvoiceRequest, type InvoiceFormValues } from '@/features/invoices/schemas';
import { useBusinessId } from '@/features/workspaces/hooks';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverFieldError(error: unknown): { field: keyof InvoiceFormValues; message: string } | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'duplicate_invoice_number') return { field: 'invoice_number', message: 'err.duplicate_invoice_number' };
  if (error.code === 'invalid_amount') return { field: 'amount', message: 'err.invalid_amount' };
  return null;
}

export function InvoiceFormPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const businessId = useBusinessId();
  const [params] = useSearchParams();
  const create = useCreateInvoice(businessId);
  const preselected = params.get('customer');
  const today = todayIST();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      customer_id: preselected && UUID.test(preselected) ? preselected : '',
      invoice_number: '',
      invoice_date: today,
      due_date: addDays(today, 30),
      amount: '',
      notes: '',
    },
  });

  const onSubmit = handleSubmit((values) => {
    create.mutate(toInvoiceRequest(values), {
      onSuccess: (invoice) => navigate(`/invoices/${invoice.id}`, { replace: true, state: { saved: 'invoices.created' } }),
      onError: (error) => {
        const mapped = serverFieldError(error);
        if (mapped) setError(mapped.field, { message: mapped.message });
      },
    });
  });

  const text = (message: string | undefined) =>
    message === 'err.duplicate_invoice_number' || message === 'err.invalid_amount'
      ? t(message)
      : fieldMessage(t, message ? { message } : undefined);

  return (
    <FocusPage
      title={t('invoices.new')}
      backTo="/invoices"
      footer={
        <Button type="submit" form="invoice-form" block loading={create.isPending}>
          {t('invoices.create')}
        </Button>
      }
    >
      <form id="invoice-form" onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <Controller
          control={control}
          name="customer_id"
          render={({ field }) => (
            <CustomerPicker
              businessId={businessId}
              value={field.value}
              onChange={field.onChange}
              error={text(errors.customer_id?.message)}
            />
          )}
        />
        <TextField
          label={t('invoices.number')}
          autoComplete="off"
          maxLength={40}
          error={text(errors.invoice_number?.message)}
          {...register('invoice_number')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('invoices.date')}
            type="date"
            max={today}
            min="2000-01-01"
            error={text(errors.invoice_date?.message)}
            {...register('invoice_date')}
          />
          <TextField
            label={t('invoices.due')}
            type="date"
            error={text(errors.due_date?.message)}
            {...register('due_date')}
          />
        </div>
        <TextField
          label={t('invoices.amount')}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          hint={t('invoices.amountHint')}
          error={text(errors.amount?.message)}
          {...register('amount')}
        />
        <TextAreaField
          label={t('invoices.notes')}
          optionalLabel={t('common.optional')}
          maxLength={1000}
          error={text(errors.notes?.message)}
          {...register('notes')}
        />
        {create.isError && !serverFieldError(create.error) ? (
          <p role="alert" className="text-sm font-medium text-stamp">
            {t(errorMessageKey(create.error))}
          </p>
        ) : null}
      </form>
    </FocusPage>
  );
}
