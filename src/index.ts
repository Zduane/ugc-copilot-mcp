#!/usr/bin/env node
/**
 * UGC Copilot MCP server — stdio transport entrypoint.
 *
 * Wired into Claude Desktop / Cursor / Cline / Zed via:
 *   { "command": "npx", "args": ["-y", "@ugccopilot/mcp@latest"], "env": { "UGC_COPILOT_API_KEY": "ugc_live_..." } }
 *
 * Free tools (analyze_trends, generate_hooks, generate_persona_preview, generate_script_preview)
 * work without an API key. Authenticated tools require UGC_COPILOT_API_KEY.
 */

import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { checkForNewerVersion } from './versionCheck.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

async function main(): Promise<void> {
  // Fire-and-forget: never block server startup on network. The check writes a
  // hint to stderr if a newer version is on npm — visible in the host's MCP
  // log (~/Library/Logs/Claude/mcp-server-ugc-copilot.log) but invisible to
  // the agent (which only sees stdout per the MCP protocol).
  void checkForNewerVersion(pkg.version);

  // Always log the running version once at startup so users debugging an
  // issue can confirm which version is actually running (vs which version
  // they think is running per their config).
  process.stderr.write(`[ugc-copilot-mcp ${pkg.version}] starting (stdio)\n`);

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
