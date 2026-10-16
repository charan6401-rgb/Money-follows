import type { ReactNode } from 'react';
import { errorMessageKey, errorReference } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/** A column of placeholder cards while a list loads. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t('common.loading')} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
}

/** An empty screen points at the next step instead of just saying "nothing here". */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border border-dashed border-cement-300 bg-white px-5 py-10 text-center">
      <h2 className="font-serif text-xl text-ink-900">{title}</h2>
      {body ? <p className="mx-auto mt-2 max-w-sm text-ink-600">{body}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  /** Heading for the failed section, for example "We could not load invoices." */
  title: string;
  onRetry?: () => void;
}

/** The message comes from the stable error code, never the server's raw text. */
export function ErrorState({ error, title, onRetry }: ErrorStateProps) {
  const { t } = useI18n();
  const reference = errorReference(error);
  return (
    <div role="alert" className="rounded-card border border-stamp-ring bg-stamp-soft px-5 py-6">
      <h2 className="font-semibold text-stamp">{title}</h2>
      <p className="mt-1 text-ink-700">{t(errorMessageKey(error))}</p>
      {reference ? <p className="mt-1 text-sm text-ink-500">{t('err.reference', { id: reference })}</p> : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function FullScreenLoading() {
  const { t } = useI18n();
  return (
    <div role="status" className="grid min-h-dvh place-items-center bg-cement-50 text-ink-600">
      {t('common.loading')}
    </div>
  );
}
