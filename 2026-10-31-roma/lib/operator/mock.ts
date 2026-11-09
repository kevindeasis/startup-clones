import { parseDatePhrase } from "../dates";
import * as ops from "../ops";
import type { Tools } from "./tools";

const VERBS = new Set(("call buy email mail send write text pay book schedule remind clean fix finish submit order pick get make " +
  "renew review read watch cancel reply ask tell plan prepare walk water take check update create add set organize " +
  "return find print draft research visit meet cook go do bring drop sign file wash feed ping follow grab register " +
  "apply compare look").split(" "));

export function splitClauses(message: string): string[] {
  return message.split(/\s*(?:,|;|\n|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
}

/** Deterministic rule-based driver. It calls the very same tool implementations as the real operator. */
export async function mockOperator(message: string, tools: Tools, itemId?: string): Promise<string> {
  const lines: string[] = [];
  const created: string[] = [];
  const clauses = splitClauses(message);
  const item = itemId ? ops.getItem(itemId) : null;

  for (const raw of clauses) {
    const clause = raw.replace(/^(please|also|then)\s+/i, "");
    const first = clause.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";

    if (clause.endsWith("?")) {
      let ans = "I can't look that up in mock mode.";
      if (item) {
        const r = await tools.web_search.run({ query: clause });
        ans += ` (Mock research note for "${item.title}": web_search returned ${r.results.length} result(s).)`;
      }
      lines.push(`Q: "${clause}" - ${ans}`);
      continue;
    }

    if (item) {
      // Per-item scope: use update_items on this item.
      if (/^(rewrite|draft|write|summari[sz]e|research|add|note)\b/i.test(clause)) {
        const body = `${item.body ? item.body + "\n\n" : ""}- (mock) ${clause}`;
        await tools.update_items.run({ updates: [{ id: item.id, body }] });
        lines.push(`Updated the body of "${item.title}" (${clause}).`);
        continue;
      }
      const d = parseDatePhrase(clause);
      if (d.date && /\b(due|move|reschedule|push|by|on)\b/i.test(clause)) {
        await tools.update_items.run({ updates: [{ id: item.id, dueDate: d.date, ...(d.time ? { dueTime: d.time } : {}) }] });
        lines.push(`Set due date of "${item.title}" to ${d.date}${d.time ? " " + d.time : ""}.`);
        continue;
      }
      if (/^(done|complete|finished|check off)/i.test(clause)) {
        await tools.update_items.run({ updates: [{ id: item.id, checked: true }] });
        lines.push(`Checked off "${item.title}".`);
        continue;
      }
    }

    if (/\b(briefing|summary of (my|today))/i.test(clause)) {
      const c = (await tools.get_context.run()) as Awaited<ReturnType<Tools["get_context"]["run"]>>;
      const dueList = c.dueToday.map((i) => i.title).join("; ") || "nothing";
      lines.push(`Briefing for ${c.today}: due today: ${dueList}. Overdue: ${c.overdue.length}.`);
      continue;
    }

    if (/^(delete|remove|trash)\b/i.test(clause)) {
      const q = clause.replace(/^(delete|remove|trash)\s+(the\s+)?/i, "").trim();
      const hits = ops.searchItems(q).map((i) => i.id);
      if (hits.length) {
        await tools.delete_items.run({ ids: hits });
        lines.push(`Deleting ${hits.length} item(s) matching "${q}" needs your approval.`);
      } else lines.push(`I couldn't find anything matching "${q}".`);
      continue;
    }

    if (/\b(email|e-mail|mail|send)\b/i.test(clause)) {
      const to = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(clause)?.[0] ?? "recipient@example.com";
      const about = clause.replace(to, "").replace(/\b(email|e-mail|mail|send)\b/gi, "").replace(/\s+/g, " ").replace(/^\s*(that|saying)\s+/i, "").trim();
      const subject = about ? about.charAt(0).toUpperCase() + about.slice(1, 60) : "Hello";
      await tools.send_email.run({ to, subject, body: `Hi,\n\n${about || "Just checking in."}\n\nThanks` });
      lines.push(`I drafted an email to ${to}. Approve it below to send.`);
      continue;
    }

    const isNote = /\bnote\b/i.test(clause);
    const isImperative = VERBS.has(first) || /^(create|add|make)\b/i.test(clause) || /^(i need to|i have to|need to|remember to|don't forget to)\b/i.test(clause);
    if (isNote || isImperative) {
      const d = parseDatePhrase(clause);
      let title = clause.replace(/^(i need to|i have to|need to|remember to|don't forget to)\s+/i, "")
        .replace(/^(create|add|make)\s+(a |an )?(new )?(task|todo|to-do|reminder)(\s+(called|named|to))?:?\s*/i, "")
        .replace(/^["'\u2018\u201c](.*)["'\u2019\u201d]$/, "$1");
      if (d.matched) title = title.replace(new RegExp("\\s*(?:\\b(?:on|by|at|before|for|due)\\s+)?" + d.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), "");
      title = title.replace(/\b(a |the )?note( that| about| to)?\s*/i, isNote ? "" : "$&").trim() || clause;
      title = title.charAt(0).toUpperCase() + title.slice(1);
      const r = await tools.create_items.run({ items: [{ title, kind: isNote ? "note" : "task", ...(d.date ? { dueDate: d.date } : {}), ...(d.time ? { dueTime: d.time } : {}) }] });
      created.push(...r.created.map((c) => `${c.title}${c.dueDate ? " (due " + c.dueDate + ")" : ""}`));
      continue;
    }

    lines.push(`Noted: "${clause}". Nothing saved.`);
  }

  const out: string[] = [];
  if (created.length) out.push(`Added ${created.length} item${created.length > 1 ? "s" : ""}: ${created.join("; ")}.`);
  out.push(...lines);
  return out.join("\n") || "Nothing to do.";
}
