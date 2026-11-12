import type { Locator, Page } from 'playwright';
import { selectorFor } from './browser.js';
import type { Target } from './integration.js';

/**
 * Level-1 healing: re-locate an element from its stored semantic hints.
 * Returns a freshly built CSS selector, or null if no unique match was found.
 */
export async function healTarget(page: Page, target: Target): Promise<string | null> {
  await page.waitForLoadState('load').catch(() => {});
  const h = target.hints ?? {};
  const candidates: Array<() => Locator> = [];
  if (h.role && h.name) candidates.push(() => page.getByRole(h.role as never, { name: h.name! }));
  if (h.name) candidates.push(() => page.getByLabel(h.name!));
  if (h.placeholder) candidates.push(() => page.getByPlaceholder(h.placeholder!));
  if (h.role && !h.name) candidates.push(() => page.getByRole(h.role as never));
  if (h.text && h.role !== 'table') candidates.push(() => page.getByText(h.text!, { exact: true }));
  if (h.tag) candidates.push(() => page.locator(h.tag!));

  for (const make of candidates) {
    try {
      const loc = make();
      if ((await loc.count()) !== 1) continue;
      const sel = await selectorFor(loc);
      if ((await page.locator(sel).count()) === 1) return sel;
    } catch {
      /* try next strategy */
    }
  }
  return null;
}
