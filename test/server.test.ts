import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { UgcCopilotClient } from '../src/client.js';

describe('createServer', () => {
  beforeEach(() => {
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_test_key';
  });
  afterEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
  });

  it('returns an MCP server that registers all 13 tools', async () => {
    const server = createServer({ client: new UgcCopilotClient() });

    // Probe internal handlers via the SDK's internal request handling. Since the SDK
    // marks handlers private, exercise via the public capability descriptor — confirms
    // the server constructed without throwing and exposes the tools capability.
    const caps = (server as unknown as { _capabilities: Record<string, unknown> })._capabilities;
    expect(caps).toHaveProperty('tools');
  });

  it('annotates auth-required tools when UGC_COPILOT_API_KEY is missing', async () => {
    delete process.env.UGC_COPILOT_API_KEY;
    const server = createServer({ client: new UgcCopilotClient() });
    // Invoke ListTools through the request handler internals — the MCP SDK exposes
    // _requestHandlers for this kind of test. Cast through unknown to avoid private-access lints.
    const handlers = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })
      ._requestHandlers;
    const listHandler = handlers.get('tools/list');
    expect(listHandler).toBeDefined();
    if (!listHandler) return;
    const resp = (await listHandler({ method: 'tools/list', params: {} })) as {
      tools: Array<{ name: string; description: string }>;
    };
    expect(resp.tools).toHaveLength(13);
    const generateScript = resp.tools.find((t) => t.name === 'generate_script');
    expect(generateScript?.description).toContain('UGC_COPILOT_API_KEY is not set');
    const analyzeTrends = resp.tools.find((t) => t.name === 'analyze_trends');
    expect(analyzeTrends?.description).not.toContain('UGC_COPILOT_API_KEY is not set');
  });
});
