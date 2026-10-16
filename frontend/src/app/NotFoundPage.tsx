import { useI18n } from '@/lib/i18n/useI18n';
import { LinkButton } from '@/components/ui/Button';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-4 text-center">
      <div>
        <h1 className="font-serif text-2xl text-ink-900">{t('notFound.title')}</h1>
        <p className="mt-2 text-ink-600">{t('notFound.body')}</p>
        <LinkButton to="/" className="mt-6">
          {t('notFound.home')}
        </LinkButton>
      </div>
    </main>
  );
}
