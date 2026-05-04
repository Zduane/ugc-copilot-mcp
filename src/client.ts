/**
 * UgcCopilotClient — typed fetch wrapper over the UGC Copilot REST API.
 *
 * Two distinct call patterns:
 *
 * 1. Authenticated (callApi): Bearer ugc_live_... + direct JSON body / direct JSON response.
 *    Used by all proxy* endpoints. Wraps the handler at functions/index.js:5682
 *    (createAIProxyFunction) which adapts req.body → handler(inputData) for API-key callers.
 *
 * 2. Public free (callPublic): no auth + { data: payload } body / { data: result } response.
 *    Used by free* endpoints (freeTrendAnalyzer, freeGenerateHooks, etc.). These mirror the
 *    legacy Firebase callable wire format.
 *
 * Errors are normalized into UgcMcpError with friendly messages.
 */

import { resolveApiKey } from './auth.js';
import { UgcMcpError, type BackendErrorBody } from './errors.js';

export const DEFAULT_BASE_URL = 'https://us-central1-viral-ugc-copilot.cloudfunctions.net';
const DEFAULT_TIMEOUT_MS = 300_000;
const TRANSIENT_RETRIES = 1;
const TRANSIENT_BACKOFF_MS = 2_000;
/**
 * Cap retry-after sleep at 5s. Free-tool daily limits return retryAfter in tens of
 * thousands of seconds (until-midnight). Sleeping that long would hold the MCP tool
 * call open until the runtime kills it (~60s) — the agent then sees a generic
 * "tool timed out" instead of the friendly "rate limit hit, daily quota exhausted"
 * message. Throw immediately when the server asks us to wait longer than this.
 */
const MAX_RETRY_SLEEP_MS = 5_000;

export interface ClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface CallOptions {
  idempotencyKey?: string;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const generateUuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export class UgcCopilotClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Authenticated call — direct JSON body, Bearer auth, direct JSON response.
   * Used for all `proxy*` endpoints.
   */
  async callApi<T>(
    endpoint: string,
    body: Record<string, unknown> = {},
    options: CallOptions = {},
    mutating = true,
  ): Promise<T> {
    const apiKey = resolveApiKey();
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    if (mutating) {
      headers['Idempotency-Key'] = options.idempotencyKey ?? generateUuid();
    } else if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    return this.requestWithRetry<T>(endpoint, headers, JSON.stringify(body), options, false);
  }

  /**
   * Public free call — { data: payload } body, no auth, { data: result } response.
   * Used for `free*` endpoints.
   */
  async callPublic<T>(
    endpoint: string,
    payload: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    return this.requestWithRetry<T>(
      endpoint,
      headers,
      JSON.stringify({ data: payload }),
      options,
      true,
    );
  }

  private async requestWithRetry<T>(
    endpoint: string,
    headers: Record<string, string>,
    body: string,
    options: CallOptions,
    unwrapDataEnvelope: boolean,
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxAttempts = TRANSIENT_RETRIES + 1;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await this.fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (resp.ok) {
          if (resp.status === 204) return undefined as T;
          const json = (await resp.json()) as unknown;
          if (unwrapDataEnvelope && json && typeof json === 'object' && 'data' in json) {
            return (json as { data: T }).data;
          }
          return json as T;
        }

        const errBody = (await resp.json().catch(() => ({}))) as BackendErrorBody;
        const err = new UgcMcpError(resp.status, errBody);
        if (err.isTransient() && attempt < maxAttempts) {
          const requestedSleepMs = err.retryAfter ? err.retryAfter * 1000 : TRANSIENT_BACKOFF_MS;
          if (requestedSleepMs > MAX_RETRY_SLEEP_MS) {
            // Server wants us to wait longer than the MCP tool window allows.
            // Surface the friendly error immediately rather than hang.
            throw err;
          }
          await sleep(requestedSleepMs);
          continue;
        }
        throw err;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        // The try block owns retry decisions for UgcMcpError (it sees the
        // retryAfter, isTransient, and the new max-sleep cap). Don't
        // re-route here — that would silently defeat the cap.
        if (e instanceof UgcMcpError) throw e;
        if (attempt >= maxAttempts) throw e;
        // Network error or AbortError — backoff and retry once.
        await sleep(TRANSIENT_BACKOFF_MS);
      }
    }

    throw lastErr ?? new Error('Request failed');
  }
}
