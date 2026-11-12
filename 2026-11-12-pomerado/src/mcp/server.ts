import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '../config.js';
import { listIntegrations, type Integration } from '../integration.js';
import { mint } from '../mint/index.js';
import { runIntegration, type RunResult } from '../runner.js';
import { callStats } from '../runlog.js';

const asContent = (result: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  structuredContent: result as Record<string, unknown>,
  ...(isError ? { isError: true } : {}),
});

function shapeFor(integ: Integration) {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(integ.inputSchema.required ?? []);
  for (const [k, p] of Object.entries(integ.inputSchema.properties)) {
    let s: z.ZodTypeAny = z.string().describe(p.description ?? k);
    if (!required.has(k)) s = s.optional();
    shape[k] = s;
  }
  if (integ.authority === 'write')
    shape.confirm = z.boolean().optional().describe('Must be true: this tool can change data on the website');
  return shape;
}

export function buildMcpServer(opts: { integrationsDir?: string } = {}) {
  const dir = opts.integrationsDir ?? getConfig().integrationsDir;
  const server = new McpServer({ name: 'minter', version: '0.1.0' });
  const registered = new Set<string>();

  async function runTool(integ: Integration | { name: string; authority: string }, args: Record<string, unknown>) {
    const { confirm, ...input } = args;
    if (integ.authority === 'write' && confirm !== true)
      return asContent({ ok: false, error: `"${integ.name}" has write authority: call again with confirm: true to proceed.` }, true);
    const r: RunResult = await runIntegration(integ.name, input, { integrationsDir: dir });
    return asContent(r, !r.ok);
  }

  function registerIntegration(integ: Integration) {
    if (registered.has(integ.name)) return;
    registered.add(integ.name);
    server.registerTool(
      integ.name,
      { title: integ.name, description: integ.description, inputSchema: z.object(shapeFor(integ)) },
      async (args) => runTool(integ, args as Record<string, unknown>),
    );
  }
  listIntegrations(dir).forEach(registerIntegration);

  server.registerTool(
    'build_website_tool',
    {
      title: 'Build website tool',
      description:
        'Turn a website task into a reusable deterministic tool. Opens a browser, completes the task once with the example input, ' +
        'generalises it into a parameterised integration and registers it as a new MCP tool.',
      inputSchema: z.object({
        name: z.string().describe('snake_case tool name, e.g. search_parts'),
        url: z.string().describe('Start URL'),
        task: z.string().describe('What the tool should do and return'),
        exampleInput: z.record(z.string(), z.string()).describe('Example values for the inputs, e.g. {"query":"bolt"}'),
        authority: z.enum(['read', 'write']).optional(),
      }),
    },
    async ({ name, url, task, exampleInput, authority }) => {
      try {
        const { integration, sample } = await mint({ name, url, task, exampleInput, authority, integrationsDir: dir });
        registerIntegration(integration);
        await server.sendToolListChanged();
        return asContent({
          ok: true,
          tool: { name: integration.name, version: integration.version, description: integration.description, inputSchema: integration.inputSchema, steps: integration.steps.length },
          firstResult: sample.results,
        });
      } catch (e) {
        return asContent({ ok: false, error: e instanceof Error ? e.message : String(e) }, true);
      }
    },
  );

  server.registerTool(
    'list_website_tools',
    { title: 'List website tools', description: 'List minted website tools with versions and call counts.', inputSchema: z.object({}) },
    async () =>
      asContent({
        tools: listIntegrations(dir).map((i) => ({
          name: i.name,
          description: i.description,
          version: i.version,
          authority: i.authority,
          ...callStats(i.name),
        })),
      }),
  );

  server.registerTool(
    'run_website_tool',
    {
      title: 'Run website tool',
      description: 'Run a minted website tool by name (for clients that cache the tool list).',
      inputSchema: z.object({ name: z.string(), input: z.record(z.string(), z.unknown()).default({}) }),
    },
    async ({ name, input }) => {
      try {
        const integ = listIntegrations(dir).find((i) => i.name === name);
        if (!integ) return asContent({ ok: false, error: `unknown tool: ${name}` }, true);
        return runTool(integ, input as Record<string, unknown>);
      } catch (e) {
        return asContent({ ok: false, error: e instanceof Error ? e.message : String(e) }, true);
      }
    },
  );

  return server;
}
