import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClientConfig } from './api';

const BASE = 'http://api.test';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function errorBody(code: string, extra: Record<string, unknown> = {}) {
  return { error: { code, message: 'x', request_id: 'req-1', ...extra } };
}

function setup(overrides: Partial<ApiClientConfig> = {}, fetchImpl?: typeof fetch) {
  const fetchMock = vi.fn(fetchImpl ?? (async () => json(200, { ok: true })));
  const config: ApiClientConfig = {
    baseUrl: BASE,
    getAccessToken: async () => 'token-1',
    refreshSession: async () => 'token-2',
    getBusinessId: () => 'biz-1',
    onSessionExpired: vi.fn(),
    onWorkspaceDenied: vi.fn(),
    fetchImpl: fetchMock as unknown as typeof fetch,
    sleep: async () => {},
    ...overrides,
  };
  return { client: createApiClient(config), fetchMock, config };
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as { headers: Record<string, string> }).headers;
}

describe('request headers', () => {
  it('sends the Bearer token and the workspace only as a header', async () => {
    const { client, fetchMock } = setup();
    await client.get('/invoices', { status: 'open', q: '' });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body?: unknown }];
    expect(url).toBe(`${BASE}/api/v1/invoices?status=open`);
    const headers = headersOf(fetchMock.mock.calls[0] as unknown[]);
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['X-Business-Id']).toBe('biz-1');
    expect(init.body).toBeUndefined();
  });

  it('never puts business, user or role fields in a request body', async () => {
    const { client, fetchMock } = setup();
    await client.post('/customers', { name: 'A' });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
    expect(init.body).toBe('{"name":"A"}');
  });

  it('omits X-Business-Id for workspace-independent endpoints', async () => {
    const { client, fetchMock } = setup({ getBusinessId: () => null });
    await client.get('/businesses', undefined, { businessScoped: false });
    expect(headersOf(fetchMock.mock.calls[0] as unknown[])['X-Business-Id']).toBeUndefined();
  });

  it('fails fast without a workspace instead of calling the API', async () => {
    const { client, fetchMock } = setup({ getBusinessId: () => null });
    await expect(client.get('/invoices')).rejects.toMatchObject({ code: 'no_workspace' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the Idempotency-Key on payments', async () => {
    const { client, fetchMock } = setup();
    await client.post('/invoices/i1/payments', { amount: '1.00' }, { idempotencyKey: 'key-abcdefghijklmnop' });
    expect(headersOf(fetchMock.mock.calls[0] as unknown[])['Idempotency-Key']).toBe('key-abcdefghijklmnop');
  });
});

