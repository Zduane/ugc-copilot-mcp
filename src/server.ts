import { createRequire } from 'node:module';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

import { UgcCopilotClient } from './client.js';
import { toolError, UgcMcpError } from './errors.js';
import { MissingApiKeyError } from './auth.js';

import { analyzeTrends } from './tools/analyzeTrends.js';
import { generateHooks } from './tools/generateHooks.js';
import { generatePersonaPreview } from './tools/generatePersonaPreview.js';
import { generateScriptPreview } from './tools/generateScriptPreview.js';
import { analyzeMarket } from './tools/analyzeMarket.js';
import { generateScript } from './tools/generateScript.js';
import { parseOwnScript } from './tools/parseOwnScript.js';
import { generateImage } from './tools/generateImage.js';
import { renderVideo } from './tools/renderVideo.js';
import { checkVideoStatus } from './tools/checkVideoStatus.js';
import { waitForVideo } from './tools/waitForVideo.js';
import { fetchVideo } from './tools/fetchVideo.js';
import { applyTextOverlay } from './tools/applyTextOverlay.js';
import { stitchVideos } from './tools/stitchVideos.js';
import type { ToolDefinition } from './tools/types.js';

const FREE_TOOLS: Array<ToolDefinition<unknown>> = [
  analyzeTrends,
  generateHooks,
  generatePersonaPreview,
  generateScriptPreview,
] as Array<ToolDefinition<unknown>>;

const AUTH_TOOLS: Array<ToolDefinition<unknown>> = [
  analyzeMarket,
  generateScript,
  parseOwnScript,
  generateImage,
  renderVideo,
  checkVideoStatus,
  waitForVideo,
  fetchVideo,
  applyTextOverlay,
  stitchVideos,
] as Array<ToolDefinition<unknown>>;

const ALL_TOOLS: Array<ToolDefinition<unknown>> = [...FREE_TOOLS, ...AUTH_TOOLS];

// Exported for the hosted (Streamable HTTP) server, which must decide BEFORE
// dispatch whether an unauthenticated tools/call should get an HTTP 401 with
// WWW-Authenticate (protected tools) or proceed (free tools).
export const AUTH_TOOL_NAMES: ReadonlySet<string> = new Set(AUTH_TOOLS.map((t) => t.name));
export const FREE_TOOL_NAMES: ReadonlySet<string> = new Set(FREE_TOOLS.map((t) => t.name));

// Single source of truth for the version we advertise to MCP clients: read it
// from package.json at runtime so it can never drift from the published npm
// version (this was previously hardcoded to '0.1.0' while the package shipped
// 0.1.12). `../package.json` resolves to the package root from both src/ (dev)
// and dist/ (published), since both live one level under the root.
const pkgRequire = createRequire(import.meta.url);
export const SERVER_VERSION = (
  pkgRequire('../package.json') as { version: string }
).version;

export interface CreateServerOptions {
  client?: UgcCopilotClient;
  /**
   * Hosted (Streamable HTTP) mode: auth comes from the per-request bearer
   * (surfaced as extra.authInfo by the transport), never from env vars, and
   * user-facing copy must not mention UGC_COPILOT_API_KEY env configuration.
   */
  remote?: boolean;
  /** Cap on intentional in-call waits (wait_for_video); threaded to tool handlers. */
  waitBudgetMs?: number;
}

export function createServer(options: CreateServerOptions = {}): Server {
  const client = options.client ?? new UgcCopilotClient();
  const toolCtx = { waitBudgetMs: options.waitBudgetMs };

  const server = new Server(
    {
      name: 'ugc-copilot',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    // Per-request auth (remote: the transport sets req.auth → extra.authInfo)
    // takes precedence; the env var only counts for the stdio process model.
    const authenticated =
      Boolean(extra?.authInfo?.token) || (!options.remote && client.hasCredentials());
    const unauthNote = options.remote
      ? `\n\nNOTE: Not connected to a UGC Copilot account yet. Calling this tool will prompt you ` +
        `to connect. Free tools work without connecting.`
      : `\n\nNOTE: UGC_COPILOT_API_KEY is not set in this MCP server's env. ` +
        `This tool will return an authentication error until you add the env var. ` +
        `Generate a key at https://ugccopilot.ai/profile/#api-keys.`;
    return {
      tools: ALL_TOOLS.map((tool) => {
        const requiresAuth = AUTH_TOOL_NAMES.has(tool.name);
        const description =
          requiresAuth && !authenticated ? `${tool.description}${unauthNote}` : tool.description;
        return {
          name: tool.name,
          title: tool.title,
          description,
          // Claude's directory review reads the display title from
          // ToolAnnotations.title; the top-level `title` alone leaves every tool
          // flagged "Missing annotations: title" in the submission review UI.
          annotations: { ...tool.annotations, title: tool.title },
          inputSchema: zodToJsonSchema(tool.inputSchema as z.ZodTypeAny, {
            target: 'jsonSchema7',
          }),
        };
      }),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (!tool) {
      return toolError(`Unknown tool: ${name}`) as never;
    }

    let parsedInput;
    try {
      parsedInput = tool.inputSchema.parse(rawArgs ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        return toolError(`Invalid arguments for ${name}: ${issues}`) as never;
      }
      return toolError(`Invalid arguments for ${name}: ${(err as Error).message}`) as never;
    }

    try {
      return (await tool.handler(parsedInput, client, toolCtx)) as never;
    } catch (err) {
      if (err instanceof MissingApiKeyError) return toolError(err.message) as never;
      if (err instanceof UgcMcpError) return toolError(err.message) as never;
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`${name} failed: ${message}`) as never;
    }
  });

  return server;
}
