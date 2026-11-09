import type { Page, Locator } from 'playwright';
import type { Action } from './actions';

const ACTION_TIMEOUT = 10_000;

async function firstMatch(candidates: Locator[]): Promise<Locator | null> {
  for (const c of candidates) {
    try {
      if ((await c.count()) > 0) return c.first();
    } catch {
      /* try next */
    }
  }
  return null;
}

function need(v: string | undefined, name: string): string {
  if (!v) throw new Error(`action is missing required field "${name}"`);
  return v;
}

export async function resolveClickTarget(page: Page, target: string) {
  return firstMatch([
    page.getByRole('button', { name: target, exact: false }),
    page.getByRole('link', { name: target, exact: false }),
    page.getByRole('checkbox', { name: target, exact: false }),
    page.getByText(target, { exact: false }),
    page.getByLabel(target, { exact: false }),
    page.getByPlaceholder(target, { exact: false }),
  ]);
}

export async function resolveFillTarget(page: Page, target: string) {
  return firstMatch([
    page.getByLabel(target, { exact: false }),
    page.getByPlaceholder(target, { exact: false }),
    page.getByRole('textbox', { name: target, exact: false }),
    page.locator(`[name="${target.replace(/"/g, '\\"')}"]`),
  ]);
}

/** Execute one action. Throws on failure. `done`/`fail` are handled by the runner. */
export async function executeAction(page: Page, action: Action): Promise<void> {
  switch (action.type) {
    case 'goto':
      await page.goto(need(action.url, 'url'), { timeout: ACTION_TIMEOUT * 2, waitUntil: 'domcontentloaded' });
      break;
    case 'click': {
      const t = need(action.target, 'target');
      const loc = await resolveClickTarget(page, t);
      if (!loc) throw new Error(`could not find clickable element "${t}"`);
      await loc.click({ timeout: ACTION_TIMEOUT });
      break;
    }
    case 'fill': {
      const t = need(action.target, 'target');
      const loc = await resolveFillTarget(page, t);
      if (!loc) throw new Error(`could not find input "${t}"`);
      await loc.fill(action.value ?? '', { timeout: ACTION_TIMEOUT });
      break;
    }
    case 'press':
      await page.keyboard.press(need(action.key, 'key'));
      break;
    case 'select': {
      const t = need(action.target, 'target');
      const loc = await firstMatch([
        page.getByLabel(t, { exact: false }),
        page.getByRole('combobox', { name: t, exact: false }),
        page.locator(`select[name="${t}"]`),
      ]);
      if (!loc) throw new Error(`could not find select "${t}"`);
      const v = action.value ?? '';
      try {
        await loc.selectOption({ label: v }, { timeout: ACTION_TIMEOUT });
      } catch {
        await loc.selectOption({ value: v }, { timeout: ACTION_TIMEOUT });
      }
      break;
    }
    case 'scroll':
      await page.mouse.wheel(0, action.direction === 'up' ? -600 : 600);
      break;
    case 'wait':
      await page.waitForTimeout(Math.min(5000, Math.max(0, action.ms ?? 1000)));
      break;
    case 'assert_text': {
      const text = need(action.text, 'text');
      await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
        throw new Error(`text "${text}" is not visible on the page`);
      });
      break;
    }
    case 'assert_url_contains': {
      const frag = need(action.fragment, 'fragment');
      if (!page.url().includes(frag)) throw new Error(`url ${page.url()} does not contain "${frag}"`);
      break;
    }
    case 'done':
    case 'fail':
      break;
  }
}

export async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
}
