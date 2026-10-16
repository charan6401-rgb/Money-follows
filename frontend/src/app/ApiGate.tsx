import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { checkApiLive } from '@/lib/api';
import { useI18n } from '@/lib/i18n/useI18n';

const SLOW_AFTER_MS = 3_000;
const GIVE_UP_AFTER_MS = 60_000;
const POLL_EVERY_MS = 2_000;

type GateState = 'checking' | 'waking' | 'ready' | 'down';

/**
 * The free-tier API sleeps when idle. On boot we probe /health/live, say so honestly if it
 * is slow, and poll for up to 60 s before giving up (ARCHITECTURE section 9, PRODUCT_SPEC M-16).
 */
export function ApiGate({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<GateState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState('checking');

    const wakingTimer = setTimeout(() => {
      setState((s) => (s === 'checking' ? 'waking' : s));
    }, SLOW_AFTER_MS);

    const poll = async () => {
      const ok = await checkApiLive(baseUrl, controller.signal);
      if (controller.signal.aborted) return;
      if (ok) {
        setState('ready');
        return;
      }
      if (Date.now() - startedAt >= GIVE_UP_AFTER_MS) {
        setState('down');
        return;
      }
      timer = setTimeout(() => void poll(), POLL_EVERY_MS);
    };
    void poll();

    return () => {
      controller.abort();
      clearTimeout(wakingTimer);
      if (timer) clearTimeout(timer);
    };
  }, [baseUrl, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state === 'ready') return <>{children}</>;

  return (
    <main className="grid min-h-dvh place-items-center bg-cement-50 px-4 text-center">
      <div role="status" aria-live="polite" className="max-w-sm">
        {state === 'down' ? (
          <>
            <h1 className="font-serif text-2xl text-ink-900">{t('gate.down.title')}</h1>
            <p className="mt-2 text-ink-700">{t('gate.down.body')}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 min-h-touch rounded-control bg-ink-900 px-6 font-medium text-white"
            >
              {t('common.retry')}
            </button>
          </>
        ) : state === 'waking' ? (
          <>
            <h1 className="font-serif text-2xl text-ink-900">{t('gate.waking.title')}</h1>
            <p className="mt-2 text-ink-700">{t('gate.waking.body')}</p>
          </>
        ) : (
          <p className="text-ink-700">{t('gate.checking')}</p>
        )}
      </div>
    </main>
  );
}
