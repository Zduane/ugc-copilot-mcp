import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UgcCopilotClient } from '../src/client.js';
import { UgcMcpError } from '../src/errors.js';

describe('UgcCopilotClient', () => {
  beforeEach(() => {
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_test_key_123';
  });
  afterEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
    vi.restoreAllMocks();
  });

  it('callApi sends Bearer auth, Idempotency-Key, and direct JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ foo: 'bar' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await client.callApi<{ foo: string }>('proxyTest', { x: 1 });

    expect(result).toEqual({ foo: 'bar' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/proxyTest');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ugc_live_test_key_123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ x: 1 });
  });

  it('callApi unwraps non-data response (API key path returns direct JSON)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ operation: { name: 'op-1' } }), { status: 200 }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await client.callApi<{ operation: { name: string } }>('proxyStartVideoGeneration', {});
    expect(result.operation.name).toBe('op-1');
  });

  it('callPublic wraps payload as { data } and unwraps response { data }', async () => {
    delete process.env.UGC_COPILOT_API_KEY; // free tools work without
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { trends: [] } }), { status: 200 }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const result = await client.callPublic<{ trends: unknown[] }>('freeTrendAnalyzer', {
      industry: 'fitness',
    });

    expect(result).toEqual({ trends: [] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({ data: { industry: 'fitness' } });
  });

  it('maps 402 insufficient-credits to a friendly UgcMcpError with pricing URL', async () => {
    const errBody = {
      error: {
        type: 'permission',
        code: 'insufficient-credits',
        message: 'You do not have enough credits.',
        request_id: 'req-1',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errBody), { status: 402 }),
    );
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toMatchObject({
      status: 402,
      code: 'insufficient-credits',
      message: expect.stringContaining('https://ugccopilot.ai/pricing/#packs'),
    });
  });

  it('retries once on 5xx then surfaces error', async () => {
    const errBody = { error: { type: 'internal', code: 'internal', message: 'boom', request_id: 'r' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(errBody), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(errBody), { status: 500 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toBeInstanceOf(UgcMcpError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('does not retry on 400 validation errors', async () => {
    const errBody = {
      error: { type: 'validation', code: 'invalid-argument', message: 'bad input', request_id: 'r' },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(errBody), { status: 400 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toBeInstanceOf(UgcMcpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws MissingApiKeyError when callApi runs without the env var', async () => {
    delete process.env.UGC_COPILOT_API_KEY;
    const client = new UgcCopilotClient({ fetch: vi.fn() as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toMatchObject({
      message: expect.stringContaining('UGC_COPILOT_API_KEY'),
    });
  });

  it('rejects an API key that lacks the ugc_live_ prefix', async () => {
    process.env.UGC_COPILOT_API_KEY = 'sk_wrong_format';
    const client = new UgcCopilotClient({ fetch: vi.fn() as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toMatchObject({
      message: expect.stringContaining("'ugc_live_' prefix"),
    });
  });

  it('does NOT retry when 429 retryAfter exceeds the MCP tool window cap (5s)', async () => {
    // Free-tool daily limits return retryAfter measured in seconds-until-midnight.
    // Sleeping that long would hold the MCP tool open until the runtime kills it
    // with a generic timeout. Surface the friendly error immediately instead.
    const errBody = {
      error: {
        type: 'rate_limit',
        code: 'resource-exhausted',
        message: 'Daily limit reached.',
        request_id: 'r',
        retryAfter: 86_400, // tomorrow
      },
    };
    // mockImplementation gives a fresh Response per call so body isn't reused.
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(errBody), { status: 429 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    const start = Date.now();
    await expect(client.callApi('proxyAny', {})).rejects.toMatchObject({
      status: 429,
      code: 'resource-exhausted',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry
    expect(Date.now() - start).toBeLessThan(1000); // didn't sleep
  });

  it('still retries 429 when retryAfter is within cap', async () => {
    const errBody = {
      error: {
        type: 'rate_limit',
        code: 'resource-exhausted',
        message: 'Slow down.',
        request_id: 'r',
        retryAfter: 1, // 1s — within the 5s cap
      },
    };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(errBody), { status: 429 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toBeInstanceOf(UgcMcpError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('429 on an unauthenticated free call includes the upsell hint, even without err.type', async () => {
    // Free endpoints return code='resource-exhausted' WITHOUT err.type='rate_limit' —
    // verify the upsell hint still fires (regression test for errors.ts #14 fix).
    // The hint keys off the CALL being unauthenticated (callPublic), not env state —
    // transport-neutral for the hosted server.
    delete process.env.UGC_COPILOT_API_KEY;
    const errBody = {
      error: {
        code: 'resource-exhausted',
        message: 'Too many requests.',
      },
    };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(errBody), { status: 429 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await expect(client.callPublic('freeAny', {})).rejects.toMatchObject({
      message: expect.stringContaining('Free tools are limited'),
    });
  });

  it('429 on an authenticated call does NOT include the free-tier upsell hint', async () => {
    const errBody = {
      error: { type: 'rate_limit', code: 'rate-limited', message: 'Too many requests.', retryAfter: 99999 },
    };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(errBody), { status: 429 }));
    const client = new UgcCopilotClient({ fetch: fetchMock as unknown as typeof fetch });
    await expect(client.callApi('proxyAny', {})).rejects.toMatchObject({
      message: expect.not.stringContaining('Free tools are limited'),
    });
  });

  it('injected apiKey takes precedence over the env var (hosted per-request credential)', async () => {
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_env_key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new UgcCopilotClient({
      fetch: fetchMock as unknown as typeof fetch,
      apiKey: 'ugc_oat_injected_token',
    });
    await client.callApi('proxyTest', {});
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ugc_oat_injected_token');
  });

  it('injected apiKey works with no env var at all (no MissingApiKeyError)', async () => {
    delete process.env.UGC_COPILOT_API_KEY;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new UgcCopilotClient({
      fetch: fetchMock as unknown as typeof fetch,
      apiKey: 'ugc_oat_token_2',
    });
    await expect(client.callApi('proxyTest', {})).resolves.toEqual({ ok: true });
    expect(client.hasCredentials()).toBe(true);
  });

  it('extraHeaders are attached to callPublic but never to callApi', async () => {
    // Fresh Response per call — Response bodies are single-use.
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const client = new UgcCopilotClient({
      fetch: fetchMock as unknown as typeof fetch,
      apiKey: 'ugc_live_x',
      extraHeaders: { 'X-Ugc-Client-Ip': '203.0.113.9', 'X-Ugc-Proxy-Secret': 's3cr3t' },
    });
    await client.callPublic('freeTrendAnalyzer', {});
    const publicHeaders = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(publicHeaders['X-Ugc-Client-Ip']).toBe('203.0.113.9');
    expect(publicHeaders['X-Ugc-Proxy-Secret']).toBe('s3cr3t');

    await client.callApi('proxyTest', {});
    const apiHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(apiHeaders['X-Ugc-Client-Ip']).toBeUndefined();
    expect(apiHeaders['X-Ugc-Proxy-Secret']).toBeUndefined();
  });
});
