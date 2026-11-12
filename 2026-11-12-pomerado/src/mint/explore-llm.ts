import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, hasToolCall, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { BrowserSession, extractList, extractTable, snapshot, targetOf, type Snapshot } from '../browser.js';
import { getConfig } from '../config.js';
import { secretEnvName } from '../template.js';
import type { ExploreInput, RecordedAction, Recording } from './types.js';

/** Real-mode explorer: an AI SDK tool loop over a real browser records one example run. */
export async function exploreLlm(inp: ExploreInput): Promise<Recording> {
  const cfg = getConfig();
  const anthropic = createAnthropic({ apiKey: cfg.apiKey });
  const session = await BrowserSession.open();
  const { page } = session;
  const actions: RecordedAction[] = [];
  let snap: Snapshot | null = null;
  let summary = '';
  let outputKey = 'rows';
  let auth: Recording['auth'];
  const secretFills: Array<{ target: ReturnType<typeof targetOf>; secret: string }> = [];

  const refresh = async () => (snap = await snapshot(page));
  const el = (ref: string) => {
    const e = snap?.elements.find((x) => x.ref === ref);
    if (!e) throw new Error(`unknown ref ${ref}; call snapshot() for current refs`);
    return e;
  };
  const before = () => snap?.text ?? '';
  const after = async () => {
    await page.waitForLoadState('load').catch(() => {});
    return (await refresh()).text;
  };

  const tools = {
    navigate: tool({
      description: 'Go to a URL and return a snapshot',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        actions.push({ type: 'goto', url, snapshotBefore: before() });
        await page.goto(url);
        return after();
      },
    }),
    snapshot: tool({
      description: 'Return the current page snapshot with element refs',
      inputSchema: z.object({}),
      execute: async () => (await refresh()).text,
    }),
    click: tool({
      description: 'Click an element by ref',
      inputSchema: z.object({ ref: z.string() }),
      execute: async ({ ref }) => {
        const e = el(ref);
        actions.push({ type: 'click', target: targetOf(e), snapshotBefore: before() });
        await page.click(e.selector);
        return after();
      },
    }),
    fill: tool({
      description: 'Type text into an input by ref. Use exactly the example input values.',
      inputSchema: z.object({ ref: z.string(), text: z.string() }),
      execute: async ({ ref, text }) => {
        const e = el(ref);
        const key = Object.entries(inp.exampleInput).find(([, v]) => v === text)?.[0];
        actions.push({ type: 'fill', target: targetOf(e), value: text, inputKey: key, label: e.name, snapshotBefore: before() });
        await page.fill(e.selector, text);
        return 'ok';
      },
    }),
    fill_secret: tool({
      description: 'Fill a sign-in field with a named secret (you never see the value)',
      inputSchema: z.object({ ref: z.string(), secret: z.string() }),
      execute: async ({ ref, secret }) => {
        const e = el(ref);
        const envName = secretEnvName(inp.name, secret);
        const v = process.env[envName];
        if (!v) throw new Error(`missing secret: ${envName}`);
        await page.fill(e.selector, v);
        secretFills.push({ target: targetOf(e), secret });
        return 'ok';
      },
    }),
    select: tool({
      description: 'Choose an option (by visible text) in a select by ref',
      inputSchema: z.object({ ref: z.string(), value: z.string() }),
      execute: async ({ ref, value }) => {
        const e = el(ref);
        const key = Object.entries(inp.exampleInput).find(([, v]) => v === value)?.[0];
        actions.push({ type: 'select', target: targetOf(e), value, inputKey: key, label: e.name, snapshotBefore: before() });
        await page.selectOption(e.selector, { label: value });
        return 'ok';
      },
    }),
    press: tool({
      description: 'Press a key while focused on an element',
      inputSchema: z.object({ ref: z.string(), key: z.string() }),
      execute: async ({ ref, key }) => {
        const e = el(ref);
        actions.push({ type: 'press', target: targetOf(e), key, snapshotBefore: before() });
        await page.press(e.selector, key);
        return after();
      },
    }),
    extract_table: tool({
      description: 'Extract a table by ref as rows (preferred for tabular data)',
      inputSchema: z.object({ ref: z.string() }),
      execute: async ({ ref }) => {
        const e = el(ref);
        const rows = await extractTable(page.locator(e.selector).first());
        actions.push({ type: 'extract', mode: 'table', target: targetOf(e), as: 'rows', snapshotBefore: before() });
        return JSON.stringify(rows.slice(0, 5)) + ` (${rows.length} rows)`;
      },
    }),
    extract_list: tool({
      description: 'Extract repeated items under a container ref. fields: name -> {selector (relative to item, "" for item), attr ("text" or attribute)}',
      inputSchema: z.object({
        ref: z.string(),
        itemSelector: z.string(),
        fields: z.record(z.string(), z.object({ selector: z.string(), attr: z.string() })),
      }),
      execute: async ({ ref, itemSelector, fields }) => {
        const e = el(ref);
        const items = await extractList(page.locator(e.selector).first(), itemSelector, fields);
        actions.push({ type: 'extract', mode: 'list', target: targetOf(e), item: itemSelector, fields, as: 'items', snapshotBefore: before() });
        return JSON.stringify(items.slice(0, 5)) + ` (${items.length} items)`;
      },
    }),
    finish: tool({
      description: 'Call when the requested data has been extracted',
      inputSchema: z.object({ summary: z.string(), outputKey: z.string() }),
      execute: async ({ summary: s, outputKey: k }) => {
        summary = s;
        outputKey = k;
        return 'done';
      },
    }),
  };

  try {
    const authNote = inp.auth
      ? `First sign in at ${inp.auth.url}: use fill_secret with the secret names ${inp.auth.secretNames.join(', ')} (in field order), then click the sign-in button.`
      : '';
    await generateText({
      model: anthropic(cfg.model),
      tools,
      stopWhen: [stepCountIs(25), hasToolCall('finish')],
      system:
        'You are completing ONE example of a task on a website so the steps can be recorded and generalised. ' +
        'Use exactly the example input values. Prefer tables/lists for extraction. Call finish when the data is visible and extracted. ' +
        'Never guess credentials; use fill_secret.',
      prompt: `Task: ${inp.task}\nStart URL: ${inp.url}\nExample input: ${JSON.stringify(inp.exampleInput)}\n${authNote}\nBegin with navigate.`,
    });
    if (secretFills.length && inp.auth) {
      // the sign-in clicks were recorded as normal actions; lift them into the auth block
      const clickIdx = actions.findIndex((a) => a.type === 'click');
      const submit = actions[clickIdx];
      if (submit?.target) {
        auth = {
          url: inp.auth.url,
          fields: secretFills,
          submit: submit.target,
          successCheck: { type: 'urlNotContains', value: new URL(inp.auth.url).pathname },
          secretNames: inp.auth.secretNames,
        };
        const keep = actions.slice(clickIdx + 1);
        actions.length = 0;
        actions.push({ type: 'goto', url: inp.url, snapshotBefore: '' }, ...keep.filter((a) => a.type !== 'goto'));
      }
    }
    if (!actions.some((a) => a.type === 'extract')) throw new Error('explorer finished without extracting any data');
    inp.log(`explorer finished: ${summary} (output=${outputKey}, ${actions.length} actions)`);
    return { startUrl: inp.url, actions, finalSnapshot: (snap as Snapshot | null)?.text ?? "", auth, summary };
  } finally {
    await session.close();
  }
}
