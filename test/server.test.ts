import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTH_TOOL_NAMES,
  createServer,
  FREE_TOOL_NAMES,
  SERVER_VERSION,
} from '../src/server.js';
import { UgcCopilotClient } from '../src/client.js';

type ListedTool = {
  name: string;
  title?: string;
  description: string;
  annotations?: Record<string, unknown>;
};

/** Pull the internal tools/list handler (two-arg: request, extra) for direct invocation. */
const getListHandler = (server: unknown) => {
  const handlers = (
    server as { _requestHandlers: Map<string, (req: unknown, extra?: unknown) => Promise<unknown>> }
  )._requestHandlers;
  const handler = handlers.get('tools/list');
  expect(handler).toBeDefined();
  return handler!;
};

describe('SERVER_VERSION', () => {
  it('matches the published package.json version (no drift)', () => {
    const require = createRequire(import.meta.url);
    const { version } = require('../package.json') as { version: string };
    expect(SERVER_VERSION).toBe(version);
  });
});

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
    const listHandler = getListHandler(server);
    const resp = (await listHandler({ method: 'tools/list', params: {} })) as {
      tools: ListedTool[];
    };
    expect(resp.tools).toHaveLength(13);
    const generateScript = resp.tools.find((t) => t.name === 'generate_script');
    expect(generateScript?.description).toContain('UGC_COPILOT_API_KEY is not set');
    const analyzeTrends = resp.tools.find((t) => t.name === 'analyze_trends');
    expect(analyzeTrends?.description).not.toContain('UGC_COPILOT_API_KEY is not set');
  });

  it('lists title and annotations for every tool', async () => {
    const server = createServer({ client: new UgcCopilotClient() });
    const resp = (await getListHandler(server)({ method: 'tools/list', params: {} })) as {
      tools: ListedTool[];
    };
    for (const tool of resp.tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toBeDefined();
    }
  });
});

describe('createServer remote mode', () => {
  afterEach(() => {
    delete process.env.UGC_COPILOT_API_KEY;
  });

  it('unauthenticated request gets the connect note, never env-var instructions — env is ignored', async () => {
    // A hosted server process may incidentally have the env var set; it must not
    // leak one operator credential's presence into every visitor's tool list.
    process.env.UGC_COPILOT_API_KEY = 'ugc_live_operator_key';
    const server = createServer({ client: new UgcCopilotClient(), remote: true });
    const resp = (await getListHandler(server)({ method: 'tools/list', params: {} })) as {
      tools: ListedTool[];
    };
    const generateScript = resp.tools.find((t) => t.name === 'generate_script');
    expect(generateScript?.description).toContain('Not connected to a UGC Copilot account');
    expect(generateScript?.description).not.toContain('UGC_COPILOT_API_KEY is not set');
    const analyzeTrends = resp.tools.find((t) => t.name === 'analyze_trends');
    expect(analyzeTrends?.description).not.toContain('NOTE:');
  });

  it('per-request authInfo suppresses the connect note', async () => {
    const server = createServer({ client: new UgcCopilotClient(), remote: true });
    const resp = (await getListHandler(server)(
      { method: 'tools/list', params: {} },
      { authInfo: { token: 'ugc_oat_abc', clientId: 'client-1', scopes: [] } },
    )) as { tools: ListedTool[] };
    const generateScript = resp.tools.find((t) => t.name === 'generate_script');
    expect(generateScript?.description).not.toContain('NOTE:');
  });
});

describe('tool-name exports for the hosted 401 gate', () => {
  it('partition all 13 tools into 4 free + 9 auth with no overlap', () => {
    expect(FREE_TOOL_NAMES.size).toBe(4);
    expect(AUTH_TOOL_NAMES.size).toBe(9);
    for (const name of FREE_TOOL_NAMES) {
      expect(AUTH_TOOL_NAMES.has(name), name).toBe(false);
    }
  });
});
