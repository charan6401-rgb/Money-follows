import type { AgingBucket, AgingBucketKey } from '@/types/api';
import type { MessageKey } from '@/lib/i18n/en';
import { useI18n } from '@/lib/i18n/useI18n';
import { Money } from '@/components/ui/Money';

const bucketColour: Record<AgingBucketKey, string> = {
  current: 'bg-aging-current',
  '1-30': 'bg-aging-d30',
  '31-60': 'bg-aging-d60',
  '61-90': 'bg-aging-d90',
  '90+': 'bg-aging-d90plus',
};

const bucketLabel: Record<AgingBucketKey, MessageKey> = {
  current: 'dash.bucket.current',
  '1-30': 'dash.bucket.1-30',
  '31-60': 'dash.bucket.31-60',
  '61-90': 'dash.bucket.61-90',
  '90+': 'dash.bucket.90+',
};

const ORDER: AgingBucketKey[] = ['current', '1-30', '31-60', '61-90', '90+'];

/**
 * The ledger strip: one bar from calm blue-grey (not yet due) to deep red (90+ days late),
 * with the same numbers written out as rows so colour is never the only signal.
 */
export function AgingStrip({ buckets }: { buckets: AgingBucket[] }) {
  const { t } = useI18n();
  const byKey = new Map(buckets.map((b) => [b.bucket, b]));
  const rows = ORDER.map((key) => ({
    key,
    invoiceCount: byKey.get(key)?.invoice_count ?? 0,
    paise: byKey.get(key)?.outstanding_paise ?? 0,
  }));
  const total = rows.reduce((sum, r) => sum + r.paise, 0);

  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-cement-200" aria-hidden="true">
        {total > 0
          ? rows
              .filter((r) => r.paise > 0)
              .map((r) => (
                <div
                  key={r.key}
                  className={bucketColour[r.key]}
                  style={{ width: `${Math.max((r.paise / total) * 100, 2)}%` }}
                />
              ))
          : null}
      </div>
      <ul className="mt-4 divide-y divide-cement-200">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-2.5">
            <span className={`h-3 w-3 shrink-0 rounded-sm ${bucketColour[r.key]}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-ink-900">{t(bucketLabel[r.key])}</span>
              <span className="block text-sm text-ink-500">
                {t('dash.invoiceCount', { n: r.invoiceCount })}
              </span>
            </span>
            <Money paise={r.paise} className="text-lg text-ink-900" />
          </li>
        ))}
      </ul>
    </div>
  );
}
