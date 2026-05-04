/**
 * Maps backend error responses to MCP-friendly tool result text.
 *
 * The UGC Copilot REST API returns: { error: { type, code, message, request_id, retryAfter? } }
 * for API-key callers, and { error: { code, message, details? } } for the legacy callable
 * envelope used by free public endpoints.
 *
 * MCP tool results are plain strings (or rich content arrays). We surface a single
 * actionable message rather than the raw JSON, so the calling agent can recover.
 */

export const PRICING_PACKS_URL = 'https://ugccopilot.ai/pricing/#packs';

export interface BackendErrorBody {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    request_id?: string | null;
    retryAfter?: number;
    details?: unknown;
    field?: string;
  };
}

export class UgcMcpError extends Error {
  override readonly name = 'UgcMcpError';
  readonly status: number;
  readonly code: string;
  readonly type: string;
  readonly retryAfter: number | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(status: number, body: BackendErrorBody) {
    const err = body?.error ?? {};
    const message = friendlyMessage(status, err);
    super(message);
    this.status = status;
    this.code = err.code ?? 'unknown';
    this.type = err.type ?? 'internal';
    this.retryAfter = err.retryAfter;
    this.requestId = err.request_id ?? undefined;
    this.details = err.details;
  }

  isTransient(): boolean {
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

function friendlyMessage(status: number, err: NonNullable<BackendErrorBody['error']>): string {
  const base = err.message ?? 'Request failed';
  if (status === 402 || err.code === 'insufficient-credits') {
    return `${base} You can buy a credit pack at ${PRICING_PACKS_URL}.`;
  }
  if (status === 429 || err.code === 'resource-exhausted') {
    const retryHint = err.retryAfter ? ` Retry after ~${err.retryAfter}s.` : '';
    // Free endpoints throw HttpsError("resource-exhausted", ...) which serializes
    // without an err.type field — branch on either signal so the API-key upsell
    // hint fires on free-tool 429s, where it's most useful.
    const isRateLimited = err.type === 'rate_limit' || err.code === 'resource-exhausted';
    const tierHint =
      isRateLimited && !process.env.UGC_COPILOT_API_KEY
        ? ' Free tools are limited to 3-5 calls/day per IP — set UGC_COPILOT_API_KEY for higher-volume authenticated tools.'
        : '';
    return `${base}${retryHint}${tierHint}`;
  }
  if (err.code === 'concurrency-exceeded') {
    return `${base} Wait for an in-flight render to complete, then retry.`;
  }
  if (err.code === 'idempotency-conflict') {
    return `${base} The same Idempotency-Key was used with a different payload — retry without the key, or use a fresh one.`;
  }
  if (status === 401 || err.code === 'unauthenticated') {
    return `${base} Check that UGC_COPILOT_API_KEY is set correctly (prefix 'ugc_live_'). Manage keys at https://ugccopilot.ai/profile/#api-keys.`;
  }
  if (status === 400 && err.field) {
    return `${base} (field: ${err.field})`;
  }
  return base;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function toolText(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function toolJson(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}
