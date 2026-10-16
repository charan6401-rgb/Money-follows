import type { ApiErrorBody, ApiErrorCode, ApiErrorDetail } from '@/types/api';

/**
 * The single fetch wrapper for the Money Follows API (ARCHITECTURE.md section 9, API.md section 12).
 *
 * - Sends the Supabase access token as a Bearer token and the workspace ONLY in `X-Business-Id`.
 *   The header is a selector; the server re-checks membership and role on every request.
 * - GET: 15 s timeout, up to 2 retries with backoff on network errors, 502, 503 and 504.
 * - Mutations: 30 s timeout and never retried automatically. A caller may retry by hand and
 *   must reuse the same Idempotency-Key.
 * - `401 token_expired`: refresh the session once and replay (same Idempotency-Key).
 *   Any other 401 (or a second one) signs the user out.
 * - Tokens, bodies and customer data are never logged here.
 */

export const GET_TIMEOUT_MS = 15_000;
export const MUTATION_TIMEOUT_MS = 30_000;
const GET_RETRIES = 2;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | (string & {});
  readonly requestId: string | undefined;
  readonly details: ApiErrorDetail[];

  constructor(
    status: number,
    code: ApiErrorCode | (string & {}),
    requestId?: string,
    details: ApiErrorDetail[] = [],
  ) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** True when the request may or may not have been applied (a timeout or a dropped connection). */
  get outcomeUnknown(): boolean {
    return (
      this.code === 'network_error' ||
      this.code === 'timeout' ||
      this.status === 502 ||
      this.status === 504
    );
  }

  /** Returns the first server validation detail for a field, if any. */
  detailFor(field: string): ApiErrorDetail | undefined {
    return this.details.find((d) => d.field === field);
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  /** Refreshes the session and returns the new access token, or null if that failed. */
  refreshSession: () => Promise<string | null>;
  getBusinessId: () => string | null;
  onSessionExpired: () => void;
  onWorkspaceDenied: () => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  idempotencyKey?: string;
  /** Default true. False for /me, /businesses. */
  businessScoped?: boolean;
  signal?: AbortSignal;
}

export interface ApiClient {
  request<T>(options: RequestOptions): Promise<T>;
  get<T>(path: string, query?: Record<string, QueryValue>, opts?: Partial<RequestOptions>): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: Partial<RequestOptions>): Promise<T>;
  patch<T>(path: string, body: unknown, opts?: Partial<RequestOptions>): Promise<T>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function isRetryableForGet(error: ApiError): boolean {
  return (
    error.code === 'network_error' ||
    error.code === 'timeout' ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-Id') ?? undefined;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    const err = body.error;
    if (err && typeof err.code === 'string') {
      return new ApiError(response.status, err.code, err.request_id ?? requestId, err.details ?? []);
    }
  } catch {
    // Not JSON (for example a proxy error page). Fall through to a generic code.
  }
  const fallback: ApiErrorCode =
    response.status === 502 || response.status === 503 || response.status === 504
      ? 'service_unavailable'
      : 'internal_error';
  return new ApiError(response.status, fallback, requestId);
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = config.sleep ?? defaultSleep;

  async function sendOnce<T>(options: RequestOptions): Promise<T> {
    const method = options.method ?? 'GET';
    const scoped = options.businessScoped ?? true;
    const headers: Record<string, string> = { Accept: 'application/json' };

    const token = await config.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    if (scoped) {
      const businessId = config.getBusinessId();
      if (!businessId) throw new ApiError(0, 'no_workspace');
      headers['X-Business-Id'] = businessId;
    }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeoutMs = method === 'GET' ? GET_TIMEOUT_MS : MUTATION_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const url = `${config.baseUrl}/api/v1${options.path}${buildQuery(options.query)}`;
      const response = await doFetch(url, { method, headers, body, signal: controller.signal });
      if (!response.ok) throw await toApiError(response);
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) throw new ApiError(0, 'timeout');
      if (options.signal?.aborted) throw error; // cancelled by the caller, not a failure
      throw new ApiError(0, 'network_error');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  async function request<T>(options: RequestOptions): Promise<T> {
    const isRead = (options.method ?? 'GET') === 'GET';
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      try {
        return await sendOnce<T>(options);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;

        if (error.status === 401) {
          if (error.code === 'token_expired' && !refreshed) {
            refreshed = true;
            const fresh = await config.refreshSession();
            if (fresh) continue; // replay once with the same Idempotency-Key
          }
          config.onSessionExpired();
          throw error;
        }

        if (error.status === 403 && error.code === 'workspace_access_denied') {
          config.onWorkspaceDenied();
          throw error;
        }

        if (isRead && attempt < GET_RETRIES && isRetryableForGet(error)) {
          await sleep(400 * 2 ** attempt);
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return {
    request,
    get: (path, query, opts) => request({ ...opts, method: 'GET', path, query }),
    post: (path, body, opts) => request({ ...opts, method: 'POST', path, body: body ?? {} }),
    patch: (path, body, opts) => request({ ...opts, method: 'PATCH', path, body }),
  };
}

/** Liveness probe used on boot to show the cold-start state (unversioned, no auth). */
export async function checkApiLive(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/health/live`, { signal, cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}
