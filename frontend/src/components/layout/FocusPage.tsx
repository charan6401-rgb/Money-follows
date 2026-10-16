import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/useI18n';
import { BackIcon } from '@/components/layout/icons';
import { OfflineBanner } from '@/components/layout/OfflineBanner';

interface FocusPageProps {
  title: string;
  /** Where Back goes when there is no history to return to. */
  backTo: string;
  children: ReactNode;
  /** A bar pinned to the bottom of the screen on phones (the main action). */
  footer?: ReactNode;
}

/**
 * A full-screen task page with no tab bar: forms, invoice detail and the payment flow.
 * On phones the main action sits in a sticky bar at the bottom; on desktop it flows with the form.
 */
export function FocusPage({ title, backTo, children, footer }: FocusPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const goBack = () => {
    // history.state.idx is 0 on a first page load, so there is nothing to go back to.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(backTo, { replace: true });
  };

  return (
    <div className="min-h-dvh bg-cement-100">
      <OfflineBanner />
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-cement-200 bg-white px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('common.back')}
          className="grid min-h-touch min-w-touch place-items-center rounded-control text-ink-900 hover:bg-cement-100"
        >
          <BackIcon />
        </button>
        <h1 className="truncate font-serif text-lg text-ink-900">{title}</h1>
        <Link to="/" className="sr-only focus:not-sr-only focus:ml-auto focus:px-3">
          {t('nav.home')}
        </Link>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-5 md:px-6 md:pb-10 md:pt-8">{children}</main>
      {footer ? (
        <div className="fixed inset-x-0 bottom-0 z-10 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-bar md:static md:bg-transparent md:px-0 md:pb-10 md:pt-0 md:shadow-none">
          <div className="mx-auto w-full max-w-2xl md:px-6">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}
