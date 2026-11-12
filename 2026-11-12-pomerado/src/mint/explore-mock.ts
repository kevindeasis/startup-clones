import { BrowserSession, snapshot, targetOf, type SnapEl } from '../browser.js';
import { secretEnvName } from '../template.js';
import type { ExploreInput, RecordedAction, RecordedAuth, Recording } from './types.js';

const TEXT_ROLES = new Set(['textbox', 'searchbox']);

/** Heuristic, model-free explorer: records one example run of the task on the page. */
export async function exploreMock(inp: ExploreInput): Promise<Recording> {
  const session = await BrowserSession.open();
  const { page } = session;
  try {
    const actions: RecordedAction[] = [];
    let auth: RecordedAuth | undefined;

    if (inp.auth) {
      await page.goto(inp.auth.url);
      const snap = await snapshot(page);
      const inputs = snap.elements.filter(
        (e) => e.tag === 'input' && (TEXT_ROLES.has(e.role) || e.inputType === 'password'),
      );
      if (inputs.length < inp.auth.secretNames.length)
        throw new Error(`login page has ${inputs.length} fields but ${inp.auth.secretNames.length} secrets were given`);
      const fields: RecordedAuth['fields'] = [];
      for (let i = 0; i < inp.auth.secretNames.length; i++) {
        const secret = inp.auth.secretNames[i];
        const envName = secretEnvName(inp.name, secret);
        const val = process.env[envName];
        if (!val) throw new Error(`missing secret: ${envName} (set it in the environment before minting)`);
        await page.fill(inputs[i].selector, val);
        fields.push({ target: targetOf(inputs[i]), secret });
      }
      const submit = findSubmit(snap.elements, inputs[0]);
      if (!submit) throw new Error('could not find a sign-in button');
      await page.click(submit.selector);
      await page.waitForLoadState('load').catch(() => {});
      const loginPath = new URL(inp.auth.url).pathname;
      if (new URL(page.url()).pathname.includes(loginPath)) throw new Error('sign-in failed while minting (check the secrets)');
      auth = {
        url: inp.auth.url,
        fields,
        submit: targetOf(submit),
        successCheck: { type: 'urlNotContains', value: loginPath },
        secretNames: inp.auth.secretNames,
      };
    }

    await page.goto(inp.url);
    actions.push({ type: 'goto', url: inp.url, snapshotBefore: '' });
    let snap = await snapshot(page);
    const entries = Object.entries(inp.exampleInput);

    if (entries.length) {
      const [firstKey, firstVal] = entries[0];
      const box = snap.elements.find((e) => e.tag !== 'select' && (TEXT_ROLES.has(e.role) || e.tag === 'textarea'));
      if (!box) throw new Error('mock explorer found no text input on the page for the example input');
      await page.fill(box.selector, firstVal);
      actions.push({ type: 'fill', target: targetOf(box), value: firstVal, inputKey: firstKey, label: box.name, snapshotBefore: snap.text });

      for (const sel of snap.elements.filter((e) => e.tag === 'select')) {
        for (const [k, v] of entries.slice(1)) {
          const opt = sel.options?.find((o) => o.toLowerCase() === v.toLowerCase());
          if (opt) {
            await page.selectOption(sel.selector, { label: opt });
            actions.push({ type: 'select', target: targetOf(sel), value: v, inputKey: k, label: sel.name, snapshotBefore: snap.text });
            break;
          }
        }
      }

      const submit = findSubmit(snap.elements, box);
      if (submit) {
        await page.click(submit.selector);
        actions.push({ type: 'click', target: targetOf(submit), snapshotBefore: snap.text });
      } else {
        await page.press(box.selector, 'Enter');
        actions.push({ type: 'press', target: targetOf(box), key: 'Enter', snapshotBefore: snap.text });
      }
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      snap = await snapshot(page);
    }

    const table = snap.elements.find((e) => e.kind === 'table');
    const list = snap.elements.find((e) => e.kind === 'list');
    if (table) {
      actions.push({ type: 'extract', mode: 'table', target: targetOf(table), as: 'rows', snapshotBefore: snap.text });
    } else if (list) {
      actions.push({
        type: 'extract',
        mode: 'list',
        target: targetOf(list),
        as: 'items',
        item: list.itemSelector ?? ':scope > li',
        fields: { text: { selector: '', attr: 'text' }, href: { selector: 'a', attr: 'href' } },
        snapshotBefore: snap.text,
      });
    } else {
      const main = await page.evaluate(
        `(() => { var m = document.querySelector('main') || document.body; return m === document.body ? 'body' : 'main'; })()`,
      );
      const loc = page.locator(main as string);
      const sel = await loc.evaluate((el) => el.tagName.toLowerCase());
      actions.push({
        type: 'extract',
        mode: 'text',
        target: { selector: String(sel), hints: { tag: String(sel), role: sel === 'main' ? 'main' : undefined } },
        as: 'message',
        snapshotBefore: snap.text,
      });
    }
    inp.log(`explored ${actions.length} actions (mock heuristic explorer)`);
    return { startUrl: inp.url, actions, finalSnapshot: snap.text, auth };
  } finally {
    await session.close();
  }
}

/** Nearest submit button: same form as the anchor element, else a button whose text looks like a submit. */
function findSubmit(els: SnapEl[], anchor: SnapEl): SnapEl | undefined {
  const buttons = els.filter((e) => e.role === 'button');
  return (
    buttons.find((b) => anchor.formSelector && b.formSelector === anchor.formSelector && b.submitsForm) ??
    buttons.find((b) => anchor.formSelector && b.formSelector === anchor.formSelector) ??
    buttons.find((b) => /search|submit|sign ?in|log ?in|go|find/i.test(b.name))
  );
}
