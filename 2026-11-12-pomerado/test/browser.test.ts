import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession, extractList, extractTable, locate, snapshot, TargetNotFound, selectorFor } from '../src/browser.js';
import { healTarget } from '../src/heal.js';

let s: BrowserSession;
beforeAll(async () => { s = await BrowserSession.open(); });
afterAll(async () => { await s.close(); });

const PAGE = `<body><main><form id="f"><label for="q">Search parts</label><input id="q" name="q" placeholder="Part name">
<select name="c"><option>All</option><option>Seals</option></select><button type="submit">Go</button></form>
<table><thead><tr><th>Part</th><th>Price</th><th>Price</th></tr></thead><tbody><tr><td>A</td><td>1</td><td>2</td></tr><tr><td colspan="3">none</td></tr></tbody></table>
<ul class="l"><li><a href="/a">One</a></li><li><a href="/b">Two</a></li></ul></main></body>`;

describe('browser layer', () => {
  it('snapshots elements with selectors and hints', async () => {
    await s.page.setContent(PAGE);
    const snap = await snapshot(s.page);
    const box = snap.elements.find((e) => e.role === 'textbox')!;
    expect(box.selector).toBe('#q');
    expect(box.name).toBe('Search parts');
    expect(box.placeholder).toBe('Part name');
    expect(snap.text).toMatch(/\[e\d+\] table 3 cols × 2 rows headers=\[Part, Price, Price\]/);
    expect(snap.elements.find((e) => e.tag === 'select')!.options).toEqual(['All', 'Seals']);
  });
  it('extracts tables (slugified, deduped keys, skips colspan rows) and lists', async () => {
    await s.page.setContent(PAGE);
    expect(await extractTable(s.page.locator('table'))).toEqual([{ part: 'A', price: '1', price_2: '2' }]);
    const items = await extractList(s.page.locator('ul.l'), ':scope > li', { name: { selector: '', attr: 'text' }, href: { selector: 'a', attr: 'href' } });
    expect(items).toEqual([{ name: 'One', href: '/a' }, { name: 'Two', href: '/b' }]);
  });
  it('locate throws TargetNotFound for a stale selector', async () => {
    await s.page.setContent(PAGE);
    await expect(locate(s.page, { selector: '#gone', hints: {} }, 300)).rejects.toBeInstanceOf(TargetNotFound);
  });
  it('level-1 heal re-locates by role+name, label, placeholder and tag, and rebuilds a selector', async () => {
    await s.page.setContent(PAGE.replace('id="q" name="q"', 'id="part-search" name="search"').replace('for="q"', 'for="part-search"'));
    expect(await healTarget(s.page, { selector: '#q', hints: { role: 'textbox', name: 'Search parts' } })).toBe('#part-search');
    expect(await healTarget(s.page, { selector: '#q', hints: { placeholder: 'Part name' } })).toBe('#part-search');
    expect(await healTarget(s.page, { selector: '#t', hints: { tag: 'table', role: 'table' } })).toBeTruthy();
    expect(await healTarget(s.page, { selector: '#x', hints: { role: 'button', name: 'Nope' } })).toBeNull();
    const sel = await selectorFor(s.page.locator('button'));
    expect(await s.page.locator(sel).count()).toBe(1);
  });
});
