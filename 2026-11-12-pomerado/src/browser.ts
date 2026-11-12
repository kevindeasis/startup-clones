import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { getConfig } from './config.js';
import type { Target } from './integration.js';
import {
  BUILD_SELECTOR_FN,
  EXTRACT_LIST_FN,
  EXTRACT_TABLE_FN,
  SNAPSHOT_JS,
} from './page-scripts.js';

/** Build a real function from page-script source (avoids tsx/esbuild helper injection). */
const fn = <T = never>(src: string) => new Function('return ' + src)() as T;

export class TargetNotFound extends Error {
  constructor(public target: Target) {
    super(`target not found: ${target.selector}`);
    this.name = 'TargetNotFound';
  }
}

export async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const executablePath = getConfig().chromiumPath ?? '/opt/pw-browsers/chromium';
    try {
      return await chromium.launch({ headless: true, executablePath });
    } catch {
      throw err;
    }
  }
}

export class BrowserSession {
  private constructor(
    public browser: Browser,
    public context: BrowserContext,
    public page: Page,
  ) {}
  static async open(): Promise<BrowserSession> {
    const browser = await launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    return new BrowserSession(browser, context, page);
  }
  async close(): Promise<void> {
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}

export interface SnapEl {
  ref: string;
  kind: string;
  role: string;
  tag: string;
  name: string;
  selector: string;
  placeholder?: string;
  href?: string | null;
  inputType?: string;
  text?: string;
  options?: string[];
  headers?: string[];
  cols?: number;
  rows?: number;
  itemSelector?: string;
  itemCount?: number;
  formSelector?: string;
  submitsForm?: boolean;
}
export interface Snapshot {
  url: string;
  title: string;
  elements: SnapEl[];
  bodyText: string;
  text: string;
}

/** Compact text listing of the page for the (real or mock) explorer. */
export async function snapshot(page: Page): Promise<Snapshot> {
  await page.waitForLoadState('load').catch(() => {});
  const raw = (await page.evaluate(SNAPSHOT_JS)) as Omit<Snapshot, 'text'>;
  const elements: SnapEl[] = raw.elements.map((e, i) => ({ ...(e as SnapEl), ref: `e${i + 1}` }));
  const lines = [`url: ${raw.url}`, `title: ${raw.title}`];
  for (const e of elements) {
    if (e.kind === 'table')
      lines.push(`[${e.ref}] table ${e.cols} cols × ${e.rows} rows headers=[${(e.headers ?? []).join(', ')}] selector="${e.selector}"`);
    else if (e.kind === 'list')
      lines.push(`[${e.ref}] list ${e.itemCount} items item="${e.itemSelector}" selector="${e.selector}" sample="${e.text}"`);
    else if (e.role === 'link') lines.push(`[${e.ref}] link "${e.name}" href="${e.href}"`);
    else if (e.role === 'heading') lines.push(`[${e.ref}] heading "${e.name}"`);
    else {
      let l = `[${e.ref}] ${e.role} "${e.name}"`;
      if (e.placeholder) l += ` placeholder="${e.placeholder}"`;
      if (e.options) l += ` options=[${e.options.join(', ')}]`;
      lines.push(l + ` selector="${e.selector}"`);
    }
  }
  return { ...raw, elements, text: lines.join('\n') };
}

/** Convert a snapshot element to a Target (selector + hints). */
export function targetOf(e: SnapEl): Target {
  const hints: Target['hints'] = { tag: e.tag };
  if (e.role) hints.role = e.role;
  if (e.name) hints.name = e.name;
  if (e.placeholder) hints.placeholder = e.placeholder;
  if (e.kind === 'table') {
    if (e.text) hints.text = e.text;
  } else if (e.text && e.role !== 'link' && e.role !== 'button') hints.text = e.text;
  else if (e.text) hints.text = e.text;
  return { selector: e.selector, hints };
}

/** Rebuild a stable CSS selector for a located element. */
export async function selectorFor(locator: Locator): Promise<string> {
  return locator.evaluate(fn<(el: Element) => string>(BUILD_SELECTOR_FN));
}

/** Selector first; waits briefly for attachment, then throws TargetNotFound so the runner can heal. */
export async function locate(page: Page, target: Target, waitMs = 3000): Promise<Locator> {
  const loc = page.locator(target.selector);
  try {
    await loc.first().waitFor({ state: 'attached', timeout: waitMs });
  } catch {
    throw new TargetNotFound(target);
  }
  return loc.first();
}

export async function extractTable(locator: Locator): Promise<Record<string, string>[]> {
  return (await locator.evaluate(fn<(el: Element) => unknown>(EXTRACT_TABLE_FN))) as Record<string, string>[];
}

export async function extractList(
  locator: Locator,
  item: string,
  fields: Record<string, { selector: string; attr: string }>,
): Promise<Record<string, string>[]> {
  return (await locator.evaluate(fn<(el: Element, a: unknown) => unknown>(EXTRACT_LIST_FN), { item, fields })) as Record<string, string>[];
}

export async function extractText(locator: Locator): Promise<string> {
  return ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim();
}

export async function pageSummary(page: Page): Promise<string> {
  try {
    const t = await page.title();
    const body = ((await page.locator('body').innerText({ timeout: 1500 })) ?? '').replace(/\s+/g, ' ').slice(0, 200);
    return `url=${page.url()} title="${t}" body="${body}"`;
  } catch {
    return `url=${page.url()}`;
  }
}
