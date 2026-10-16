import { createContext } from 'react';
import type { Language } from '@/types/api';
import { en, type MessageKey } from './en';
import { te } from './te';

export type TParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TParams) => string;

export interface I18nValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translate;
}

const catalogs: Record<Language, Partial<Record<MessageKey, string>>> = { en, te };

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Builds a translate function for a language. Missing Telugu keys fall back to English. */
export function makeTranslate(lang: Language): Translate {
  return (key, params) => {
    const useOne = params?.n === 1;
    const oneKey = `${key}.one` as MessageKey;
    const lookup = (k: MessageKey) => catalogs[lang][k] ?? en[k];
    const template = useOne && oneKey in en ? lookup(oneKey) : lookup(key);
    return interpolate(template, params);
  };
}

export const I18nContext = createContext<I18nValue>({
  lang: 'en',
  setLang: () => {},
  t: makeTranslate('en'),
});
