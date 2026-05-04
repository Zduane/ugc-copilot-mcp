#!/usr/bin/env node
/**
 * UGC Copilot MCP server — stdio transport entrypoint.
 *
 * Wired into Claude Desktop / Cursor / Cline / Zed via:
 *   { "command": "npx", "args": ["-y", "@ugccopilot/mcp"], "env": { "UGC_COPILOT_API_KEY": "ugc_live_..." } }
 *
 * Free tools (analyze_trends, generate_hooks, generate_persona_preview, generate_script_preview)
 * work without an API key. Authenticated tools require UGC_COPILOT_API_KEY.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio is now bidirectional; the transport keeps the process alive.
}

main().catch((err) => {
  // stderr goes to the host's logs, not to the agent. Stdout is reserved for MCP.
  // eslint-disable-next-line no-console
  console.error('[ugc-copilot-mcp] fatal:', err);
  process.exit(1);
});