describe('errors', () => {
  it('maps the standard envelope to an ApiError', async () => {
    const { client } = setup({}, async () =>
      json(422, errorBody('overpayment_rejected', { details: [{ field: 'amount', code: 'exceeds_outstanding' }] })),
    );
    const error = await client.post('/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('overpayment_rejected');
    expect(apiError.requestId).toBe('req-1');
    expect(apiError.detailFor('amount')?.code).toBe('exceeds_outstanding');
  });

  it('treats a non-JSON gateway error as service_unavailable', async () => {
    const { client } = setup({}, async () => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(client.post('/x', {})).rejects.toMatchObject({ code: 'service_unavailable', status: 502 });
  });

  it('reports a dropped connection as network_error with an unknown outcome', async () => {
    const { client } = setup({}, async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = (await client.post('/x', {}).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('network_error');
    expect(error.outcomeUnknown).toBe(true);
  });

  it('does not treat a lock timeout (503 busy_retry) as an unknown outcome', async () => {
    const { client } = setup({}, async () => json(503, errorBody('busy_retry')));
    const error = (await client.post('/x', {}).catch((e: unknown) => e)) as ApiError;
    expect(error.outcomeUnknown).toBe(false);
  });
});

describe('GET retries', () => {
  it('retries a GET up to two times on 503 and then succeeds', async () => {
    let calls = 0;
    const { client, fetchMock } = setup({}, async () => {
      calls += 1;
      return calls < 3 ? json(503, errorBody('service_unavailable')) : json(200, { items: [] });
    });
    await expect(client.get('/invoices')).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after two retries', async () => {
    const { client, fetchMock } = setup({}, async () => json(503, errorBody('service_unavailable')));
    await expect(client.get('/invoices')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a dropped GET connection', async () => {
    let calls = 0;
    const { client, fetchMock } = setup({}, async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return json(200, { ok: true });
    });
    await expect(client.get('/invoices')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors', async () => {
    const { client, fetchMock } = setup({}, async () => json(404, errorBody('resource_not_found')));
    await expect(client.get('/invoices/x')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('mutations are never retried automatically', () => {
  it.each([
    ['503', () => json(503, errorBody('service_unavailable'))],
    ['network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('POST after %s is attempted exactly once', async (_label, respond) => {
    const { client, fetchMock } = setup({}, (async () => respond()) as unknown as typeof fetch);
    await expect(client.post('/invoices/i1/payments', { amount: '1.00' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('401 handling', () => {
  it('refreshes once on token_expired and replays with the same Idempotency-Key', async () => {
    let token = 'old';
    let calls = 0;
    const { client, fetchMock, config } = setup(
      {
        getAccessToken: async () => token,
        refreshSession: async () => {
          token = 'new';
          return token;
        },
      },
      async () => {
        calls += 1;
        return calls === 1 ? json(401, errorBody('token_expired')) : json(201, { id: 'p1' });
      },
    );
    await expect(
      client.post('/invoices/i1/payments', { amount: '1.00' }, { idempotencyKey: 'key-abcdefghijklmnop' }),
    ).resolves.toEqual({ id: 'p1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headersOf(fetchMock.mock.calls[0] as unknown[]).Authorization).toBe('Bearer old');
    expect(headersOf(fetchMock.mock.calls[1] as unknown[]).Authorization).toBe('Bearer new');
    expect(headersOf(fetchMock.mock.calls[1] as unknown[])['Idempotency-Key']).toBe('key-abcdefghijklmnop');
    expect(config.onSessionExpired).not.toHaveBeenCalled();
  });

  it('signs out when the second attempt is also a 401', async () => {
    const { client, fetchMock, config } = setup({}, async () => json(401, errorBody('token_expired')));
    await expect(client.get('/invoices')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(config.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('signs out when the refresh itself fails', async () => {
    const { client, fetchMock, config } = setup(
      { refreshSession: async () => null },
      async () => json(401, errorBody('token_expired')),
    );
    await expect(client.get('/invoices')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(config.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('signs out at once on a plain unauthenticated 401, without refreshing', async () => {
    const refreshSession = vi.fn(async () => 'x');
    const { client, config } = setup({ refreshSession }, async () => json(401, errorBody('unauthenticated')));
    await expect(client.get('/invoices')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(refreshSession).not.toHaveBeenCalled();
    expect(config.onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('workspace access', () => {
  it('tells the app to leave the workspace on workspace_access_denied', async () => {
    const { client, config } = setup({}, async () => json(403, errorBody('workspace_access_denied')));
    await expect(client.get('/invoices')).rejects.toMatchObject({ status: 403 });
    expect(config.onWorkspaceDenied).toHaveBeenCalledTimes(1);
  });

  it('does not leave the workspace for a role error', async () => {
    const { client, config } = setup({}, async () => json(403, errorBody('forbidden_role')));
    await expect(client.post('/payments/p1/reverse', { reason: 'abc' })).rejects.toMatchObject({
      code: 'forbidden_role',
    });
    expect(config.onWorkspaceDenied).not.toHaveBeenCalled();
  });
});

describe('timeouts', () => {
  it('reports a timeout when the server never answers', async () => {
    vi.useFakeTimers();
    try {
      const { client } = setup({}, (_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      });
      const pending = client.post('/invoices/i1/payments', { amount: '1.00' }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30_001);
      const error = (await pending) as ApiError;
      expect(error.code).toBe('timeout');
      expect(error.outcomeUnknown).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
