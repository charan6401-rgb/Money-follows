import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language } from '@/types/api';
import { I18nContext, makeTranslate } from './context';

const STORAGE_KEY = 'mf.lang';

function readStoredLang(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'te') return stored;
  } catch {
    // Storage can be blocked (private mode). English is the safe default.
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(readStoredLang);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is acceptable; the choice still applies for this session.
    }
  }, []);

  // The document language selects the right fonts and tells screen readers how to speak.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t: makeTranslate(lang) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
