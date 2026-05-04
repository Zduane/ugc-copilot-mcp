import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

import { UgcCopilotClient } from './client.js';
import { toolError, UgcMcpError } from './errors.js';
import { hasApiKey, MissingApiKeyError } from './auth.js';

import { analyzeTrends } from './tools/analyzeTrends.js';
import { generateHooks } from './tools/generateHooks.js';
import { generatePersonaPreview } from './tools/generatePersonaPreview.js';
import { generateScriptPreview } from './tools/generateScriptPreview.js';
import { analyzeMarket } from './tools/analyzeMarket.js';
import { generateScript } from './tools/generateScript.js';
import { generateImage } from './tools/generateImage.js';
import { renderVideo } from './tools/renderVideo.js';
import { checkVideoStatus } from './tools/checkVideoStatus.js';
import { waitForVideo } from './tools/waitForVideo.js';
import { fetchVideo } from './tools/fetchVideo.js';
import { applyTextOverlay } from './tools/applyTextOverlay.js';
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
  generateImage,
  renderVideo,
  checkVideoStatus,
  waitForVideo,
  fetchVideo,
  applyTextOverlay,
] as Array<ToolDefinition<unknown>>;

const ALL_TOOLS: Array<ToolDefinition<unknown>> = [...FREE_TOOLS, ...AUTH_TOOLS];

const AUTH_TOOL_NAMES = new Set(AUTH_TOOLS.map((t) => t.name));

export interface CreateServerOptions {
  client?: UgcCopilotClient;
}

export function createServer(options: CreateServerOptions = {}): Server {
  const client = options.client ?? new UgcCopilotClient();

  const server = new Server(
    {
      name: 'ugc-copilot',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const apiKeyPresent = hasApiKey();
    return {
      tools: ALL_TOOLS.map((tool) => {
        const requiresAuth = AUTH_TOOL_NAMES.has(tool.name);
        const description =
          requiresAuth && !apiKeyPresent
            ? `${tool.description}\n\nNOTE: UGC_COPILOT_API_KEY is not set in this MCP server's env. ` +
              `This tool will return an authentication error until you add the env var. ` +
              `Generate a key at https://ugccopilot.ai/profile/#api-keys.`
            : tool.description;
        return {
          name: tool.name,
          description,
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
      return (await tool.handler(parsedInput, client)) as never;
    } catch (err) {
      if (err instanceof MissingApiKeyError) return toolError(err.message) as never;
      if (err instanceof UgcMcpError) return toolError(err.message) as never;
      const message = err instanceof Error ? err.message : String(err);
      return toolError(`${name} failed: ${message}`) as never;
    }
  });

  return server;
}
