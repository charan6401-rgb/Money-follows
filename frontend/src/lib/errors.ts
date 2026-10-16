import { ApiError } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n/en';
import { en } from '@/lib/i18n/en';

/**
 * Maps an error to a translated message. The server's raw `message` is never shown
 * (API.md section 12); the stable `code` picks the text.
 */
export function errorMessageKey(error: unknown): MessageKey {
  if (error instanceof ApiError) {
    const key = `err.${error.code}` as MessageKey;
    if (key in en) return key;
  }
  return 'err.unknown';
}

/** The support reference from the server, if there is one. */
export function errorReference(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}
