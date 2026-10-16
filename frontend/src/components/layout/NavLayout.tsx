import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/useI18n';
import type { MessageKey } from '@/lib/i18n/en';
import { useCurrentWorkspace } from '@/features/workspaces/hooks';
import { cn } from '@/lib/cn';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { CustomersIcon, HomeIcon, InvoiceIcon, MoreIcon } from '@/components/layout/icons';

interface Item {
  to: string;
  label: MessageKey;
  icon: ReactNode;
  end?: boolean;
}

const items: Item[] = [
  { to: '/', label: 'nav.home', icon: <HomeIcon />, end: true },
  { to: '/invoices', label: 'nav.invoices', icon: <InvoiceIcon /> },
  { to: '/customers', label: 'nav.customers', icon: <CustomersIcon /> },
  { to: '/more', label: 'nav.more', icon: <MoreIcon /> },
];

/**
 * Phones (below 1024 px): content with a bottom tab bar in thumb reach.
 * Desktop (1024 px and up): the same four destinations as a left rail.
 */
export function NavLayout() {
  const { t } = useI18n();
  const workspace = useCurrentWorkspace();

  return (
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-white focus:px-3 focus:py-2"
      >
        {t('a11y.skip')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-cement-300 bg-white lg:flex">
        <div className="border-b border-cement-200 px-5 py-5">
          <p className="font-serif text-lg text-ink-900">{t('app.name')}</p>
          {workspace ? <p className="mt-0.5 truncate text-sm text-ink-500">{workspace.name}</p> : null}
        </div>
        <nav aria-label={t('nav.primary')} className="flex flex-col gap-1 p-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch items-center gap-3 rounded-control px-3 font-semibold',
                  isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-cement-100',
                )
              }
            >
              {item.icon}
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <OfflineBanner />

      <header className="border-b border-cement-200 bg-white px-4 py-3 lg:hidden">
        <p className="truncate font-serif text-base text-ink-900">{workspace?.name ?? t('app.name')}</p>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:px-6 lg:pb-10 lg:pt-8">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.primary')}
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 bg-white pb-[env(safe-area-inset-bottom)] shadow-bar lg:hidden"
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              cn(
                'flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 text-xs font-semibold',
                isActive ? 'text-ink-900' : 'text-ink-500',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid h-7 w-14 place-items-center rounded-full',
                    isActive && 'bg-cement-200',
                  )}
                >
                  {item.icon}
                </span>
                {t(item.label)}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
