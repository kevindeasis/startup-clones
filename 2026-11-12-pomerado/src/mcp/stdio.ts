import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './server.js';

/** stdio MCP server. Never write to stdout except through the transport. */
export async function startStdio(): Promise<void> {
  console.log = (...a: unknown[]) => console.error(...a);
  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
  console.error('[minter] MCP stdio server ready');
}
