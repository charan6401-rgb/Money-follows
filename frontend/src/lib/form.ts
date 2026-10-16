import type { MessageKey } from '@/lib/i18n/en';
import type { Translate } from '@/lib/i18n/context';
import { en } from '@/lib/i18n/en';

/** Zod schemas carry translation keys as their messages; this turns one into text. */
export function fieldMessage(t: Translate, error: { message?: string | undefined } | undefined): string | undefined {
  const message = error?.message;
  if (!message) return undefined;
  return message in en ? t(message as MessageKey) : t('form.required');
}
