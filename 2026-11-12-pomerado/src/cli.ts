import { Command } from 'commander';
import { getConfig, isMockMode } from './config.js';
import { listIntegrations, loadIntegration } from './integration.js';
import { callStats } from './runlog.js';

const program = new Command().name('minter').description('Turn any website into an MCP tool (Pomerado learning clone)');

function parseJson(s: string, what: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch (e) {
    console.error(`invalid JSON for ${what}: ${(e as Error).message}`);
    process.exit(2);
  }
}

program
  .command('mint')
  .requiredOption('--name <name>', 'integration name, snake_case')
  .requiredOption('--url <url>', 'start URL')
  .requiredOption('--task <text>', 'what the tool should do')
  .option('--input <json>', 'example input as JSON', '{}')
  .option('--authority <a>', 'read | write', 'read')
  .option('--auth-url <url>', 'sign-in page URL')
  .option('--secret <name...>', 'secret name(s), e.g. USERNAME PASSWORD (values come from MINTER_SECRET_<NAME>_<SECRET> env vars)')
  .action(async (o) => {
    const { mint } = await import('./mint/index.js');
    const secrets: string[] = (o.secret ?? []).flatMap((s: string) => s.split(','));
    if (o.authUrl && !secrets.length) {
      console.error('--auth-url needs at least one --secret');
      process.exit(2);
    }
    const exampleInput = Object.fromEntries(Object.entries(parseJson(o.input, '--input')).map(([k, v]) => [k, String(v)]));
    try {
      const { integration, sample } = await mint({
        name: o.name,
        url: o.url,
        task: o.task,
        exampleInput,
        authority: o.authority,
        auth: o.authUrl ? { url: o.authUrl, secretNames: secrets } : undefined,
      });
      console.log(`Minted ${integration.name} v${integration.version} (${integration.steps.length} steps) -> integrations/${integration.name}/integration.json`);
      console.log('Sample output from the first run:');
      console.log(JSON.stringify(sample.results, null, 2));
    } catch (e) {
      console.error('mint failed:', e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });

program
  .command('run <name> [json]')
  .description('run an integration deterministically (no LLM)')
  .option('--no-heal', 'disable self-healing')
  .action(async (name: string, json: string | undefined, o) => {
    const { runIntegration } = await import('./runner.js');
    const r = await runIntegration(name, parseJson(json ?? '{}', 'input'), { heal: o.heal });
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
  });

program.command('list').action(() => {
  const all = listIntegrations();
  if (!all.length) return console.log('no integrations yet; try `npm run mint`');
  for (const i of all) {
    const s = callStats(i.name);
    console.log(`${i.name.padEnd(20)} v${i.version}  ${i.authority}  calls24h=${s.calls24h} last=${s.lastStatus}  ${i.url}`);
  }
});

program
  .command('heal <name>')
  .description('force a level-2 heal: re-mint from the stored task/example')
  .action(async (name: string) => {
    const { mint } = await import('./mint/index.js');
    const i = loadIntegration(name);
    try {
      const { integration, sample } = await mint({
        name: i.name, url: i.url, task: i.task, exampleInput: i.exampleInput, authority: i.authority,
        auth: i.auth ? { url: i.auth.url, secretNames: i.auth.secretNames } : undefined, previous: i, reason: 'heal:remint',
      });
      console.log(`Re-minted ${name} -> v${integration.version}`);
      console.log(JSON.stringify(sample.results, null, 2));
    } catch (e) {
      console.error('heal failed:', e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });

program.command('mcp').description('MCP server over stdio').action(async () => {
  const { startStdio } = await import('./mcp/stdio.js');
  await startStdio();
});

program
  .command('serve')
  .option('--port <n>', 'port', String(getConfig().port))
  .description('dashboard + Streamable HTTP MCP at /mcp')
  .action(async (o) => {
    const { startHttp } = await import('./mcp/http.js');
    console.error(isMockMode() ? '[minter] mock mode' : '[minter] real mode');
    await startHttp(Number(o.port));
  });

program
  .command('demo-site')
  .option('--port <n>', 'port', String(getConfig().demoPort))
  .action(async (o) => {
    const { startDemoSite } = await import('./demo-site/server.js');
    const h = await startDemoSite(Number(o.port));
    console.error(`[demo-site] http://localhost:${h.port}/ (version ${getConfig().demoVersion})`);
  });

await program.parseAsync(process.argv);
// one-shot commands exit when done; long-running ones (mcp, serve, demo-site) keep their handles
const cmd = process.argv[2];
if (['mint', 'run', 'list', 'heal'].includes(cmd)) process.exit(process.exitCode ?? 0);
