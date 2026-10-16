import { useOnline } from '@/hooks/useOnline';
import { useI18n } from '@/lib/i18n/useI18n';

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div role="status" className="bg-ochre-soft px-4 py-2 text-sm font-medium text-ochre">
      {t('offline.banner')}
    </div>
  );
}
