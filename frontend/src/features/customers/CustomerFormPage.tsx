import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { fieldMessage } from '@/lib/form';
import { errorMessageKey } from '@/lib/errors';
import { formatPhone } from '@/lib/phone';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button } from '@/components/ui/Button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { FocusPage } from '@/components/layout/FocusPage';
import { customerSchema, toCustomerRequest, type CustomerFormValues } from '@/features/customers/schemas';
import { useCreateCustomer, useCustomer, useUpdateCustomer } from '@/features/customers/hooks';
import { useBusinessId } from '@/features/workspaces/hooks';

const emptyValues = (lang: 'en' | 'te'): CustomerFormValues => ({
  name: '',
  phone: '',
  notes: '',
  preferred_language: lang,
});

interface FormProps {
  businessId: string;
  customerId: string | undefined;
  initial: CustomerFormValues;
}

function CustomerForm({ businessId, customerId, initial }: FormProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const create = useCreateCustomer(businessId);
  const update = useUpdateCustomer(businessId, customerId ?? '');
  const mutation = customerId ? update : create;
  const [similar, setSimilar] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CustomerFormValues>({ resolver: zodResolver(customerSchema), defaultValues: initial });

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'duplicate_customer_phone') {
      setError('phone', { message: 'err.duplicate_customer_phone' });
    }
  };

  const onSubmit = handleSubmit((values) => {
    const body = toCustomerRequest(values);
    if (customerId) {
      update.mutate(body, {
        onSuccess: () => navigate(`/customers/${customerId}`, { replace: true }),
        onError,
      });
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          if (created.similar_name_exists) {
            // Show the note once, then continue to the new customer.
            setSimilar(true);
            setTimeout(() => navigate(`/customers/${created.id}`, { replace: true }), 2500);
          } else {
            navigate(`/customers/${created.id}`, { replace: true });
          }
        },
        onError,
      });
    }
  });

  const phoneError =
    errors.phone?.message === 'err.duplicate_customer_phone'
      ? t('err.duplicate_customer_phone')
      : fieldMessage(t, errors.phone);

  return (
    <FocusPage
      title={customerId ? t('customers.edit') : t('customers.new')}
      backTo={customerId ? `/customers/${customerId}` : '/customers'}
      footer={
        <Button type="submit" form="customer-form" block loading={mutation.isPending || similar}>
          {customerId ? t('common.save') : t('customers.create')}
        </Button>
      }
    >
      <form id="customer-form" onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
        <TextField
          label={t('customers.name')}
          autoComplete="off"
          maxLength={120}
          error={fieldMessage(t, errors.name)}
          {...register('name')}
        />
        <TextField
          label={t('customers.phone')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          optionalLabel={t('common.optional')}
          hint={t('customers.phoneHint')}
          error={phoneError}
          {...register('phone')}
        />
        <TextAreaField
          label={t('customers.notes')}
          optionalLabel={t('common.optional')}
          hint={t('customers.notesHint')}
          maxLength={1000}
          error={fieldMessage(t, errors.notes)}
          {...register('notes')}
        />
        <SelectField label={t('customers.language')} {...register('preferred_language')}>
          <option value="en">{t('lang.en')}</option>
          <option value="te">{t('lang.te')}</option>
        </SelectField>

        {similar ? (
          <p role="status" className="rounded-control bg-ochre-soft px-3 py-2 text-ochre">
            {t('customers.similarName')}
          </p>
        ) : null}
        {mutation.isError && !(mutation.error instanceof ApiError && mutation.error.code === 'duplicate_customer_phone') ? (
          <p role="alert" className="text-sm font-medium text-stamp">
            {t(errorMessageKey(mutation.error))}
          </p>
        ) : null}
      </form>
    </FocusPage>
  );
}

/** One page for both creating and editing a customer. */
export function CustomerFormPage() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const businessId = useBusinessId();
  const query = useCustomer(businessId, id ?? '');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [id]);

  if (!id) {
    return <CustomerForm businessId={businessId} customerId={undefined} initial={emptyValues(lang)} />;
  }

  if (query.isPending) {
    return (
      <FocusPage title={t('customers.edit')} backTo={`/customers/${id}`}>
        <ListSkeleton rows={3} />
      </FocusPage>
    );
  }
  if (query.isError) {
    return (
      <FocusPage title={t('customers.edit')} backTo="/customers">
        <ErrorState error={query.error} title={t('customers.loadFailed')} onRetry={() => void query.refetch()} />
      </FocusPage>
    );
  }
  void ready;
  const c = query.data;
  return (
    <CustomerForm
      businessId={businessId}
      customerId={id}
      initial={{
        name: c.name,
        phone: c.phone ? formatPhone(c.phone) : '',
        notes: c.notes ?? '',
        preferred_language: c.preferred_language,
      }}
    />
  );
}
